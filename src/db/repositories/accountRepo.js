const crypto = require('crypto');
const db = require('../database');
const { safeParseJson, recordSyncEvent, writeAudit } = require('./common');

class AccountRepo {
  mapAccount(row) {
    if (!row) return null;
    return {
      id: row.id,
      deviceId: row.device_id,
      name: row.name,
      channel: row.channel,
      profileDir: row.profile_dir,
      zaloProfileName: row.zalo_profile_name,
      status: row.status,
      sentCount: row.sent_count,
      isDefault: row.id === 'acc_default' || Boolean(row.is_active_primary),
      isActivePrimary: Boolean(row.is_active_primary),
      rateLimitedUntil: row.rate_limited_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version
    };
  }

  list() {
    return db.queryAll('SELECT * FROM accounts ORDER BY created_at ASC').map((r) => this.mapAccount(r));
  }

  getById(id) {
    return this.mapAccount(db.queryOne('SELECT * FROM accounts WHERE id = ?', [id]));
  }

  getActive() {
    const row =
      db.queryOne('SELECT * FROM accounts WHERE is_active_primary = 1 LIMIT 1') ||
      db.queryOne('SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1');
    return this.mapAccount(row);
  }

  setActive(id) {
    const found = this.getById(id);
    if (!found) return null;
    const now = new Date().toISOString();
    db.withTransaction(() => {
      db.run('UPDATE accounts SET is_active_primary = 0, updated_at = ?', [now]);
      db.run('UPDATE accounts SET is_active_primary = 1, updated_at = ?, version = version + 1 WHERE id = ?', [now, id]);
    });
    return this.getById(id);
  }

  create({ id = null, name, channel = 'zalo_web', profileDir = null, deviceId = null }) {
    const accId = id || `acc_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const count = this.list().length;
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO accounts (id, device_id, name, channel, profile_dir, status, sent_count, is_active_primary, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, 'CLOSED', 0, 0, ?, ?, 1)`,
      [
        accId,
        deviceId,
        String(name || `Tài khoản Zalo #${count + 1}`).trim(),
        channel,
        profileDir || `zalo_profile_${accId}`,
        now,
        now
      ]
    );
    writeAudit({
      action: 'account.created',
      resourceType: 'account',
      resourceId: accId,
      details: { name, channel }
    });
    return this.getById(accId);
  }

  update(id, patch = {}) {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const sets = [];
    const params = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(String(patch.name));
    }
    if (patch.channel !== undefined) {
      sets.push('channel = ?');
      params.push(String(patch.channel));
    }
    if (patch.zaloProfileName !== undefined) {
      sets.push('zalo_profile_name = ?');
      params.push(String(patch.zaloProfileName));
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(String(patch.status));
    }
    if (patch.sentCount !== undefined) {
      sets.push('sent_count = ?');
      params.push(Number(patch.sentCount));
    }
    if (patch.rateLimitedUntil !== undefined) {
      sets.push('rate_limited_until = ?');
      params.push(patch.rateLimitedUntil);
    }
    if (!sets.length) return existing;
    sets.push('updated_at = ?', 'version = version + 1');
    params.push(now, id);
    db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  incrementSent(id) {
    const now = new Date().toISOString();
    db.run('UPDATE accounts SET sent_count = sent_count + 1, updated_at = ?, version = version + 1 WHERE id = ?', [
      now,
      id
    ]);
  }

  delete(id) {
    if (this.list().length <= 1) {
      throw new Error('Phải giữ lại ít nhất 1 tài khoản.');
    }
    const existing = this.getById(id);
    if (!existing) return this.list();
    db.withTransaction(() => {
      db.run('DELETE FROM accounts WHERE id = ?', [id]);
      if (existing.isActivePrimary) {
        const first = db.queryOne('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1');
        if (first) {
          db.run('UPDATE accounts SET is_active_primary = 1 WHERE id = ?', [first.id]);
        }
      }
    });
    writeAudit({
      action: 'account.deleted',
      resourceType: 'account',
      resourceId: id
    });
    return this.list();
  }
}

