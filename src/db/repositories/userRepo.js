const crypto = require('crypto');
const db = require('../database');
const { safeParseJson, writeAudit } = require('./common');

class UserRepo {
  countUsers() {
    const row = db.queryOne('SELECT COUNT(*) AS cnt FROM users');
    return row ? Number(row.cnt) : 0;
  }

  getRoleByName(name) {
    return db.queryOne('SELECT * FROM roles WHERE name = ?', [name]);
  }

  listRoles() {
    return db.queryAll('SELECT * FROM roles ORDER BY id').map((r) => ({
      ...r,
      permissions: safeParseJson(r.permissions_json, [])
    }));
  }

  findById(id) {
    const row = db.queryOne(
      `SELECT u.*, r.name AS role_name, r.permissions_json
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`,
      [id]
    );
    return row ? this.mapUser(row) : null;
  }

  findByUsername(username) {
    const row = db.queryOne(
      `SELECT u.*, r.name AS role_name, r.permissions_json
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE LOWER(u.username) = LOWER(?)`,
      [String(username || '').trim()]
    );
    return row ? this.mapUser(row) : null;
  }

  listUsers() {
    return db
      .queryAll(
        `SELECT u.*, r.name AS role_name, r.permissions_json
         FROM users u JOIN roles r ON r.id = u.role_id
         ORDER BY u.created_at ASC`
      )
      .map((r) => this.mapUser(r, false));
  }

