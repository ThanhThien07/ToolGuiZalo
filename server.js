const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');

const { normalizePhone } = require('./src/phoneUtils');
const { renderMessage } = require('./src/templateEngine');
const storage = require('./src/storage');
const zaloBot = require('./src/zaloBot');

const app = express();
const PORT = process.env.PORT || 3000;

const IMAGES_DIR = path.join(__dirname, 'uploads', 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  })
);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const upload = multer({ storage: multer.memoryStorage() });

// Quản lý kết nối SSE (Server-Sent Events) cho giao diện thời gian thực
const sseClients = new Set();

function broadcastSSE(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

zaloBot.on('status', (status) => broadcastSSE('status', status));
zaloBot.on('contact_updated', (contact) => broadcastSSE('contact_updated', contact));
zaloBot.on('contacts_replaced', (contacts) => broadcastSSE('contacts_replaced', contacts));
zaloBot.on('log', (entry) => broadcastSSE('log', entry));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: status\ndata: ${JSON.stringify(zaloBot.getStatus())}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Lấy toàn bộ trạng thái hiện tại
app.get('/api/state', (req, res) => {
  res.json({
    status: zaloBot.getStatus(),
    settings: storage.getSettings(),
    accounts: storage.getAccounts(),
    activeAccountId: storage.getActiveAccount().id,
    contacts: storage.getContacts(),
    logs: storage.state.logs.slice(-100)
  });
});

// Cập nhật cấu hình & mẫu tin nhắn
app.post('/api/settings', (req, res) => {
  const updated = storage.updateSettings(req.body || {});
  broadcastSSE('status', zaloBot.getStatus());
  res.json({ ok: true, settings: updated });
});

// Upload ảnh đính kèm cho tin nhắn (1 hoặc nhiều ảnh)
app.post('/api/images/upload', upload.array('images', 10), (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'Chưa chọn file hình ảnh nào.' });
    }

    const currentImages = Array.isArray(storage.getSettings().attachedImages)
      ? [...storage.getSettings().attachedImages]
      : [];

    for (const file of files) {
      const ext = path.extname(file.originalname || '.png') || '.png';
      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const fileName = `${id}${ext}`;
      const filePath = path.join(IMAGES_DIR, fileName);
      fs.writeFileSync(filePath, file.buffer);

      currentImages.push({
        id,
        name: file.originalname || fileName,
        url: `/uploads/images/${fileName}`,
        filePath,
        mimeType: file.mimetype || 'image/png'
      });
    }

    const updatedSettings = storage.updateSettings({ attachedImages: currentImages });
    zaloBot.log(
      'info',
      `🖼️ Đã gán thêm ${files.length} ảnh vào mẫu tin nhắn (Tổng: ${currentImages.length} ảnh).`
    );
    res.json({ ok: true, attachedImages: updatedSettings.attachedImages });
  } catch (err) {
    res.status(500).json({ error: `Lỗi tải ảnh lên: ${err.message}` });
  }
});

// Xóa 1 ảnh đính kèm
app.delete('/api/images/:id', (req, res) => {
  const id = req.params.id;
  const currentImages = Array.isArray(storage.getSettings().attachedImages)
    ? storage.getSettings().attachedImages
    : [];
  const target = currentImages.find((img) => img.id === id);
  if (target && target.filePath && fs.existsSync(target.filePath)) {
    try {
      fs.unlinkSync(target.filePath);
    } catch {
      // ignore
    }
  }
  const remaining = currentImages.filter((img) => img.id !== id);
  storage.updateSettings({ attachedImages: remaining });
  res.json({ ok: true, attachedImages: remaining });
});

// Xóa toàn bộ ảnh đính kèm
app.delete('/api/images', (req, res) => {
  const currentImages = Array.isArray(storage.getSettings().attachedImages)
    ? storage.getSettings().attachedImages
    : [];
  for (const img of currentImages) {
    if (img.filePath && fs.existsSync(img.filePath)) {
      try {
        fs.unlinkSync(img.filePath);
      } catch {
        // ignore
      }
    }
  }
  storage.updateSettings({ attachedImages: [] });
  res.json({ ok: true, attachedImages: [] });
});

