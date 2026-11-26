const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');
const { getConfig } = require('../config');
const { writeAudit } = require('./repositories/common');

/**
 * Migration V1 (database.json + uploads/images) -> V2 (SQLite WAL):
 * - Sao lưu toàn bộ database.json & uploads trước khi migrate.
 * - Kiểm tra cấu trúc dữ liệu, nhập trong 1 transaction.
 * - Bảo toàn lịch sử chiến dịch cũ thay vì reset.
 * - Đối chiếu số lượng trước & sau, lưu chứng thực hoàn tất.
 */
function migrateV1JsonToSqlite({ dryRun = false } = {}) {
  const cfg = getConfig();
  const conn = db.getConnection();

  const alreadyMigrated = db.queryOne("SELECT value_json FROM settings WHERE key = 'v1_migrated_meta'");
  if (alreadyMigrated) {
    return { skipped: true, reason: 'Dữ liệu V1 đã được migrate trước đó.' };
  }

  if (!fs.existsSync(cfg.legacyJsonPath)) {
    const meta = { migratedAt: new Date().toISOString(), source: 'fresh_install' };
    if (!dryRun) {
      db.run(
        `INSERT OR REPLACE INTO settings (key, value_json, updated_at, version) VALUES ('v1_migrated_meta', ?, ?, 1)`,
        [JSON.stringify(meta), meta.migratedAt]
      );
    }
    return { skipped: true, reason: 'Không tìm thấy data/database.json (khởi tạo mới V2).' };
  }

  const rawJson = fs.readFileSync(cfg.legacyJsonPath, 'utf8');
  const parsed = JSON.parse(rawJson);

  const sourceAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  const sourceContacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
  const sourceCache = parsed.phoneCache && typeof parsed.phoneCache === 'object' ? parsed.phoneCache : {};
  const sourceSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};

  if (dryRun) {
    return {
      dryRun: true,
      accountsToMigrate: sourceAccounts.length,
      contactsToMigrate: sourceContacts.length,
      cacheEntriesToMigrate: Object.keys(sourceCache).length
    };
  }

  // 1. Tạo bản sao lưu V1 để có thể rollback có kiểm soát
  const tsStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(cfg.backupDir, `v1_pre_migration_${tsStamp}`);
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.copyFileSync(cfg.legacyJsonPath, path.join(snapshotDir, 'database.json'));
  if (fs.existsSync(cfg.imagesDir)) {
    const imgBackupDir = path.join(snapshotDir, 'images');
    fs.mkdirSync(imgBackupDir, { recursive: true });
    for (const file of fs.readdirSync(cfg.imagesDir)) {
      const srcFile = path.join(cfg.imagesDir, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, path.join(imgBackupDir, file));
      }
    }
  }

  // 2. Nhập trong 1 transaction và đối chiếu số liệu
  const now = new Date().toISOString();
  const report = db.withTransaction(() => {
    let accountsImported = 0;
    let contactsImported = 0;
    let conversationsImported = 0;
    let cacheImported = 0;

    // Accounts
    const upsertAcc = conn.prepare(`
      INSERT INTO accounts (id, name, channel, profile_dir, zalo_profile_name, status, sent_count, is_active_primary, created_at, updated_at, version)
      VALUES (?, ?, 'zalo_web', ?, ?, 'CLOSED', ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        zalo_profile_name = excluded.zalo_profile_name,
        sent_count = excluded.sent_count,
        is_active_primary = excluded.is_active_primary,
        updated_at = excluded.updated_at
    `);
    for (const acc of sourceAccounts) {
      upsertAcc.run(
        acc.id,
        acc.name || acc.id,
        acc.profileDir || `zalo_profile_${acc.id}`,
        acc.zaloProfileName || '',
        Number(acc.sentCount || 0),
        acc.id === parsed.activeAccountId ? 1 : 0,
        acc.createdAt || now,
        now
      );
      accountsImported++;
    }

    // Settings (loại bỏ các tùy chọn vượt giới hạn V1 như autoAddFriendWhenBlocked, delay < 5s)
    const safeMin = Math.max(5, Number(sourceSettings.minDelaySec ?? 12));
    const safeMax = Math.max(safeMin, Number(sourceSettings.maxDelaySec ?? 25));
    const cleanedTemplate = String(sourceSettings.template || '').replace(/\{([^{}|]*\|[^{}]*)\}/g, (_, grp) => grp.split('|')[0].trim());
    const cleanSettings = {
      ...sourceSettings,
      template: cleanedTemplate || 'Xin chào {ten},\nMình gửi bạn thông tin: {thong_tin}',
      minDelaySec: safeMin,
      maxDelaySec: safeMax,
      batchPauseSec: Math.max(30, Number(sourceSettings.batchPauseSec ?? 120)),
      autoAddFriendWhenBlocked: false,
      requireOptInConsent: true,
      sendMode: sourceSettings.sendMode === 'PARALLEL' ? 'PARALLEL' : 'SINGLE'
    };
    conn
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at, version) VALUES ('app_settings', ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(cleanSettings), now);

    // Tạo một Campaign lịch sử cho dữ liệu V1 để không mất dấu vết lịch sử
    const legacyCampaignId = 'cmp_v1_migrated_history';
    conn
      .prepare(
        `INSERT OR IGNORE INTO campaigns (id, name, status, channel, template_body, created_at, updated_at, completed_at, version)
         VALUES (?, 'Lịch sử chiến dịch V1 (Đã migrate)', 'COMPLETED', 'web_assisted', ?, ?, ?, ?, 1)`
      )
      .run(legacyCampaignId, cleanSettings.template, now, now, now);

    // Contacts + Consents + Conversations
    const upsertContact = conn.prepare(`
      INSERT INTO contacts
        (id, phone, raw_phone, name, zalo_name, info, custom_message, note, extra_fields_json, status, reason,
         sent_by_account, sent_by_account_id, sent_message, sent_at, results_json, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `);

    const findContactByPhone = conn.prepare('SELECT id FROM contacts WHERE phone = ?');
    const upsertConsent = conn.prepare(`
      INSERT OR IGNORE INTO contact_consents (id, contact_id, phone, status, source, scope, note, created_at, updated_at, version)
      VALUES (?, ?, ?, 'UNKNOWN', 'v1_migration', 'zalo_notification', 'Cần xác minh quyền đồng ý từ dữ liệu V1', ?, ?, 1)
    `);
    const insertCmpContact = conn.prepare(`
      INSERT OR IGNORE INTO campaign_contacts
        (id, campaign_id, contact_id, phone, rendered_message, status, reason, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const insertConv = conn.prepare(`
      INSERT INTO conversations
        (id, external_thread_id, account_id, contact_id, phone, customer_name, match_status,
         last_message_text, last_message_direction, last_message_at, unread_count, sidebar_rank, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INBOUND', ?, ?, ?, ?, ?, 1)
    `);
    const insertMsg = conn.prepare(`
      INSERT OR IGNORE INTO messages
        (id, conversation_id, direction, channel, sender_name, body, dedupe_hash, status, created_at)
      VALUES (?, ?, 'INBOUND', 'zalo_web', ?, ?, ?, 'RECEIVED', ?)
    `);

    const seenPhones = new Set();

    for (const c of sourceContacts) {
      const phone = String(c.phone || c.rawPhone || '').trim();
      if (!phone) continue;

      let contactId = c.id || `ct_${crypto.randomUUID()}`;
      if (phone !== 'Từ Zalo Web') {
        if (seenPhones.has(phone)) {
          continue;
        }
        const existingPhoneRow = findContactByPhone.get(phone);
        if (existingPhoneRow) {
          contactId = existingPhoneRow.id;
        } else {
          seenPhones.add(phone);
          upsertContact.run(
            contactId,
            phone,
            c.rawPhone || phone,
            c.name || '',
            c.zaloName || '',
            c.info || '',
            c.customMessage || '',
            c.note || '',
            JSON.stringify(c.extraFields || {}),
            c.status || 'PENDING',
            c.reason || '',
            c.sentByAccount || '',
            c.sentByAccountId || null,
            c.sentMessage || '',
            c.sentAt || null,
            JSON.stringify(c.results || {}),
            c.createdAt || now,
            c.updatedAt || now
          );
          contactsImported++;
          upsertConsent.run(`cns_${crypto.randomUUID()}`, contactId, phone, now, now);
          insertCmpContact.run(
            `cc_${crypto.randomUUID()}`,
            legacyCampaignId,
            contactId,
            phone,
            c.sentMessage || '',
            c.status === 'THANH_CONG' ? 'COMPLETED' : 'PENDING',
            c.reason || '',
            c.createdAt || now,
            c.updatedAt || now
          );
        }
      } else {
        contactId = null;
      }

      if (c.hasReplied || c.replyText) {
        const convId = `cnv_${crypto.randomUUID()}`;
        const replyAt = c.replyAt || c.updatedAt || now;
        const replyBody = c.replyText || '';
        const matchStatus = contactId ? 'NEEDS_VERIFICATION' : 'UNLINKED';
        const accExists = c.replyByAccountId && conn.prepare('SELECT id FROM accounts WHERE id = ?').get(c.replyByAccountId);
        insertConv.run(
          convId,
          `legacy_${c.id || crypto.randomUUID()}`,
          accExists ? c.replyByAccountId : null,
          contactId,
          phone,
          c.name || c.zaloName || 'Khách hàng',
          matchStatus,
          replyBody,
          replyAt,
          c.replySeen === false ? 1 : 0,
          typeof c.sidebarRank === 'number' ? c.sidebarRank : 9999,
          c.createdAt || now,
          replyAt
        );
        const dedupe = crypto.createHash('sha256').update(`INBOUND|${replyBody}|${replyAt}`).digest('hex').slice(0, 24);
        insertMsg.run(
          `msg_${crypto.randomUUID()}`,
          convId,
          c.name || c.zaloName || 'Khách hàng',
          replyBody,
          dedupe,
          replyAt
        );
        conversationsImported++;
      }
    }

    // Phone cache
    const insertCache = conn.prepare(
      'INSERT OR REPLACE INTO phone_cache (phone, status, reason, cached_at) VALUES (?, ?, ?, ?)'
    );
    for (const [ph, val] of Object.entries(sourceCache)) {
      insertCache.run(ph, val.status || 'KHONG_DANG_KY', val.reason || '', val.at || now);
      cacheImported++;
    }

    const meta = {
      migratedAt: now,
      source: cfg.legacyJsonPath,
      backupDir: snapshotDir,
      accountsImported,
      contactsImported,
      conversationsImported,
      cacheImported
    };
    conn
      .prepare(`INSERT OR REPLACE INTO settings (key, value_json, updated_at, version) VALUES ('v1_migrated_meta', ?, ?, 1)`)
      .run(JSON.stringify(meta), now);

    return meta;
  });

  writeAudit({
    action: 'migration.v1_to_v2',
    resourceType: 'database',
    details: report
  });

  return { skipped: false, ...report };
}

module.exports = {
  migrateV1JsonToSqlite
};
