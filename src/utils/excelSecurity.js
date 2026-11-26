const path = require('path');

/**
 * Bảo mật Excel & Upload theo Roadmap Mục 10:
 * - Chống CSV/Excel Formula Injection khi xuất file (=, +, -, @, \t, \r ở đầu ô)
 * - Kiểm tra MIME thực tế (magic bytes), phần mở rộng, kích thước và tên file an toàn khi upload
 */

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function sanitizeSpreadsheetCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str = String(value);
  if (FORMULA_PREFIX_RE.test(str)) {
    return `'${str}`;
  }
  return str;
}

function sanitizeSpreadsheetRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeSpreadsheetCell(v);
  }
  return out;
}

function sanitizeFilename(originalName, fallbackExt = '.bin') {
  const base = path.basename(String(originalName || 'file')).replace(/[^\w.\-]/g, '_');
  const ext = path.extname(base).toLowerCase() || fallbackExt;
  return { base, ext };
}

function detectImageMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { mime: 'image/png', ext: '.png' };
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg' };
  }
  // GIF: 47 49 46 38
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return { mime: 'image/gif', ext: '.gif' };
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: '.webp' };
  }
  return null;
}

function validateUploadedImage(file, maxBytes = 5 * 1024 * 1024) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return { ok: false, error: 'Dữ liệu file ảnh không hợp lệ.' };
  }
  if (file.buffer.length === 0) {
    return { ok: false, error: 'File ảnh bị rỗng.' };
  }
  if (file.buffer.length > maxBytes) {
    return { ok: false, error: `Kích thước ảnh vượt quá giới hạn (${Math.round(maxBytes / 1048576)}MB).` };
  }
  const detected = detectImageMagic(file.buffer);
  if (!detected) {
    return { ok: false, error: 'Định dạng ảnh thực tế không hợp lệ (chỉ hỗ trợ PNG, JPG, GIF, WEBP).' };
  }
  const safe = sanitizeFilename(file.originalname, detected.ext);
  return {
    ok: true,
    mimeType: detected.mime,
    ext: detected.ext,
    safeOriginalName: safe.base
  };
}

function validateSpreadsheetUpload(file, maxBytes = 10 * 1024 * 1024) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return { ok: false, error: 'Không tìm thấy nội dung file tải lên.' };
  }
  if (file.buffer.length === 0) {
    return { ok: false, error: 'File bảng tính bị rỗng.' };
  }
  if (file.buffer.length > maxBytes) {
    return { ok: false, error: `File vượt quá giới hạn ${Math.round(maxBytes / 1048576)}MB.` };
  }
  const { ext, base } = sanitizeFilename(file.originalname, '');
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    return { ok: false, error: 'Chỉ chấp nhận file .xlsx, .xls hoặc .csv.' };
  }
  // Kiểm tra magic bytes cho .xlsx (ZIP PK\x03\x04) hoặc .xls (OLE D0 CF 11 E0)
  if (ext === '.xlsx') {
    const isZip = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
    if (!isZip) {
      return { ok: false, error: 'Nội dung file .xlsx không đúng chuẩn ZIP/OpenXML.' };
    }
  } else if (ext === '.xls') {
    const isOle = file.buffer[0] === 0xd0 && file.buffer[1] === 0xcf && file.buffer[2] === 0x11 && file.buffer[3] === 0xe0;
    // Allow XML/CSV disguised as .xls only if plain UTF-8 text without binary null bytes
    const hasNull = file.buffer.includes(0);
    if (!isOle && hasNull) {
      return { ok: false, error: 'Nội dung file .xls không hợp lệ.' };
    }
  }
  return { ok: true, ext, safeOriginalName: base };
}

module.exports = {
  sanitizeSpreadsheetCell,
  sanitizeSpreadsheetRow,
  sanitizeFilename,
  detectImageMagic,
  validateUploadedImage,
  validateSpreadsheetUpload
};
