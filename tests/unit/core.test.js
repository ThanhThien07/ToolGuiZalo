const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePhone } = require('../../src/phoneUtils');
const { renderMessage, inspectTemplate } = require('../../src/templateEngine');
const { sanitizeSpreadsheetCell, sanitizeSpreadsheetRow, detectImageMagic, validateUploadedImage, validateSpreadsheetUpload } = require('../../src/utils/excelSecurity');
const { maskPhone, maskPiiInString, sanitizeMeta } = require('../../src/utils/logger');
const {
  hashPassword,
  verifyPassword,
  signPayload,
  verifySignedPayload,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  encryptBuffer,
  decryptBuffer
} = require('../../src/utils/cryptoUtils');

test('phoneUtils normalizes valid VN mobile numbers and rejects invalid formats', () => {
  assert.equal(normalizePhone('0912345678').normalized, '0912345678');
  assert.equal(normalizePhone('+84912345678').normalized, '0912345678');
  assert.equal(normalizePhone('84987654323').normalized, '0987654323');
  assert.equal(normalizePhone('912.345.678').normalized, '0912345678');
  assert.equal(normalizePhone('12345').isValid, false);
  assert.equal(normalizePhone('0123456789').isValid, false);
});

test('templateEngine renders personalization variables cleanly without randomized anti-spam obfuscation', () => {
  const tpl = 'Xin chào {ten}, đơn hàng {thong_tin} của SĐT {sdt} cần xác nhận.';
  const contact = { phone: '0912345678', name: 'An', info: '#DH101' };
  const rendered = renderMessage(tpl, contact);
  assert.equal(rendered, 'Xin chào An, đơn hàng #DH101 của SĐT 0912345678 cần xác nhận.');

  // Kiểm tra deterministic nếu còn mẫu cũ chứa dấu | -> không random xoay vòng né spam
  const legacy = '{Chào|Xin chào|Em chào} {ten}';
  assert.equal(renderMessage(legacy, contact), 'Chào An');
  assert.equal(renderMessage(legacy, contact), 'Chào An');

  const check = inspectTemplate('Chào {ten} {ma_khong_ton_tai}', contact);
  assert.deepEqual(check.missingVariables, ['ma_khong_ton_tai']);
  assert.equal(inspectTemplate(legacy, contact).hasObfuscationSyntax, true);
});

test('excelSecurity neutralizes CSV/Excel formula injection and validates upload magic bytes', () => {
  assert.equal(sanitizeSpreadsheetCell('=CMD|"/C calc"!A0'), "'=CMD|\"/C calc\"!A0");
  assert.equal(sanitizeSpreadsheetCell('+SUM(1,2)'), "'+SUM(1,2)");
  assert.equal(sanitizeSpreadsheetCell('-1+1'), "'-1+1");
  assert.equal(sanitizeSpreadsheetCell('@HYPERLINK("x")'), '\'@HYPERLINK("x")');
  assert.equal(sanitizeSpreadsheetCell('\tcmd'), "'\tcmd");
  assert.equal(sanitizeSpreadsheetRow({ a: '=1+1', b: 'Bình thường' }).a, "'=1+1");

  const fakePng = Buffer.from('not really a png');
  assert.equal(detectImageMagic(fakePng), null);
  assert.equal(validateUploadedImage({ originalname: 'test.png', buffer: fakePng }).ok, false);

  const realPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const okImg = validateUploadedImage({ originalname: '../../evil.png', buffer: realPng });
  assert.equal(okImg.ok, true);
  assert.equal(okImg.mimeType, 'image/png');
  assert.equal(okImg.safeOriginalName, 'evil.png');

  const fakeXlsx = Buffer.from('plain text fake zip');
  assert.equal(validateSpreadsheetUpload({ originalname: 'contacts.xlsx', buffer: fakeXlsx }).ok, false);
});

test('logger masks PII phone numbers, message bodies, and secrets', () => {
  assert.equal(maskPhone('0912345678'), '0912***678');
  assert.equal(maskPiiInString('Gửi tới 0912345678 Bearer abcdef.12345'), 'Gửi tới 0912***678 Bearer [REDACTED]');
  const meta = sanitizeMeta({ phone: '0912345678', password: 'secret', token: 'abc', nested: { cookie: 'zpw_sek=1' } });
  assert.equal(meta.phone, '0912***678');
  assert.equal(meta.password, '[REDACTED]');
  assert.equal(meta.token, '[REDACTED]');
  assert.equal(meta.nested.cookie, '[REDACTED]');
});

test('cryptoUtils Argon2id, signed tokens, TOTP MFA, and AES-256-GCM encryption work end-to-end', () => {
  const hash = hashPassword('StrongPass!2026');
  assert.ok(hash.startsWith('argon2id$'));
  assert.equal(verifyPassword('StrongPass!2026', hash), true);
  assert.equal(verifyPassword('WrongPass', hash), false);

  const tok = signPayload({ sub: 'u1', role: 'admin' }, 'super-secret-key', 60);
  const decoded = verifySignedPayload(tok, 'super-secret-key');
  assert.equal(decoded.sub, 'u1');
  assert.equal(verifySignedPayload(tok, 'wrong-secret'), null);

  const secret = generateTotpSecret();
  const code = generateTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000'), false);

  const plain = Buffer.from('ToolGuiZalo encrypted backup payload');
  const enc = encryptBuffer(plain, 'backup-key-2026');
  assert.notEqual(enc.toString('utf8').includes('ToolGuiZalo'), true);
  assert.deepEqual(decryptBuffer(enc, 'backup-key-2026'), plain);
  assert.throws(() => decryptBuffer(enc, 'wrong-key'));
});
