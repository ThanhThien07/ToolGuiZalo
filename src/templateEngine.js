/**
 * Bộ trộn nội dung tin nhắn (Template + Spintax + Cá nhân hóa từng SĐT)
 */

/**
 * Xử lý cú pháp Spintax: "{Xin chào|Chào|Hi} {anh/chị|bạn}"
 * Hỗ trợ nhiều cụm spintax trong cùng 1 tin nhắn
 * @param {string} text
 * @returns {string}
 */
function processSpintax(text) {
  if (!text) return '';
  // Tìm các cụm {a|b|c} có chứa dấu | (để phân biệt với biến {ten})
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group) => {
    const options = group.split('|').map((s) => s.trim()).filter(Boolean);
    if (options.length === 0) return '';
    const randomIndex = Math.floor(Math.random() * options.length);
    return options[randomIndex];
  });
}

/**
 * Tạo nội dung tin nhắn hoàn chỉnh cho 1 khách hàng
 * @param {string} template Mẫu tin nhắn chung
 * @param {object} contact Thông tin liên hệ (phone, name, info, note, customMessage, extraFields...)
 * @param {object} options Tùy chọn (useCustomMessageFirst: ưu tiên cột nội dung riêng nếu có)
 * @returns {string}
 */
function renderMessage(template, contact = {}, options = { useCustomMessageFirst: true }) {
  let baseText = template || '';
  if (options.useCustomMessageFirst && contact.customMessage && String(contact.customMessage).trim()) {
    baseText = String(contact.customMessage).trim();
  }

  // Tạo bảng ánh xạ biến không phân biệt hoa thường / dấu
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

  // Bổ sung mọi cột mở rộng từ file Excel (extraFields)
  if (contact.extraFields && typeof contact.extraFields === 'object') {
    for (const [key, val] of Object.entries(contact.extraFields)) {
      const cleanKey = key.trim();
      const slugKey = cleanKey
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      variables[cleanKey] = val ?? '';
      variables[cleanKey.toLowerCase()] = val ?? '';
      if (slugKey) {
        variables[slugKey] = val ?? '';
      }
    }
  }

  // 1. Xử lý Spintax trước ({Chào|Xin chào})
  let result = processSpintax(baseText);

  // 2. Thay thế biến {ten_bien}
  result = result.replace(/\{([^{}|]+)\}/g, (match, rawKey) => {
    const key = rawKey.trim();
    const lowerKey = key.toLowerCase();
    const slugKey = lowerKey
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    if (variables[key] !== undefined) return String(variables[key]);
    if (variables[lowerKey] !== undefined) return String(variables[lowerKey]);
    if (variables[slugKey] !== undefined) return String(variables[slugKey]);
    return match;
  });

  return result.trim();
}

module.exports = {
  processSpintax,
  renderMessage
};

