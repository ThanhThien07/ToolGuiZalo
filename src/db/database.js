const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { getConfig } = require('../config');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

const DEFAULT_ROLES = [
  {
    id: 'role_admin',
    name: 'admin',
    permissions: ['*']
  },
  {
    id: 'role_operator',
    name: 'operator',
    permissions: [
      'contacts:read',
      'contacts:write',
      'consents:read',
      'consents:write',
      'campaigns:read',
      'campaigns:write',
      'campaigns:run',
      'tasks:read',
      'tasks:review',
      'conversations:read',
      'conversations:write',
      'templates:read',
      'templates:write',
      'accounts:read',
      'accounts:operate',
      'reports:export'
    ]
  },
  {
    id: 'role_viewer',
    name: 'viewer',
    permissions: [
      'contacts:read',
      'consents:read',
      'campaigns:read',
      'tasks:read',
      'conversations:read',
      'templates:read',
      'accounts:read',
      'analytics:read',
      'health:read'
    ]
  }
];

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  return Object.assign({}, row);
}

class DbManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this._txDepth = 0;
  }

  getConnection(customPath = null) {
    const cfg = getConfig();
    const targetPath = customPath ? path.resolve(customPath) : cfg.dbPath;
    if (this.db && this.dbPath === targetPath) {
      return this.db;
    }
    this.close();

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const db = new DatabaseSync(targetPath);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `);

    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    db.exec(schemaSql);

    this.db = db;
    this.dbPath = targetPath;
    this.seedDefaults();
    return this.db;
  }

  seedDefaults() {
    const now = new Date().toISOString();
    const insertRole = this.db.prepare(`
      INSERT OR IGNORE INTO roles (id, name, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of DEFAULT_ROLES) {
      insertRole.run(r.id, r.name, JSON.stringify(r.permissions), now, now);
    }

    // Seed tài khoản mặc định nếu chưa có account nào
    const countRow = normalizeRow(this.db.prepare('SELECT COUNT(*) AS cnt FROM accounts').get());
    if (!countRow || countRow.cnt === 0) {
      this.db
        .prepare(
          `INSERT INTO accounts (id, name, channel, profile_dir, status, is_active_primary, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run('acc_default', 'Tài khoản Zalo #1 (Mặc định)', 'zalo_web', 'zalo_profile', 'CLOSED', 1, now, now);
    }

    // Seed cài đặt mặc định an toàn (không có preset TURBO, không spintax né spam, không auto add friend)
    const defaultSettings = {
      template:
        'Xin chào {ten},\nMình gửi bạn thông tin: {thong_tin}\nNếu cần hỗ trợ thêm bạn cứ phản hồi lại tin nhắn này nhé!',
      useCustomMessageFirst: true,
      fastPasteMode: true,
      sendMode: 'SINGLE',
      minDelaySec: 12,
      maxDelaySec: 25,
      batchSize: 15,
      batchPauseSec: 120,
      usePhoneCache: true,
      requireOptInConsent: true,
      scheduleEnabled: false,
      scheduleStartAt: '',
      activeHoursEnabled: false,
      activeHourStart: '08:00',
      activeHourEnd: '21:30',
      timezone: 'Asia/Ho_Chi_Minh',
      theme: 'light'
    };

    const existingAppSettings = normalizeRow(
      this.db.prepare("SELECT value_json FROM settings WHERE key = 'app_settings'").get()
    );
    if (!existingAppSettings) {
      this.db
        .prepare(
          `INSERT INTO settings (key, value_json, updated_at, version)
           VALUES ('app_settings', ?, ?, 1)`
        )
        .run(JSON.stringify(defaultSettings), now);
    }
  }

  prepare(sql) {
    return this.getConnection().prepare(sql);
  }

  exec(sql) {
    return this.getConnection().exec(sql);
  }

  queryAll(sql, params = []) {
    const db = this.getConnection();
    return db.prepare(sql).all(...params).map(normalizeRow);
  }

  queryOne(sql, params = []) {
    const db = this.getConnection();
    return normalizeRow(db.prepare(sql).get(...params)) || null;
  }

  run(sql, params = []) {
    const db = this.getConnection();
    return db.prepare(sql).run(...params);
  }

  withTransaction(fn, immediate = true) {
    const db = this.getConnection();
    if (this._txDepth > 0) {
      return fn(db);
    }
    this._txDepth++;
    db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw err;
    } finally {
      this._txDepth--;
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
      this.dbPath = null;
      this._txDepth = 0;
    }
  }
}

module.exports = new DbManager();
module.exports.DbManager = DbManager;
module.exports.normalizeRow = normalizeRow;
module.exports.DEFAULT_ROLES = DEFAULT_ROLES;