class SettingsRepo {
  get(key = 'app_settings', fallback = {}) {
    const row = db.queryOne('SELECT * FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    return safeParseJson(row.value_json, fallback);
  }

  set(key, value) {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO settings (key, value_json, updated_at, version)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, version = settings.version + 1`,
      [key, JSON.stringify(value), now]
    );
    return value;
  }

  getAppSettings() {
    const current = this.get('app_settings', {});
    const images = db.queryAll('SELECT * FROM attachments WHERE campaign_id IS NULL ORDER BY created_at ASC').map((img) => ({
      id: img.id,
      name: img.original_name,
      url: `/uploads/images/${img.stored_name}`,
      filePath: img.file_path,
      mimeType: img.mime_type,
      sizeBytes: img.size_bytes
    }));
    // Loại bỏ cấu hình vượt giới hạn nền tảng nếu còn sót từ V1
    const safeMinDelay = Math.max(5, Number(current.minDelaySec ?? 12));
    const safeMaxDelay = Math.max(safeMinDelay, Number(current.maxDelaySec ?? 25));
    const safeBatchPause = Math.max(30, Number(current.batchPauseSec ?? 120));
    const clean = {
      ...current,
      minDelaySec: safeMinDelay,
      maxDelaySec: safeMaxDelay,
      batchPauseSec: safeBatchPause,
      autoAddFriendWhenBlocked: false,
      sendMode: current.sendMode === 'PARALLEL' || current.sendMode === 'SINGLE' ? current.sendMode : 'SINGLE',
      attachedImages: images
    };
    return clean;
  }

  updateAppSettings(partial = {}) {
    const current = this.get('app_settings', {});
    const sanitized = { ...partial };
    // Không cho phép cấu hình vượt giới hạn nền tảng (TURBO / autoAddFriendWhenBlocked)
    delete sanitized.autoAddFriendWhenBlocked;
    delete sanitized.attachedImages;
    if (sanitized.minDelaySec !== undefined) {
      sanitized.minDelaySec = Math.max(5, Number(sanitized.minDelaySec) || 5);
    }
    if (sanitized.maxDelaySec !== undefined) {
      sanitized.maxDelaySec = Math.max(sanitized.minDelaySec ?? current.minDelaySec ?? 5, Number(sanitized.maxDelaySec) || 12);
    }
    if (sanitized.batchPauseSec !== undefined) {
      sanitized.batchPauseSec = Math.max(30, Number(sanitized.batchPauseSec) || 30);
    }
    const next = { ...current, ...sanitized, autoAddFriendWhenBlocked: false };
    this.set('app_settings', next);
    recordSyncEvent('system.health', 'settings', 'app_settings', 1, { updated: Object.keys(sanitized) });
    return this.getAppSettings();
  }

  listAttachments() {
    return db.queryAll('SELECT * FROM attachments WHERE campaign_id IS NULL ORDER BY created_at ASC').map((img) => ({
      id: img.id,
      name: img.original_name,
      url: `/uploads/images/${img.stored_name}`,
      filePath: img.file_path,
      mimeType: img.mime_type,
      sizeBytes: img.size_bytes,
      sha256: img.sha256,
      createdAt: img.created_at
    }));
  }

  addAttachment({ id, originalName, storedName, filePath, mimeType, sizeBytes, sha256 }) {
    const attId = id || `img_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO attachments (id, original_name, stored_name, file_path, mime_type, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [attId, originalName, storedName, filePath, mimeType, sizeBytes, sha256 || '', now]
    );
    return this.listAttachments();
  }

  removeAttachment(id) {
    const row = db.queryOne('SELECT * FROM attachments WHERE id = ?', [id]);
    if (row) {
      db.run('DELETE FROM attachments WHERE id = ?', [id]);
    }
    return { removed: row, remaining: this.listAttachments() };
  }

  clearAttachments() {
    const rows = db.queryAll('SELECT * FROM attachments WHERE campaign_id IS NULL');
    db.run('DELETE FROM attachments WHERE campaign_id IS NULL');
    return rows;
  }
}

class TemplateRepo {
  mapRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      body: r.body,
      channel: r.channel,
      approvalStatus: r.approval_status,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      templateVersion: r.template_version,
      isDefault: Boolean(r.is_default),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version
    };
  }

  list() {
    return db.queryAll('SELECT * FROM templates ORDER BY updated_at DESC').map((r) => this.mapRow(r));
  }

  getById(id) {
    return this.mapRow(db.queryOne('SELECT * FROM templates WHERE id = ?', [id]));
  }

  create({ name, body, channel = 'zalo_oa', isDefault = false }) {
    const id = `tpl_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.withTransaction(() => {
      if (isDefault) {
        db.run('UPDATE templates SET is_default = 0');
      }
      db.run(
        `INSERT INTO templates (id, name, body, channel, approval_status, template_version, is_default, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, 'DRAFT', 1, ?, ?, ?, 1)`,
        [id, String(name || 'Mẫu tin nhắn'), String(body || ''), channel, isDefault ? 1 : 0, now, now]
      );
    });
    return this.getById(id);
  }

  update(id, patch = {}) {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    db.run(
      `UPDATE templates
       SET name = ?,
           body = ?,
           channel = ?,
           approval_status = ?,
           template_version = template_version + ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ?`,
      [
        patch.name !== undefined ? patch.name : existing.name,
        patch.body !== undefined ? patch.body : existing.body,
        patch.channel !== undefined ? patch.channel : existing.channel,
        bodyChanged ? 'DRAFT' : existing.approvalStatus,
        bodyChanged ? 1 : 0,
        now,
        id
      ]
    );
    return this.getById(id);
  }

  approve(id, userId = null, actor = 'admin') {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    db.run(
      `UPDATE templates SET approval_status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
      [userId, now, now, id]
    );
    writeAudit({
      actorUserId: userId,
      actorUsername: actor,
      action: 'template.approved',
      resourceType: 'template',
      resourceId: id,
      details: { templateVersion: existing.templateVersion }
    });
    return this.getById(id);
  }

  delete(id) {
    db.run('DELETE FROM templates WHERE id = ?', [id]);
  }
}

module.exports = {
  accountRepo: new AccountRepo(),
  settingsRepo: new SettingsRepo(),
  templateRepo: new TemplateRepo()
};
