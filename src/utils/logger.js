/**
 * Logger có cấu trúc + Che thông tin nhạy cảm (PII Masking) theo Roadmap Mục 5 & 10.
 * - Tự động che số điện thoại (0912***678), email, token, cookie, mật khẩu, QR data URL.
 */

const SECRET_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'cookie',
  'cookies',
  'authorization',
  'mfaSecret',
  'qrCode',
  'imageBase64',
  'backupKey'
]);

const MESSAGE_KEYS = new Set([
  'message',
  'replyText',
  'sentMessage',
  'customMessage',
  'body',
  'content'
]);

function maskPhone(phone) {
  const s = String(phone || '').trim();
  if (s.length < 7) return '***';
  return `${s.slice(0, 4)}***${s.slice(-3)}`;
}

function maskPiiInString(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  // Che SĐT Việt Nam (03/05/07/08/09 hoặc +84/84)
  out = out.replace(/(?:\+?84|0)(?:3|5|7|8|9)\d{8}\b/g, (m) => maskPhone(m));
  // Che Bearer token / JWT / hex secrets dài
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  out = out.replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g, '[BASE64_IMAGE_REDACTED]');
  return out;
}

function sanitizeMeta(value, keyName = '', depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[TRUNCATED]';

  if (SECRET_KEYS.has(keyName)) {
    return '[REDACTED]';
  }
  if (keyName === 'phone' || keyName === 'rawPhone') {
    return maskPhone(value);
  }
  if (MESSAGE_KEYS.has(keyName) && typeof value === 'string' && value.length > 24) {
    return `${maskPiiInString(value.slice(0, 12))}...(${value.length} chars)`;
  }

  if (typeof value === 'string') {
    return maskPiiInString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMeta(item, '', depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeMeta(v, k, depth + 1);
    }
    return out;
  }
  return String(value);
}

function writeLog(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: maskPiiInString(String(msg || '')),
    ...(meta && Object.keys(meta).length ? { meta: sanitizeMeta(meta) } : {})
  };
  if (process.env.LOG_SILENT !== 'true') {
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(line + '\n');
    } else if (process.env.LOG_JSON === 'true') {
      process.stdout.write(line + '\n');
    }
  }
  return entry;
}

module.exports = {
  maskPhone,
  maskPiiInString,
  sanitizeMeta,
  info: (msg, meta) => writeLog('info', msg, meta),
  warn: (msg, meta) => writeLog('warn', msg, meta),
  error: (msg, meta) => writeLog('error', msg, meta),
  debug: (msg, meta) => writeLog('debug', msg, meta)
};
