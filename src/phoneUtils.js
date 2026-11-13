/**
 * Bộ xử lý & chuẩn hóa số điện thoại Việt Nam
 */

const VN_CARRIER_PREFIXES = /^(03[2-9]|05[25689]|07[06-9]|08[1-9]|09[0-46-9])\d{7}$/;

/**
 * Chuẩn hóa số điện thoại về dạng 10 chữ số chuẩn Việt Nam (0xxxxxxxxx)
 * @param {string|number} rawPhone
 * @returns {{ normalized: string, isValid: boolean, raw: string, error?: string }}
 */
function normalizePhone(rawPhone) {
  const raw = String(rawPhone ?? '').trim();
  if (!raw) {
    return { normalized: '', isValid: false, raw, error: 'Số điện thoại trống' };
  }

  // Loại bỏ khoảng trắng, dấu chấm, dấu gạch ngang, dấu ngoặc
  let cleaned = raw.replace(/[\s.\-()]/g, '');

  // Xử lý mã quốc gia +84 hoặc 84 ở đầu
  if (cleaned.startsWith('+84')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('84') && (cleaned.length === 11 || cleaned.length === 10)) {
    cleaned = '0' + cleaned.slice(2);
  } else if (cleaned.length === 9 && /^[35789]\d{8}$/.test(cleaned)) {
    // Trường hợp file Excel làm mất số 0 ở đầu (ví dụ: 912345678)
    cleaned = '0' + cleaned;
  }

  if (!/^\d+$/.test(cleaned)) {
    return { normalized: cleaned, isValid: false, raw, error: 'Chứa ký tự không phải số' };
  }

  if (cleaned.length !== 10) {
    return {
      normalized: cleaned,
      isValid: false,
      raw,
      error: `Độ dài không hợp lệ (${cleaned.length} số, cần 10 số)`
    };
  }

  if (!VN_CARRIER_PREFIXES.test(cleaned)) {
    return {
      normalized: cleaned,
      isValid: false,
      raw,
      error: 'Đầu số di động Việt Nam không hợp lệ'
    };
  }

  return { normalized: cleaned, isValid: true, raw };
}

module.exports = {
  normalizePhone
};