// Quản lý Đa Tài Khoản Zalo
app.post('/api/accounts', (req, res) => {
  const { name } = req.body || {};
  const acc = storage.addAccount(name);
  zaloBot.log('info', `➕ Đã thêm tài khoản mới: "${acc.name}".`);
  res.json({ ok: true, account: acc, accounts: storage.getAccounts() });
});

app.post('/api/accounts/switch', async (req, res) => {
  try {
    const { accountId, launch = false } = req.body || {};
    if (launch) {
      const status = await zaloBot.switchAccount(accountId);
      return res.json({ ok: true, status });
    }
    const target = storage.setActiveAccount(accountId);
    if (!target) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
    }
    zaloBot.viewingAccountId = target.id;
    zaloBot.launchBrowser(target.id, { makeActive: true }).catch(() => {});
    zaloBot.log('info', `✅ Đã chọn tài khoản gửi chính: "${target.name}".`);
    res.json({ ok: true, status: zaloBot.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/launch-all', async (req, res) => {
  try {
    const status = await zaloBot.launchAllAccounts();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await zaloBot.closeBrowser(id);
    const accounts = storage.deleteAccount(id);
    broadcastSSE('status', zaloBot.getStatus());
    res.json({ ok: true, accounts, status: zaloBot.getStatus() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Xem trước nội dung tin nhắn sau khi trộn biến + Spintax
app.post('/api/preview-message', (req, res) => {
  const { template, contact, useCustomMessageFirst } = req.body || {};
  const sampleContact = contact ||
    storage.getContacts()[0] || {
      phone: '0912345678',
      name: 'Nguyễn Văn An',
      info: 'Đơn hàng #DH2026 - Giao ngày 15/11',
      note: 'Khách VIP',
      customMessage: ''
    };
  const rendered = renderMessage(
    template ?? storage.getSettings().template,
    sampleContact,
    { useCustomMessageFirst: useCustomMessageFirst ?? true }
  );
  res.json({ ok: true, rendered, sampleContact });
});

function buildContactRecord({ rawPhone, name, info, customMessage, note, extraFields = {} }) {
  const check = normalizePhone(rawPhone);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phone: check.normalized || String(rawPhone || '').trim(),
    rawPhone: String(rawPhone || '').trim(),
    name: String(name || '').trim(),
    info: String(info || '').trim(),
    customMessage: String(customMessage || '').trim(),
    note: String(note || '').trim(),
    extraFields,
    zaloName: '',
    sentMessage: '',
    status: check.isValid ? 'PENDING' : 'SAI_SO',
    reason: check.isValid ? 'Đang chờ xử lý' : check.error || 'Sai định dạng SĐT',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// Nhập danh sách từ khung văn bản (mỗi dòng: SĐT | Tên | Thông tin | Nội dung riêng)
app.post('/api/contacts/import-text', (req, res) => {
  const { text, deduplicate = true, replaceExisting = false } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập danh sách số điện thoại.' });
  }

  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const parsedContacts = lines.map((line) => {
    let parts;
    if (line.includes('|')) {
      parts = line.split('|').map((p) => p.trim());
    } else if (line.includes('\t')) {
      parts = line.split('\t').map((p) => p.trim());
    } else if (line.includes(';')) {
      parts = line.split(';').map((p) => p.trim());
    } else {
      parts = line.split(',').map((p) => p.trim());
    }

    const [rawPhone = '', name = '', info = '', customMessage = '', note = ''] = parts;
    return buildContactRecord({ rawPhone, name, info, customMessage, note });
  });

  if (replaceExisting) {
    storage.clearContacts();
  }
  const { contacts, addedOrResetCount } = storage.appendContacts(parsedContacts, deduplicate);
  zaloBot.log(
    'info',
    `Đã nạp/đặt lại ${addedOrResetCount} SĐT về trạng thái Chờ xử lý (Tổng danh sách: ${contacts.length} dòng).`
  );
  res.json({ ok: true, added: addedOrResetCount, contacts, stats: storage.getStats() });
});

// Upload file Excel (.xlsx, .xls, .csv)
app.post('/api/contacts/import-file', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Không tìm thấy file tải lên.' });
    }

    const deduplicate = req.body.deduplicate !== 'false';
    const replaceExisting = req.body.replaceExisting === 'true';

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rows.length) {
      return res.status(400).json({ error: 'File Excel/CSV không có dữ liệu.' });
    }

    const parsedContacts = [];

    for (const row of rows) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;

      const findCol = (patterns) => {
        for (const k of keys) {
          const clean = k
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .trim();
          if (patterns.some((p) => clean.includes(p))) {
            return row[k];
          }
        }
        return undefined;
      };

      const rawPhone =
        findCol(['sdt', 'so dien thoai', 'dien thoai', 'phone', 'mobile', 'tel', 'zalo']) ??
        row[keys[0]];
      const name =
        findCol(['ten', 'ho ten', 'khach hang', 'name', 'fullname', 'nguoi nhan']) ??
        (keys[1] ? row[keys[1]] : '');
      const info =
        findCol(['thong tin', 'info', 'ma don', 'don hang', 'san pham', 'dich vu', 'du lieu']) ??
        (keys[2] ? row[keys[2]] : '');
      const customMessage =
        findCol(['noi dung', 'tin nhan', 'message', 'content', 'loi nhan']) ??
        (keys[3] ? row[keys[3]] : '');
      const note =
        findCol(['ghi chu', 'note', 'nhan xet']) ?? (keys[4] ? row[keys[4]] : '');

      if (!String(rawPhone ?? '').trim()) continue;

      parsedContacts.push(
        buildContactRecord({
          rawPhone,
          name,
          info,
          customMessage,
          note,
          extraFields: row
        })
      );
    }

    if (replaceExisting) {
      storage.clearContacts();
    }

    const { contacts, addedOrResetCount } = storage.appendContacts(parsedContacts, deduplicate);
    zaloBot.log(
      'info',
      `Đã nhập file "${req.file.originalname}" (${addedOrResetCount} SĐT sẵn sàng gửi, tổng danh sách: ${contacts.length}).`
    );

    res.json({
      ok: true,
      added: addedOrResetCount,
      contacts,
      stats: storage.getStats()
    });
  } catch (err) {
    res.status(500).json({ error: `Lỗi đọc file Excel: ${err.message}` });
  }
});

// Tải file Excel mẫu
app.get('/api/contacts/sample-excel', (req, res) => {
  const sampleRows = [
    {
      SDT: '0912345678',
      Ten: 'Nguyễn Văn An',
      Thong_Tin: 'Đơn hàng #DH101 - Giao ngày 15/11',
      Noi_Dung_Rieng: '',
      Ghi_Chu: 'Khách thân thiết'
    },
    {
      SDT: '84987654323',
      Ten: 'Trần Thị Bình',
      Thong_Tin: 'Mã ưu đãi VIP50 giảm 50%',
      Noi_Dung_Rieng: 'Chào chị {ten}, gửi chị thông tin riêng: {thong_tin} nhé!',
      Ghi_Chu: 'Ưu tiên gửi sáng'
    },
    {
      SDT: '0905112230',
      Ten: 'Lê Hoàng Nam',
      Thong_Tin: 'Lịch hẹn tư vấn lúc 14h00',
      Noi_Dung_Rieng: '',
      Ghi_Chu: ''
    }
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [{ wch: 15 }, { wch: 22 }, { wch: 35 }, { wch: 45 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Danh_Sach_Gui_Zalo');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="Mau_Danh_Sach_Gui_Zalo.xlsx"'
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
});

// Xuất báo cáo Excel phân loại chi tiết
app.get('/api/reports/export-excel', (req, res) => {
  const contacts = storage.getContacts();

  const formatRow = (c, index) => ({
    STT: index + 1,
    SDT_Chuan: c.phone,
    SDT_Goc: c.rawPhone,
    Ten_Khach_Hang: c.name,
    Ten_Zalo_Tim_Thay: c.zaloName || '',
    Tai_Khoan_Zalo_Gui: c.sentByAccount || '',
    Thong_Tin_Gan: c.info || '',
    Trang_Thai_Ma: c.status,
    Ket_Qua_Phan_Loai:
      c.status === 'THANH_CONG'
        ? 'Đã gửi thành công'
        : c.status === 'CHAN_NGUOI_LA'
        ? 'Bị chặn người lạ'
        : c.status === 'KHONG_DANG_KY'
        ? 'Chưa đăng ký Zalo / Chặn tìm kiếm'
        : c.status === 'SAI_SO'
        ? 'Sai định dạng SĐT'
        : c.status === 'PENDING'
        ? 'Chưa xử lý'
        : 'Lỗi khác',
    Chi_Tiet_Phan_Hoi: c.reason || '',
    Noi_Dung_Da_Gui: c.sentMessage || c.customMessage || '',
    Ghi_Chu: c.note || '',
    Cap_Nhat_Luc: c.updatedAt
      ? new Date(c.updatedAt).toLocaleString('vi-VN')
      : ''
  });

  const allRows = contacts.map(formatRow);
  const blockedRows = contacts
    .filter((c) => c.status === 'CHAN_NGUOI_LA')
    .map(formatRow);
  const notRegisteredRows = contacts
    .filter((c) => c.status === 'KHONG_DANG_KY')
    .map(formatRow);
  const successRows = contacts
    .filter((c) => c.status === 'THANH_CONG')
    .map(formatRow);
  const errorOrInvalidRows = contacts
    .filter((c) => c.status === 'SAI_SO' || c.status === 'LOI')
    .map(formatRow);

  const wb = XLSX.utils.book_new();

  const appendSheetWithWidth = (rows, sheetName) => {
    const data =
      rows.length > 0
        ? rows
        : [
            {
              STT: '',
              SDT_Chuan: 'Không có dữ liệu trong mục này',
              Ten_Khach_Hang: '',
              Ket_Qua_Phan_Loai: '',
              Chi_Tiet_Phan_Hoi: ''
            }
          ];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 15 },
      { wch: 14 },
      { wch: 22 },
      { wch: 22 },
      { wch: 30 },
      { wch: 16 },
      { wch: 28 },
      { wch: 42 },
      { wch: 45 },
      { wch: 18 },
      { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  appendSheetWithWidth(allRows, '1_Tong_Hop');
  appendSheetWithWidth(blockedRows, '2_Bi_Chan_Nguoi_La');
  appendSheetWithWidth(notRegisteredRows, '3_Chua_Dang_Ky_Zalo');
  appendSheetWithWidth(successRows, '4_Gui_Thanh_Cong');
  appendSheetWithWidth(errorOrInvalidRows, '5_Sai_So_Hoac_Loi');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const timestamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Bao_Cao_Zalo_${timestamp}.xlsx"`
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
});

app.post('/api/contacts/reset', (req, res) => {
  const { filterStatus = 'ALL' } = req.body || {};
  const contacts = storage.resetContactsStatus(filterStatus);
  zaloBot.log('info', `Đã đặt lại trạng thái danh sách (${filterStatus}) về Chờ xử lý.`);
  res.json({ ok: true, contacts, stats: storage.getStats() });
});

app.delete('/api/contacts', (req, res) => {
  if (zaloBot.campaignState === 'RUNNING') {
    return res.status(400).json({ error: 'Vui lòng tạm dừng chiến dịch trước khi xóa danh sách.' });
  }
  storage.clearContacts();
  zaloBot.log('warning', 'Đã xóa toàn bộ danh sách số điện thoại.');
  res.json({ ok: true, contacts: [], stats: storage.getStats() });
});

app.delete('/api/contacts/:id', (req, res) => {
  const id = req.params.id;
  const filtered = storage.getContacts().filter((c) => c.id !== id);
  storage.setContacts(filtered);
  broadcastSSE('status', zaloBot.getStatus());
  res.json({ ok: true, contacts: filtered, stats: storage.getStats() });
});

app.delete('/api/cache', (req, res) => {
  storage.clearCache();
  zaloBot.log('info', 'Đã xóa bộ nhớ Cache lịch sử kiểm tra SĐT.');
  res.json({ ok: true, stats: storage.getStats() });
});

app.post('/api/browser/open', async (req, res) => {
  try {
    const { accountId } = req.body || {};
    const status = await zaloBot.launchBrowser(accountId, { makeActive: false, setViewing: true });
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/browser/screenshot', async (req, res) => {
  try {
    const shot = await zaloBot.getLiveScreenshot();
    if (!shot) {
      return res.json({ ok: false, active: false });
    }
    res.json({ ok: true, active: true, ...shot });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/browser/click', async (req, res) => {
  try {
    const { xRatio, yRatio } = req.body || {};
    await zaloBot.clickOnPage(xRatio, yRatio);
    const shot = await zaloBot.getLiveScreenshot();
    res.json({ ok: true, ...(shot || {}) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/browser/reload', async (req, res) => {
  try {
    await zaloBot.reloadZaloPage();
    const shot = await zaloBot.getLiveScreenshot();
    res.json({ ok: true, ...(shot || {}) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/browser/close', async (req, res) => {
  try {
    const { accountId, all = false } = req.body || {};
    if (all) {
      await zaloBot.closeAllBrowsers();
    } else {
      await zaloBot.closeBrowser(accountId);
    }
    res.json({ ok: true, status: zaloBot.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaign/start', async (req, res) => {
  try {
    const status = await zaloBot.startCampaign(req.body || {});
    res.json({ ok: true, status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/campaign/pause', (req, res) => {
  const status = zaloBot.pauseCampaign();
  res.json({ ok: true, status });
});

// ===================== API Quản lý khách hàng phản hồi =====================

app.get('/api/replies', (req, res) => {
  const replies = storage.getContacts().filter((c) => c.hasReplied || c.replyText);
  res.json({ ok: true, replies });
});

app.post('/api/replies/check', async (req, res) => {
  try {
    const { accountId } = req.body || {};
    const result = await zaloBot.checkReplies(accountId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/:id/reply', (req, res) => {
  try {
    const contact = zaloBot.markReply(req.params.id, req.body || {});
    res.json({ ok: true, contact });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/browser/open-chat', async (req, res) => {
  try {
    const { accountId, phone } = req.body || {};
    const status = await zaloBot.openChat(accountId, phone);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/export-replies-excel', (req, res) => {
  const replies = storage.getContacts().filter((c) => c.hasReplied || c.replyText);
  const rows = replies.map((c, idx) => ({
    STT: idx + 1,
    SDT: c.phone || c.rawPhone,
    Ten_Khach_Hang: c.name || '',
    Ten_Zalo: c.zaloName || '',
    Tai_Khoan_Zalo_Nhan_Tin: c.replyByAccount || c.sentByAccount || '',
    Tin_Nhan_Da_Gui: c.sentMessage || '',
    Thoi_Gian_Gui: c.sentAt ? new Date(c.sentAt).toLocaleString('vi-VN') : '',
    Noi_Dung_Khach_Phan_Hoi: c.replyText || '',
    Thoi_Gian_Phan_Hoi: c.replyAt ? new Date(c.replyAt).toLocaleString('vi-VN') : ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0 ? rows : [{ Thong_Bao: 'Chưa có phản hồi nào' }]
  );
  ws['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 22 },
    { wch: 22 },
    { wch: 28 },
    { wch: 45 },
    { wch: 20 },
    { wch: 45 },
    { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Khach_Phan_Hoi');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const timestamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="Bao_Cao_Khach_Phan_Hoi_${timestamp}.xlsx"`
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buffer);
});

app.post('/api/replies/reset', (req, res) => {
  try {
    zaloBot.resetReplies();
    res.json({ ok: true, message: 'Đã đặt lại trạng thái phản hồi về trống' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`=====================================================`);
  console.log(`🚀 ToolGuiZalo Web App đang chạy tại: http://localhost:${PORT}`);
  console.log(`=====================================================`);
});
