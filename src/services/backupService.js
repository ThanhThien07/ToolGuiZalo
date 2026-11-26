const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db/database');
const auditRepo = require('../db/repositories/auditRepo');
const { writeAudit } = require('../db/repositories/common');
const { getConfig } = require('../config');
const { encryptBuffer, decryptBuffer, sha256Hex } = require('../utils/cryptoUtils');

/**
 * Dịch vụ Sao lưu & Phục hồi mã hóa (Roadmap Mục 4 & 10):
 * - Tạo snapshot SQLite nhất quán bằng VACUUM INTO (không khóa ghi lâu)
 * - Đóng gói kèm manifest + checksum SHA-256 + file ảnh đính kèm
 * - Mã hóa AES-256-GCM bằng BACKUP_ENCRYPTION_KEY
 * - Tự dọn bản cũ theo chính sách giữ 7 bản ngày / 4 bản tuần
 */
class BackupService {
  createBackup({ kind = 'manual', actor = 'system', outputDir = null } = {}) {
    const cfg = getConfig();
    const dir = outputDir ? path.resolve(outputDir) : cfg.backupDir;
    fs.mkdirSync(dir, { recursive: true });

    const conn = db.getConnection();
    const id = `bkp_${crypto.randomUUID()}`;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const tempSqlite = path.join(dir, `.tmp_${id}.db`);
    const outName = `backup_${kind}_${ts}_${id.slice(0, 12)}.tgzbkp`;
    const outPath = path.join(dir, outName);

    try {
      const escapedTemp = tempSqlite.replace(/'/g, "''");
      conn.exec(`VACUUM INTO '${escapedTemp}'`);

      const sqliteBytes = fs.readFileSync(tempSqlite);
      const counts = {
        contacts: db.queryOne('SELECT COUNT(*) AS c FROM contacts')?.c || 0,
        consents: db.queryOne('SELECT COUNT(*) AS c FROM contact_consents')?.c || 0,
        campaigns: db.queryOne('SELECT COUNT(*) AS c FROM campaigns')?.c || 0,
        tasks: db.queryOne('SELECT COUNT(*) AS c FROM tasks')?.c || 0,
        conversations: db.queryOne('SELECT COUNT(*) AS c FROM conversations')?.c || 0,
        accounts: db.queryOne('SELECT COUNT(*) AS c FROM accounts')?.c || 0
      };

      const attachmentFiles = [];
      if (fs.existsSync(cfg.imagesDir)) {
        for (const f of fs.readdirSync(cfg.imagesDir)) {
          const full = path.join(cfg.imagesDir, f);
          if (fs.statSync(full).isFile()) {
            attachmentFiles.push({
              name: f,
              dataB64: fs.readFileSync(full).toString('base64')
            });
          }
        }
      }

      const bundle = {
        format: 'toolguizalo_backup_v2',
        backupId: id,
        kind,
        createdAt: new Date().toISOString(),
        createdBy: actor,
        counts,
        sqliteSha256: sha256Hex(sqliteBytes),
        sqliteB64: sqliteBytes.toString('base64'),
        attachments: attachmentFiles
      };

      const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));
      const encrypted = encryptBuffer(compressed, cfg.backupKey);
      fs.writeFileSync(outPath, encrypted);

      const bundleHash = sha256Hex(encrypted);
      db.run(
        `INSERT INTO backups (id, filename, file_path, sha256, size_bytes, encrypted, kind, records_summary_json, verified_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [id, outName, outPath, bundleHash, encrypted.length, kind, JSON.stringify(counts), bundle.createdAt, actor, bundle.createdAt]
      );

      this.applyRetentionPolicy(dir);

      writeAudit({
        actorUsername: actor,
        action: 'backup.created',
        resourceType: 'backup',
        resourceId: id,
        details: { filename: outName, kind, counts }
      });

      return {
        id,
        filename: outName,
        filePath: outPath,
        sha256: bundleHash,
        sizeBytes: encrypted.length,
        kind,
        counts,
        createdAt: bundle.createdAt
      };
    } finally {
      if (fs.existsSync(tempSqlite)) {
        try {
          fs.unlinkSync(tempSqlite);
        } catch {}
      }
    }
  }

  readAndVerifyBackupFile(filePath, encryptionKey = null) {
    const cfg = getConfig();
    if (!fs.existsSync(filePath)) {
      throw new Error(`Không tìm thấy file backup: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath);
    const fileSha = sha256Hex(raw);
    const compressed = decryptBuffer(raw, encryptionKey || cfg.backupKey);
    const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
    if (bundle.format !== 'toolguizalo_backup_v2' || !bundle.sqliteB64) {
      throw new Error('Cấu trúc gói backup không hợp lệ.');
    }
    const sqliteBuf = Buffer.from(bundle.sqliteB64, 'base64');
    if (sha256Hex(sqliteBuf) !== bundle.sqliteSha256) {
      throw new Error('Checksum SQLite trong gói backup không khớp!');
    }
    return { bundle, sqliteBuf, fileSha };
  }

