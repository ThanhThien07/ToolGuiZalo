const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');

function loadDotEnv() {
  const envFile = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envFile)) return;
  try {
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore malformed .env
  }
}

loadDotEnv();

function ensureOrLoadLocalSecret(dataDir, filename, envKey) {
  if (process.env[envKey] && process.env[envKey].length >= 16) {
    return process.env[envKey];
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const secretPath = path.join(dataDir, filename);
  if (fs.existsSync(secretPath)) {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

function getConfig() {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(ROOT_DIR, 'data');
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(dataDir, 'toolguizalo.db');
  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(ROOT_DIR, 'uploads');
  const imagesDir = path.join(uploadsDir, 'images');
  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(dataDir, 'backups');
  const userDataDir = process.env.USER_DATA_DIR
    ? path.resolve(process.env.USER_DATA_DIR)
    : path.join(ROOT_DIR, 'user_data');

  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const allowlistRaw =
    process.env.CORS_ALLOWLIST ||
    `http://127.0.0.1:${port},http://localhost:${port},http://${host}:${port}`;

  return {
    rootDir: ROOT_DIR,
    nodeEnv: process.env.NODE_ENV || 'development',
    host,
    port,
    corsAllowlist: allowlistRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir,
    dbPath,
    legacyJsonPath: path.join(dataDir, 'database.json'),
    uploadsDir,
    imagesDir,
    backupDir,
    userDataDir,
    appSecret: ensureOrLoadLocalSecret(dataDir, '.app_secret', 'APP_SECRET'),
    backupKey: ensureOrLoadLocalSecret(dataDir, '.backup_key', 'BACKUP_ENCRYPTION_KEY'),
    accessTokenTtlSec: Math.max(300, Number(process.env.ACCESS_TOKEN_TTL_SEC || 28800)),
    deviceTokenTtlSec: Math.max(3600, Number(process.env.DEVICE_TOKEN_TTL_SEC || 2592000)),
    agentIsolated: process.env.AGENT_ISOLATED !== 'false',
    channelMode: process.env.CHANNEL_MODE || 'web_assisted',
    zaloOa: {
      accessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
      appSecret: process.env.ZALO_OA_APP_SECRET || '',
      webhookSecret: process.env.ZALO_OA_WEBHOOK_SECRET || ''
    },
    retention: {
      dailyBackups: Math.max(1, Number(process.env.BACKUP_RETENTION_DAILY || 7)),
      weeklyBackups: Math.max(1, Number(process.env.BACKUP_RETENTION_WEEKLY || 4)),
      logDays: Math.max(1, Number(process.env.LOG_RETENTION_DAYS || 30))
    },
    timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
    maxImportBytes: 10 * 1024 * 1024,
    maxUploadImageBytes: 5 * 1024 * 1024
  };
}

module.exports = {
  getConfig,
  ROOT_DIR
};
