const XLSX = require('xlsx');
const { normalizePhone } = require('../phoneUtils');
const { sanitizeSpreadsheetRow } = require('../utils/excelSecurity');
const contactRepo = require('../db/repositories/contactRepo');
const conversationRepo = require('../db/repositories/conversationRepo');

const DEFAULT_PATTERNS = {
  phone: ['sdt', 'so dien thoai', 'dien thoai', 'phone', 'mobile', 'tel', 'zalo'],
  name: ['ten', 'ho ten', 'khach hang', 'name', 'fullname', 'nguoi nhan'],
  info: ['thong tin', 'info', 'ma don', 'don hang', 'san pham', 'dich vu', 'du lieu'],
  customMessage: ['noi dung', 'tin nhan', 'message', 'content', 'loi nhan'],
  note: ['ghi chu', 'note', 'nhan xet']
};

function cleanHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function detectColumnMapping(headers = []) {
  const find = (patterns, fallbackIdx) => {
    for (const h of headers) {
      const c = cleanHeader(h);
      if (patterns.some((p) => c.includes(p))) return h;
    }
    return headers[fallbackIdx] || '';
  };
  return {
    phone: find(DEFAULT_PATTERNS.phone, 0),
    name: find(DEFAULT_PATTERNS.name, 1),
    info: find(DEFAULT_PATTERNS.info, 2),
    customMessage: find(DEFAULT_PATTERNS.customMessage, 3),
    note: find(DEFAULT_PATTERNS.note, 4)
  };
}

function previewSpreadsheetBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return {
    sheetNames: wb.SheetNames,
    activeSheet: sheetName,
    totalRows: rows.length,
    headers,
    suggestedMapping: detectColumnMapping(headers),
    previewRows: rows.slice(0, 10)
  };
}

function parseSpreadsheetToContacts(buffer, mapping = null) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) {
    throw new Error('File Excel/CSV không có dữ liệu.');
  }
  const headers = Object.keys(rows[0]);
  const resolvedMap = mapping && mapping.phone ? mapping : detectColumnMapping(headers);

  const records = [];
  for (const row of rows) {
    const rawPhone = row[resolvedMap.phone];
    if (!String(rawPhone ?? '').trim()) continue;
    const check = normalizePhone(rawPhone);
    records.push({
      phone: check.normalized || String(rawPhone || '').trim(),
      rawPhone: String(rawPhone || '').trim(),
      name: String((resolvedMap.name && row[resolvedMap.name]) || '').trim(),
      info: String((resolvedMap.info && row[resolvedMap.info]) || '').trim(),
      customMessage: String((resolvedMap.customMessage && row[resolvedMap.customMessage]) || '').trim(),
      note: String((resolvedMap.note && row[resolvedMap.note]) || '').trim(),
      extraFields: row,
      status: check.isValid ? 'PENDING' : 'SAI_SO',
      reason: check.isValid ? 'Đang chờ xử lý' : check.error || 'Sai định dạng SĐT'
    });
  }
  return records;
}

