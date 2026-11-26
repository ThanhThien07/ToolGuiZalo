const express = require('express');
const multer = require('multer');
const router = express.Router();

const storage = require('../storage');
const zaloBot = require('../zaloBot');
const p2pSync = require('../p2pSync');
const contactRepo = require('../db/repositories/contactRepo');
const { settingsRepo, accountRepo } = require('../db/repositories/accountRepo');
const conversationRepo = require('../db/repositories/conversationRepo');
const reportService = require('../services/reportService');
const { normalizePhone } = require('../phoneUtils');
const { renderMessage } = require('../templateEngine');
const { validateUploadedImage, validateSpreadsheetUpload } = require('../utils/excelSecurity');
const { requireAuth, requirePermission } = require('../middleware/security');
const sseHub = require('../realtime/sseHub');
const { getConfig } = require('../config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Adapter Tương thích API V1 (`/api/*`):
 * Bảo vệ bằng xác thực & RBAC trên mọi endpoint nhạy cảm để không bị lọt qua cửa V1!
 */

router.get('/events', requireAuth, (req, res) => {
  sseHub.subscribe(req, res, { status: zaloBot.getStatus() });
});

router.get('/state', requireAuth, (req, res) => {
  res.json({
    ok: true,
    status: zaloBot.getStatus(),
    settings: settingsRepo.getAppSettings(),
    accounts: accountRepo.list(),
    activeAccountId: accountRepo.getActive()?.id || 'acc_default',
    contacts: contactRepo.getAll(),
    logs: storage.getLogs(100)
  });
});

router.post('/settings', requireAuth, requirePermission('campaigns:write'), (req, res) => {
  const settings = settingsRepo.updateAppSettings(req.body || {});
  res.json({ ok: true, settings });
});

function handleImageUpload(req, res) {
  const cfg = getConfig();
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: { code: 'NO_FILES', message: 'Chưa chọn ảnh.' } });
  fs.mkdirSync(cfg.imagesDir, { recursive: true });
  for (const f of files) {
    const v = validateUploadedImage(f, cfg.maxUploadImageBytes);
    if (!v.ok) return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: v.error } });
    const id = `img_${crypto.randomUUID()}`;
    const storedName = `${id}${v.ext}`;
    const dest = path.join(cfg.imagesDir, storedName);
    fs.writeFileSync(dest, f.buffer);
    settingsRepo.addAttachment({
      id,
      originalName: v.safeOriginalName,
      storedName,
      filePath: dest,
      mimeType: v.mimeType,
      sizeBytes: f.buffer.length,
      sha256: crypto.createHash('sha256').update(f.buffer).digest('hex')
    });
  }
  const list = settingsRepo.listAttachments();
  res.json({ ok: true, attachedImages: list, images: list });
}

router.post('/images/upload', requireAuth, requirePermission('templates:write'), upload.array('images', 10), handleImageUpload);
router.post('/images', requireAuth, requirePermission('templates:write'), upload.array('images', 10), handleImageUpload);

router.delete('/images/:id', requireAuth, requirePermission('templates:write'), (req, res) => {
  const { removed, remaining } = settingsRepo.removeAttachment(req.params.id);
  if (removed && removed.file_path && fs.existsSync(removed.file_path)) {
    try {
      fs.unlinkSync(removed.file_path);
    } catch {}
  }
  res.json({ ok: true, attachedImages: remaining, images: remaining });
});

router.delete('/images', requireAuth, requirePermission('templates:write'), (req, res) => {
  const removed = settingsRepo.clearAttachments();
  for (const r of removed) {
    if (r.file_path && fs.existsSync(r.file_path)) {
      try {
        fs.unlinkSync(r.file_path);
      } catch {}
    }
  }
  res.json({ ok: true, attachedImages: [], images: [] });
});

router.post('/accounts', requireAuth, requirePermission('accounts:operate'), (req, res) => {
  const acc = accountRepo.create({ name: req.body?.name });
  res.json({ ok: true, account: acc, accounts: accountRepo.list() });
});

