/**
 * Bộ dựng nội dung tin nhắn cá nhân hóa V2:
 * - Loại bỏ cơ chế biến đổi nội dung Spintax né phát hiện spam theo định hướng V2.
 * - Giữ cá nhân hóa hợp lệ qua biến ({ten}, {sdt}, {thong_tin}, {ghi_chu}, cột Excel mở rộng).
 * - Hỗ trợ kiểm tra biến thiếu và phát hiện dấu hiệu nội dung không hợp lệ trước khi duyệt mẫu.
 */

function slugifyKey(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function buildVariablesMap(contact = {}) {
  const variables = {
    sdt: contact.phone || '',
    phone: contact.phone || '',
    ten: contact.name || 'Anh/Chị',
    name: contact.name || 'Anh/Chị',
    hoten: contact.name || 'Anh/Chị',
    ho_ten: contact.name || 'Anh/Chị',
    thongtin: contact.info || '',
    thong_tin: contact.info || '',
    info: contact.info || '',
    ghichu: contact.note || '',
    ghi_chu: contact.note || '',
    note: contact.note || '',
    noidung: contact.customMessage || '',
    noi_dung: contact.customMessage || ''
  };

  if (contact.extraFields && typeof contact.extraFields === 'object') {
    for (const [key, val] of Object.entries(contact.extraFields)) {
      const cleanKey = key.trim();
      const slugKey = slugifyKey(cleanKey);
      variables[cleanKey] = val ?? '';
      variables[cleanKey.toLowerCase()] = val ?? '';
      if (slugKey) {
        variables[slugKey] = val ?? '';
      }
    }
  }
  return variables;
}

/**
 * Kiểm tra các biến được dùng trong mẫu và phát hiện biến chưa có dữ liệu.
 * @param {string} template
 * @param {object} contact
 * @returns {{ usedVariables: string[], missingVariables: string[], hasObfuscationSyntax: boolean }}
 */
function inspectTemplate(template, contact = {}) {
  const text = String(template || '');
  const variables = buildVariablesMap(contact);
  const usedVariables = [];
  const missingVariables = [];
  const hasObfuscationSyntax = /\{[^{}]*\|[^{}]*\}/.test(text);

  const re = /\{([^{}]+)\}/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const rawKey = match[1].trim();
    if (rawKey.includes('|')) continue;
    if (!usedVariables.includes(rawKey)) usedVariables.push(rawKey);
    const lowerKey = rawKey.toLowerCase();
    const slugKey = slugifyKey(lowerKey);
    const val =
      variables[rawKey] ?? variables[lowerKey] ?? variables[slugKey];
    if (val === undefined || String(val).trim() === '') {
      if (!missingVariables.includes(rawKey)) {
        missingVariables.push(rawKey);
      }
    }
  }

  return { usedVariables, missingVariables, hasObfuscationSyntax };
}

/**
 * Tạo nội dung tin nhắn hoàn chỉnh cho 1 khách hàng (chỉ thay thế biến cá nhân hóa, không trộn spintax né spam).
 * @param {string} template Mẫu tin nhắn chuẩn
 * @param {object} contact Thông tin liên hệ
 * @param {object} options Tùy chọn (useCustomMessageFirst: ưu tiên nội dung riêng nếu có)
 * @returns {string}
 */
function renderMessage(template, contact = {}, options = { useCustomMessageFirst: true }) {
  let baseText = template || '';
  if (options.useCustomMessageFirst && contact.customMessage && String(contact.customMessage).trim()) {
    baseText = String(contact.customMessage).trim();
  }

  const variables = buildVariablesMap(contact);

  const result = String(baseText).replace(/\{([^{}]+)\}/g, (match, rawKey) => {
    const key = rawKey.trim();
    if (key.includes('|')) {
      // Nếu còn sót mẫu cũ dạng {a|b}, chỉ lấy phương án đầu tiên mang tính chuẩn hóa, không random né lọc.
      return key.split('|')[0].trim();
    }
    const lowerKey = key.toLowerCase();
    const slugKey = slugifyKey(lowerKey);

    if (variables[key] !== undefined) return String(variables[key]);
    if (variables[lowerKey] !== undefined) return String(variables[lowerKey]);
    if (variables[slugKey] !== undefined) return String(variables[slugKey]);
    return match;
  });

  return result.trim();
}

module.exports = {
  renderMessage,
  inspectTemplate,
  buildVariablesMap,
  slugifyKey
};