function buildSampleWorkbookBuffer() {
  const sampleRows = [
    sanitizeSpreadsheetRow({
      SDT: '0912345678',
      Ten: 'Nguyễn Văn An',
      Thong_Tin: 'Đơn hàng #DH101 - Giao ngày 15/11',
      Noi_Dung_Rieng: '',
      Ghi_Chu: 'Khách thân thiết'
    }),
    sanitizeSpreadsheetRow({
      SDT: '84987654323',
      Ten: 'Trần Thị Bình',
      Thong_Tin: 'Mã ưu đãi VIP50 giảm 50%',
      Noi_Dung_Rieng: 'Chào chị {ten}, gửi chị thông tin riêng: {thong_tin} nhé!',
      Ghi_Chu: 'Ưu tiên gửi sáng'
    }),
    sanitizeSpreadsheetRow({
      SDT: '0905112230',
      Ten: 'Lê Hoàng Nam',
      Thong_Tin: 'Lịch hẹn tư vấn lúc 14h00',
      Noi_Dung_Rieng: '',
      Ghi_Chu: ''
    })
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 35 }, { wch: 45 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Danh_Sach_Gui_Zalo');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildContactsReportWorkbookBuffer() {
  const contacts = contactRepo.getAll();
  const statusLabel = (s) =>
    ({
      THANH_CONG: 'Đã gửi thành công',
      CHAN_NGUOI_LA: 'Bị chặn người lạ',
      KHONG_DANG_KY: 'Chưa đăng ký Zalo / Chặn tìm kiếm',
      SAI_SO: 'Sai định dạng SĐT',
      OPTED_OUT: 'Từ chối nhận tin (Opt-out)',
      REVIEW: 'Cần kiểm duyệt thủ công',
      PENDING: 'Chưa xử lý'
    })[s] || 'Lỗi khác';

  const formatRow = (c, index) =>
    sanitizeSpreadsheetRow({
      STT: index + 1,
      SDT_Chuan: c.phone,
      SDT_Goc: c.rawPhone,
      Ten_Khach_Hang: c.name,
      Ten_Zalo_Tim_Thay: c.zaloName || '',
      Consent: c.consentStatus || 'UNKNOWN',
      Tai_Khoan_Zalo_Gui: c.sentByAccount || '',
      Thong_Tin_Gan: c.info || '',
      Trang_Thai_Ma: c.status,
      Ket_Qua_Phan_Loai: statusLabel(c.status),
      Chi_Tiet_Phan_Hoi: c.reason || '',
      Noi_Dung_Da_Gui: c.sentMessage || c.customMessage || '',
      Ghi_Chu: c.note || '',
      Cap_Nhat_Luc: c.updatedAt ? new Date(c.updatedAt).toLocaleString('vi-VN') : ''
    });

  const wb = XLSX.utils.book_new();
  const appendSheet = (rows, name) => {
    const safeRows = rows.length ? rows : [sanitizeSpreadsheetRow({ STT: '', SDT_Chuan: 'Không có dữ liệu trong mục này' })];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  appendSheet(contacts.map(formatRow), '1_Tong_Hop');
  appendSheet(contacts.filter((c) => c.status === 'CHAN_NGUOI_LA').map(formatRow), '2_Bi_Chan_Nguoi_La');
  appendSheet(contacts.filter((c) => c.status === 'KHONG_DANG_KY').map(formatRow), '3_Chua_Dang_Ky_Zalo');
  appendSheet(contacts.filter((c) => c.status === 'THANH_CONG').map(formatRow), '4_Gui_Thanh_Cong');
  appendSheet(
    contacts.filter((c) => ['SAI_SO', 'LOI', 'REVIEW'].includes(c.status)).map(formatRow),
    '5_Sai_So_Loi_Review'
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildRepliesReportWorkbookBuffer() {
  const { items } = conversationRepo.list({ limit: 5000, offset: 0 });
  const rows = items.map((c, idx) =>
    sanitizeSpreadsheetRow({
      STT: idx + 1,
      Conversation_ID: c.id,
      Match_Status: c.matchStatus,
      SDT: c.phone || 'Chưa liên kết',
      Ten_Khach_Hang: c.customerName || '',
      Tai_Khoan_Zalo: c.accountName || c.accountId || '',
      Noi_Dung_Cuoi: c.lastMessageText || '',
      Thoi_Gian_Cuoi: c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('vi-VN') : ''
    })
  );
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length ? rows : [sanitizeSpreadsheetRow({ Thong_Bao: 'Chưa có phản hồi nào' })]
  );
  XLSX.utils.book_append_sheet(wb, ws, 'Khach_Phan_Hoi');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  detectColumnMapping,
  previewSpreadsheetBuffer,
  parseSpreadsheetToContacts,
  buildSampleWorkbookBuffer,
  buildContactsReportWorkbookBuffer,
  buildRepliesReportWorkbookBuffer
};