router.post('/accounts/switch', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    const { accountId, launch = false } = req.body || {};
    const target = accountRepo.setActive(accountId);
    if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' } });
    zaloBot.viewingAccountId = target.id;
    if (launch) await zaloBot.launchBrowser(target.id, { makeActive: true });
    res.json({ ok: true, status: zaloBot.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/accounts/launch-all', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    res.json({ ok: true, status: await zaloBot.launchAllAccounts() });
  } catch (err) {
    next(err);
  }
});

router.delete('/accounts/:id', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    await zaloBot.closeBrowser(req.params.id).catch(() => {});
    res.json({ ok: true, accounts: accountRepo.delete(req.params.id), status: zaloBot.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/preview-message', requireAuth, (req, res) => {
  const { template, contact, useCustomMessageFirst } = req.body || {};
  const sampleContact = contact || contactRepo.getAll()[0] || { phone: '0912345678', name: 'Nguyễn Văn An', info: 'Đơn #DH2026' };
  const rendered = renderMessage(template ?? settingsRepo.getAppSettings().template, sampleContact, {
    useCustomMessageFirst: useCustomMessageFirst ?? true
  });
  res.json({ ok: true, rendered, sampleContact });
});

router.post('/contacts/import-text', requireAuth, requirePermission('contacts:write'), (req, res) => {
  const { text, deduplicate = true, replaceExisting = false } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: { code: 'EMPTY_TEXT', message: 'Vui lòng nhập danh sách SĐT.' } });
  }
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records = lines.map((line) => {
    const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const [rawPhone = '', name = '', info = '', customMessage = '', note = ''] = line.split(sep).map((p) => p.trim());
    const check = normalizePhone(rawPhone);
    return {
      phone: check.normalized || rawPhone,
      rawPhone,
      name,
      info,
      customMessage,
      note,
      status: check.isValid ? 'PENDING' : 'SAI_SO',
      reason: check.isValid ? 'Đang chờ xử lý' : check.error || 'Sai định dạng SĐT'
    };
  });
  const resBatch = contactRepo.importBatch(records, { deduplicate, replaceExisting });
  const count = resBatch.addedCount + resBatch.updatedCount;
  res.json({ ok: true, added: count, addedCount: count, contacts: contactRepo.getAll(), stats: resBatch.stats });
});

function handleSpreadsheetImport(req, res, next) {
  try {
    const cfg = getConfig();
    const check = validateSpreadsheetUpload(req.file, cfg.maxImportBytes);
    if (!check.ok) return res.status(400).json({ error: { code: 'INVALID_UPLOAD', message: check.error } });
    const records = reportService.parseSpreadsheetToContacts(req.file.buffer);
    const resBatch = contactRepo.importBatch(records, {
      deduplicate: req.body.deduplicate !== 'false',
      replaceExisting: req.body.replaceExisting === 'true'
    });
    const count = resBatch.addedCount + resBatch.updatedCount;
    res.json({ ok: true, added: count, addedCount: count, contacts: contactRepo.getAll(), stats: resBatch.stats });
  } catch (err) {
    next(err);
  }
}

router.post('/contacts/import-file', requireAuth, requirePermission('contacts:write'), upload.single('file'), handleSpreadsheetImport);
router.post('/contacts/import-excel', requireAuth, requirePermission('contacts:write'), upload.single('file'), handleSpreadsheetImport);

router.get('/contacts/sample-excel', requireAuth, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Sach_Gui_Zalo.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(reportService.buildSampleWorkbookBuffer());
});

