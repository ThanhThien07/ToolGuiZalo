const crypto = require('crypto');

/**
 * Tiện ích mật mã cho V2:
 * - Băm & xác minh mật khẩu bằng Argon2id (tích hợp sẵn trong Node 24 crypto)
 * - Ký & xác minh Token phiên / Thiết bị (HMAC-SHA256 + hết hạn TTL)
 * - TOTP MFA (RFC 6238 SHA-1 6 chữ số)
 * - Mã hóa & giải mã sao lưu AES-256-GCM + SHA-256 checksum
 */

function hashPassword(password) {
  const pwd = String(password || '');
  if (pwd.length < 6) {
    throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  }
  const salt = crypto.randomBytes(16);
  const params = { memory: 16384, passes: 2, parallelism: 1, tagLength: 32 };
  const derived = crypto.argon2Sync('argon2id', {
    message: pwd,
    nonce: salt,
    ...params
  });
  return `argon2id$m=${params.memory},t=${params.passes},p=${params.parallelism}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'argon2id') return false;

  const paramMap = {};
  for (const kv of parts[1].split(',')) {
    const [k, v] = kv.split('=');
    paramMap[k] = Number(v);
  }
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.argon2Sync('argon2id', {
    message: String(password),
    nonce: salt,
    memory: paramMap.m || 16384,
    passes: paramMap.t || 2,
    parallelism: paramMap.p || 1,
    tagLength: expected.length
  });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function generateRandomToken(byteLen = 32) {
  return crypto.randomBytes(byteLen).toString('base64url');
}

function signPayload(payload, secret, ttlSec = 3600) {
  const nowSec = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSec,
    jti: crypto.randomUUID()
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySignedPayload(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// Base32 encode/decode cho TOTP MFA
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function decodeBase32(str) {
  const cleaned = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx !== -1) bits += idx.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    out.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(out);
}

function generateTotpCode(secret, timeMs = Date.now(), stepSec = 30) {
  const key = decodeBase32(secret);
  const counter = Math.floor(timeMs / 1000 / stepSec);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function verifyTotpCode(secret, code, window = 1) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const candidate = generateTotpCode(secret, now + w * 30000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) {
      return true;
    }
  }
  return false;
}

// Mã hóa/Giải mã AES-256-GCM cho file Backup
function deriveAesKey(keyMaterial) {
  return crypto.createHash('sha256').update(String(keyMaterial)).digest();
}

function encryptBuffer(plainBuf, keyMaterial) {
  const key = deriveAesKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: Magic(5='TGZB2') + IV(12) + Tag(16) + Ciphertext
  return Buffer.concat([Buffer.from('TGZB2', 'ascii'), iv, tag, encrypted]);
}

function decryptBuffer(encBuf, keyMaterial) {
  if (!Buffer.isBuffer(encBuf) || encBuf.length < 33) {
    throw new Error('Gói backup không hợp lệ hoặc bị hỏng.');
  }
  const magic = encBuf.subarray(0, 5).toString('ascii');
  if (magic !== 'TGZB2') {
    throw new Error('Định dạng gói backup không được hỗ trợ.');
  }
  const iv = encBuf.subarray(5, 17);
  const tag = encBuf.subarray(17, 33);
  const ciphertext = encBuf.subarray(33);
  const key = deriveAesKey(keyMaterial);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  hashToken,
  generateRandomToken,
  signPayload,
  verifySignedPayload,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  encryptBuffer,
  decryptBuffer,
  sha256Hex
};