  verifyBackup(backupId) {
    const row = db.queryOne('SELECT * FROM backups WHERE id = ?', [backupId]);
    if (!row) throw new Error('Không tìm thấy bản ghi backup.');
    const { bundle, fileSha } = this.readAndVerifyBackupFile(row.file_path);
    if (row.sha256 && fileSha !== row.sha256) {
      throw new Error('Checksum file backup đã bị thay đổi!');
    }
    const now = new Date().toISOString();
    db.run('UPDATE backups SET verified_at = ? WHERE id = ?', [now, backupId]);
    return {
      ok: true,
      backupId,
      verifiedAt: now,
      counts: bundle.counts
    };
  }

  /**
   * Phục hồi bản sao lưu vào một DB đích sạch (test / disaster recovery) hoặc thay thế DB hiện tại.
   */
  restoreBackup({ backupId = null, filePath = null, targetDbPath = null, targetImagesDir = null, actor = 'system', encryptionKey = null } = {}) {
    const cfg = getConfig();
    let srcFile = filePath;
    if (!srcFile && backupId) {
      const row = db.queryOne('SELECT file_path FROM backups WHERE id = ?', [backupId]);
      if (!row) throw new Error('Không tìm thấy bản backup để phục hồi.');
      srcFile = row.file_path;
    }
    if (!srcFile) throw new Error('Cần chỉ định backupId hoặc filePath.');

    const { bundle, sqliteBuf } = this.readAndVerifyBackupFile(srcFile, encryptionKey);
    const destDb = path.resolve(targetDbPath || cfg.dbPath);
    const destImages = path.resolve(targetImagesDir || cfg.imagesDir);
    const isReplacingActiveDb = path.resolve(destDb) === path.resolve(cfg.dbPath);

    if (isReplacingActiveDb) {
      // Đóng kết nối trước khi thay thế file DB
      db.close();
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(destDb + suffix)) {
          try {
            fs.unlinkSync(destDb + suffix);
          } catch {}
        }
      }
    }

    fs.mkdirSync(path.dirname(destDb), { recursive: true });
    fs.writeFileSync(destDb, sqliteBuf);

    // Kiểm tra toàn vẹn trên môi trường sạch bằng SQLite integrity_check
    const checkDb = new DatabaseSync(destDb);
    const integrity = checkDb.prepare('PRAGMA integrity_check').get();
    const restoredContacts = checkDb.prepare('SELECT COUNT(*) AS c FROM contacts').get()?.c || 0;
    checkDb.close();

    if (!integrity || integrity.integrity_check !== 'ok') {
      throw new Error('Phục hồi thất bại: SQLite integrity_check không đạt.');
    }

    if (Array.isArray(bundle.attachments) && bundle.attachments.length > 0) {
      fs.mkdirSync(destImages, { recursive: true });
      for (const att of bundle.attachments) {
        const safeName = path.basename(att.name);
        fs.writeFileSync(path.join(destImages, safeName), Buffer.from(att.dataB64, 'base64'));
      }
    }

    if (isReplacingActiveDb) {
      db.getConnection(destDb);
      writeAudit({
        actorUsername: actor,
        action: 'backup.restored',
        resourceType: 'backup',
        resourceId: backupId || path.basename(srcFile),
        details: { restoredContacts }
      });
    }

    return {
      ok: true,
      targetDbPath: destDb,
      integrity: integrity.integrity_check,
      restoredCounts: bundle.counts,
      verifiedContactsCount: Number(restoredContacts)
    };
  }

  applyRetentionPolicy(backupDir = null) {
    const cfg = getConfig();
    const keepDaily = cfg.retention.dailyBackups;
    const allAuto = db.queryAll("SELECT * FROM backups WHERE kind IN ('daily', 'weekly') ORDER BY created_at DESC");
    const dailies = allAuto.filter((b) => b.kind === 'daily');
    const weeklies = allAuto.filter((b) => b.kind === 'weekly');

    const toPrune = [...dailies.slice(keepDaily), ...weeklies.slice(cfg.retention.weeklyBackups)];
    for (const old of toPrune) {
      if (old.file_path && fs.existsSync(old.file_path)) {
        try {
          fs.unlinkSync(old.file_path);
        } catch {}
      }
      db.run('DELETE FROM backups WHERE id = ?', [old.id]);
    }
    return toPrune.length;
  }

  listBackups() {
    return auditRepo.listBackups();
  }
}

module.exports = new BackupService();