router.patch('/contacts/:id', requireAuth, requirePermission('contacts:write'), (req, res) => {
  const updated = contactRepo.updateContact(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy liên hệ.' } });
  res.json({ ok: true, contact: updated, stats: contactRepo.getStats() });
});

router.post('/contacts/reset', requireAuth, requirePermission('contacts:write'), (req, res) => {
  contactRepo.resetStatus(req.body?.filterStatus || 'ALL');
  res.json({ ok: true, contacts: contactRepo.getAll(), stats: contactRepo.getStats() });
});

router.delete('/contacts/:id', requireAuth, requirePermission('contacts:write'), (req, res) => {
  contactRepo.deleteContact(req.params.id, req.user.username);
  res.json({ ok: true, contacts: contactRepo.getAll(), stats: contactRepo.getStats() });
});

router.delete('/contacts', requireAuth, requirePermission('contacts:write'), (req, res) => {
  contactRepo.clearAll(req.user.username);
  res.json({ ok: true, contacts: [], stats: contactRepo.getStats() });
});

router.delete('/cache', requireAuth, requirePermission('contacts:write'), (req, res) => {
  contactRepo.clearPhoneCache();
  res.json({ ok: true, stats: contactRepo.getStats() });
});

router.get('/reports/export-excel', requireAuth, requirePermission('reports:export'), (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="Bao_Cao_Zalo_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(reportService.buildContactsReportWorkbookBuffer());
});

router.get('/reports/export-replies-excel', requireAuth, requirePermission('reports:export'), (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="Bao_Cao_Khach_Phan_Hoi_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(reportService.buildRepliesReportWorkbookBuffer());
});

// Nhạy cảm: BẮT BUỘC auth + permission
router.post('/browser/open', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    res.json({ ok: true, status: await zaloBot.launchBrowser(req.body?.accountId, { makeActive: false, setViewing: true }) });
  } catch (err) {
    next(err);
  }
});

router.get('/browser/screenshot', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    const shot = await zaloBot.getLiveScreenshot(null, true);
    res.json(shot ? { ok: true, active: true, ...shot } : { ok: true, active: false });
  } catch (err) {
    next(err);
  }
});

router.post('/browser/click', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    await zaloBot.clickOnPage(req.body?.xRatio, req.body?.yRatio);
    const shot = await zaloBot.getLiveScreenshot(null, true);
    res.json({ ok: true, ...(shot || {}) });
  } catch (err) {
    next(err);
  }
});

router.post('/browser/reload', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    await zaloBot.reloadZaloPage();
    const shot = await zaloBot.getLiveScreenshot(null, true);
    res.json({ ok: true, ...(shot || {}) });
  } catch (err) {
    next(err);
  }
});

router.post('/browser/close', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    if (req.body?.all) await zaloBot.closeAllBrowsers();
    else await zaloBot.closeBrowser(req.body?.accountId);
    res.json({ ok: true, status: zaloBot.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/browser/open-chat', requireAuth, requirePermission('conversations:write'), async (req, res, next) => {
  try {
    res.json({ ok: true, status: await zaloBot.openChat(req.body?.accountId, req.body?.phone, req.body?.contactName) });
  } catch (err) {
    next(err);
  }
});

router.post('/campaign/start', requireAuth, requirePermission('campaigns:run'), async (req, res, next) => {
  try {
    res.json({ ok: true, status: await zaloBot.startCampaign(req.body || {}) });
  } catch (err) {
    next(err);
  }
});

router.post('/campaign/pause', requireAuth, requirePermission('campaigns:run'), (req, res) => {
  res.json({ ok: true, status: zaloBot.pauseCampaign() });
});

router.get('/replies', requireAuth, requirePermission('conversations:read'), (req, res) => {
  const { items } = conversationRepo.list({ limit: 500 });
  res.json({ ok: true, replies: items });
});

router.post('/replies/check', requireAuth, requirePermission('conversations:read'), async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await zaloBot.checkReplies(req.body?.accountId)) });
  } catch (err) {
    next(err);
  }
});

router.post('/replies/seen', requireAuth, requirePermission('conversations:write'), (req, res) => {
  conversationRepo.markRead(req.body?.contactId || null);
  res.json({ ok: true });
});

router.get('/sync/info', requireAuth, (req, res) => {
  res.json({ ok: true, ...p2pSync.getInfo() });
});

module.exports = router;