  mapUser(row, includeSecrets = true) {
    const mapped = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      roleId: row.role_id,
      role: row.role_name,
      permissions: safeParseJson(row.permissions_json, []),
      mfaEnabled: Boolean(row.mfa_enabled),
      isActive: Boolean(row.is_active),
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version
    };
    if (includeSecrets) {
      mapped.passwordHash = row.password_hash;
      mapped.mfaSecret = row.mfa_secret;
    }
    return mapped;
  }

  createUser({ username, displayName = '', role = 'operator', passwordHash }) {
    const cleanUsername = String(username || '').trim();
    const roleRow = this.getRoleByName(role);
    if (!roleRow) {
      throw new Error(`Vai trò không hợp lệ: ${role}`);
    }
    if (this.findByUsername(cleanUsername)) {
      throw new Error(`Tên đăng nhập "${cleanUsername}" đã tồn tại.`);
    }
    const now = new Date().toISOString();
    const id = `usr_${crypto.randomUUID()}`;
    db.run(
      `INSERT INTO users (id, username, display_name, role_id, password_hash, mfa_enabled, is_active, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, 1)`,
      [id, cleanUsername, displayName || cleanUsername, roleRow.id, passwordHash, now, now]
    );
    return this.findById(id);
  }

  updateUser(id, patch) {
    const existing = this.findById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const sets = [];
    const params = [];

    if (patch.displayName !== undefined) {
      sets.push('display_name = ?');
      params.push(String(patch.displayName));
    }
    if (patch.role !== undefined) {
      const roleRow = this.getRoleByName(patch.role);
      if (!roleRow) throw new Error(`Vai trò không hợp lệ: ${patch.role}`);
      sets.push('role_id = ?');
      params.push(roleRow.id);
    }
    if (patch.isActive !== undefined) {
      sets.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }
    if (patch.passwordHash !== undefined) {
      sets.push('password_hash = ?');
      params.push(patch.passwordHash);
    }
    if (patch.mfaEnabled !== undefined) {
      sets.push('mfa_enabled = ?');
      params.push(patch.mfaEnabled ? 1 : 0);
    }
    if (patch.mfaSecret !== undefined) {
      sets.push('mfa_secret = ?');
      params.push(patch.mfaSecret);
    }
    if (patch.lastLoginAt !== undefined) {
      sets.push('last_login_at = ?');
      params.push(patch.lastLoginAt);
    }
    if (sets.length === 0) return existing;
    sets.push('updated_at = ?', 'version = version + 1');
    params.push(now, id);

    db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.findById(id);
  }

  createSession({ userId, tokenHash, deviceLabel = '', ipAddress = '', expiresAt }) {
    const now = new Date().toISOString();
    const id = `ses_${crypto.randomUUID()}`;
    db.run(
      `INSERT INTO user_sessions (id, user_id, token_hash, device_label, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, tokenHash, deviceLabel, ipAddress, expiresAt, now]
    );
    return id;
  }

  findValidSession(tokenHash) {
    const now = new Date().toISOString();
    const row = db.queryOne(
      `SELECT s.*, u.username, u.display_name, u.is_active, u.mfa_enabled, r.name AS role_name, r.permissions_json
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_active = 1`,
      [tokenHash, now]
    );
    if (!row) return null;
    return {
      sessionId: row.id,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role_name,
      permissions: safeParseJson(row.permissions_json, []),
      mfaEnabled: Boolean(row.mfa_enabled),
      expiresAt: row.expires_at
    };
  }

  revokeSession(tokenHash) {
    const now = new Date().toISOString();
    db.run('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', [
      now,
      tokenHash
    ]);
  }

  revokeAllUserSessions(userId) {
    const now = new Date().toISOString();
    db.run('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
      now,
      userId
    ]);
  }

  // Devices & pairing
  createPairingCode({ role = 'SYNC_CLIENT', createdBy = null, ttlSec = 300 }) {
    const now = new Date();
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();
    db.run(
      `INSERT INTO device_pairing_codes (code, role, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [code, role, createdBy, expiresAt, now.toISOString()]
    );
    return { code, role, expiresAt };
  }

  consumePairingCode(code) {
    const now = new Date().toISOString();
    return db.withTransaction(() => {
      const row = db.queryOne(
        'SELECT * FROM device_pairing_codes WHERE code = ? AND used_at IS NULL AND expires_at > ?',
        [String(code || '').trim().toUpperCase(), now]
      );
      if (!row) return null;
      db.run('UPDATE device_pairing_codes SET used_at = ? WHERE code = ?', [now, row.code]);
      return row;
    });
  }

  registerDevice({ name, hostname = '', platform = 'win32', role = 'SYNC_CLIENT', tokenHash, appVersion = '2.0.0' }) {
    const now = new Date().toISOString();
    const id = `dev_${crypto.randomUUID()}`;
    db.run(
      `INSERT INTO devices (id, name, hostname, platform, role, status, token_hash, last_seen_cursor, last_seen_at, app_version, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, 'ONLINE', ?, 0, ?, ?, ?, ?, 1)`,
      [id, name, hostname, platform, role, tokenHash, now, appVersion, now, now]
    );
    writeAudit({
      action: 'device.registered',
      resourceType: 'device',
      resourceId: id,
      details: { name, hostname, role }
    });
    return this.getDevice(id);
  }

  getDevice(id) {
    return db.queryOne(
      'SELECT id, name, hostname, platform, role, status, last_seen_cursor, last_seen_at, app_version, revoked_at, created_at, updated_at, version FROM devices WHERE id = ?',
      [id]
    );
  }

  findDeviceByTokenHash(tokenHash) {
    return db.queryOne(
      `SELECT id, name, hostname, platform, role, status, last_seen_cursor, last_seen_at, app_version, revoked_at, created_at, updated_at, version
       FROM devices WHERE token_hash = ? AND revoked_at IS NULL`,
      [tokenHash]
    );
  }

  listDevices() {
    return db.queryAll(
      'SELECT id, name, hostname, platform, role, status, last_seen_cursor, last_seen_at, app_version, revoked_at, created_at, updated_at, version FROM devices ORDER BY updated_at DESC'
    );
  }

  touchDevice(id, cursor = null, status = 'ONLINE') {
    const now = new Date().toISOString();
    if (cursor !== null && cursor !== undefined) {
      db.run(
        'UPDATE devices SET status = ?, last_seen_cursor = ?, last_seen_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL',
        [status, Number(cursor), now, now, id]
      );
    } else {
      db.run('UPDATE devices SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL', [
        status,
        now,
        now,
        id
      ]);
    }
    return this.getDevice(id);
  }

  revokeDevice(id, actor = 'system') {
    const now = new Date().toISOString();
    db.run(
      `UPDATE devices SET status = 'REVOKED', revoked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
      [now, now, id]
    );
    writeAudit({
      actorUsername: actor,
      action: 'device.revoked',
      resourceType: 'device',
      resourceId: id
    });
    return this.getDevice(id);
  }
}

module.exports = new UserRepo();
