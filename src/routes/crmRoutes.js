const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const contactRepo = require('../db/repositories/contactRepo');
const consentRepo = require('../db/repositories/consentRepo');
const { templateRepo, settingsRepo } = require('../db/repositories/accountRepo');
const conversationRepo = require('../db/repositories/conversationRepo');
const reportService = require('../services/reportService');
const { renderMessage, inspectTemplate } = require('../templateEngine');
const { normalizePhone } = require('../phoneUtils');
const { validateUploadedImage, validateSpreadsheetUpload } = require('../utils/excelSecurity');
const { requireAuth, requirePermission } = require('../middleware/security');
const { validateBody, s } = require('../utils/validator');
const { getConfig } = require('../config');
const sseHub = require('../realtime/sseHub');
const { recordSyncEvent } = require('../db/repositories/common');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ==================== CONTACTS ====================

router.get('/contacts', requireAuth, requirePermission('contacts:read'), (req, res) => {
  const { status = 'ALL', search = '', consent = '', tag = '', limit = 25, offset = 0, cursorUpdatedAt, cursorId } = req.query;
  const page = contactRepo.listPaginated({
    status,
    search,
    consent,
    tag,
    limit: Math.min(200, Math.max(1, Number(limit) || 25)),
    offset: Number(offset) || 0,
    cursorUpdatedAt: cursorUpdatedAt || null,
    cursorId: cursorId || null
  });
  res.json({ ok: true, ...page, stats: contactRepo.getStats(), tags: contactRepo.listTags() });
});

router.get('/contacts/tags', requireAuth, requirePermission('contacts:read'), (req, res) => {
  res.json({ ok: true, tags: contactRepo.listTags() });
});

router.get('/contacts/sample-excel', requireAuth, (req, res) => {
  const buffer = reportService.buildSampleWorkbookBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="Mau_Danh_Sach_Gui_Zalo.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post(
  '/contacts/import-text',
  requireAuth,
  requirePermission('contacts:write'),
  validateBody(
    s.object({
      text: s.string({ min: 1, max: 500000 }),
      deduplicate: s.boolean({ defaultValue: true }),
      replaceExisting: s.boolean({ defaultValue: false }),
      consentStatus: s.enum(['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'], { defaultValue: 'UNKNOWN' }),
      consentSource: s.string({ max: 120, defaultValue: 'text_import' }),
      tags: s.array(s.string({ min: 1, max: 40 }), { optional: true, defaultValue: [] })
    })
  ),
  (req, res) => {
    const { text, deduplicate, replaceExisting, consentStatus, consentSource, tags } = req.validatedBody;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

    const result = contactRepo.importBatch(records, {
      deduplicate,
      replaceExisting,
      consentStatus,
      consentSource,
      tags
    });
    sseHub.broadcast('contact.updated', result.syncEvent);
    res.json({ ok: true, ...result });
  }
);

router.post('/contacts/import-preview', requireAuth, requirePermission('contacts:write'), upload.single('file'), (req, res, next) => {
  try {
    const cfg = getConfig();
    const check = validateSpreadsheetUpload(req.file, cfg.maxImportBytes);
    if (!check.ok) {
      return res.status(400).json({ error: { code: 'INVALID_UPLOAD', message: check.error } });
    }
    const preview = reportService.previewSpreadsheetBuffer(req.file.buffer);
    res.json({ ok: true, filename: check.safeOriginalName, ...preview });
  } catch (err) {
    next(err);
  }
});

router.post('/contacts/import-file', requireAuth, requirePermission('contacts:write'), upload.single('file'), (req, res, next) => {
  try {
    const cfg = getConfig();
    const check = validateSpreadsheetUpload(req.file, cfg.maxImportBytes);
    if (!check.ok) {
      return res.status(400).json({ error: { code: 'INVALID_UPLOAD', message: check.error } });
    }
    let mapping = null;
    if (req.body.mapping) {
      try {
        mapping = JSON.parse(req.body.mapping);
      } catch {}
    }
    const records = reportService.parseSpreadsheetToContacts(req.file.buffer, mapping);
    const consentStatus = ['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'].includes(req.body.consentStatus)
      ? req.body.consentStatus
      : 'UNKNOWN';
    const tags = req.body.tags ? String(req.body.tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
    const result = contactRepo.importBatch(records, {
      deduplicate: req.body.deduplicate !== 'false',
      replaceExisting: req.body.replaceExisting === 'true',
      consentStatus,
      consentSource: req.body.consentSource || `excel:${check.safeOriginalName}`,
      tags
    });
    sseHub.broadcast('contact.updated', result.syncEvent);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/contacts/:id',
  requireAuth,
  requirePermission('contacts:write'),
  validateBody(
    s.object({
      name: s.string({ max: 120, optional: true }),
      info: s.string({ max: 500, optional: true }),
      customMessage: s.string({ max: 4000, optional: true }),
      note: s.string({ max: 1000, optional: true }),
      status: s.enum(['PENDING', 'THANH_CONG', 'CHAN_NGUOI_LA', 'KHONG_DANG_KY', 'SAI_SO', 'LOI', 'REVIEW', 'OPTED_OUT'], { optional: true }),
      reason: s.string({ max: 500, optional: true })
    })
  ),
  (req, res) => {
    const updated = contactRepo.updateContact(req.params.id, req.validatedBody);
    if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy liên hệ.' } });
    const evt = recordSyncEvent('contact.updated', 'contact', updated.id, updated.version, updated);
    sseHub.broadcast('contact.updated', evt);
    res.json({ ok: true, contact: updated, stats: contactRepo.getStats() });
  }
);

router.post(
  '/contacts/:id/tags',
  requireAuth,
  requirePermission('contacts:write'),
  validateBody(s.object({ tag: s.string({ min: 1, max: 40 }), color: s.string({ max: 20, optional: true }) })),
  (req, res) => {
    const contact = contactRepo.assignTag(req.params.id, req.validatedBody.tag, req.validatedBody.color);
    if (!contact) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy liên hệ.' } });
    res.json({ ok: true, contact });
  }
);

router.delete('/contacts/:id/tags/:tag', requireAuth, requirePermission('contacts:write'), (req, res) => {
  const contact = contactRepo.removeTag(req.params.id, req.params.tag);
  res.json({ ok: true, contact });
});

router.delete('/contacts/:id', requireAuth, requirePermission('contacts:write'), (req, res) => {
  const ok = contactRepo.deleteContact(req.params.id, req.user.username);
  res.json({ ok, stats: contactRepo.getStats() });
});

router.delete('/contacts', requireAuth, requirePermission('contacts:write'), (req, res) => {
  const cleared = contactRepo.clearAll(req.user.username);
  res.json({ ok: true, cleared, stats: contactRepo.getStats() });
});

router.post(
  '/contacts/reset',
  requireAuth,
  requirePermission('contacts:write'),
  validateBody(s.object({ filterStatus: s.string({ max: 30, defaultValue: 'ALL' }) })),
  (req, res) => {
    contactRepo.resetStatus(req.validatedBody.filterStatus);
    res.json({ ok: true, stats: contactRepo.getStats() });
  }
);

// ==================== CONSENTS & OPT-OUT ====================

router.get('/consents', requireAuth, requirePermission('consents:read'), (req, res) => {
  const { status = 'ALL', search = '', limit = 50, offset = 0 } = req.query;
  const result = consentRepo.list({ status, search, limit, offset });
  res.json({ ok: true, ...result, stats: consentRepo.getStats() });
});

router.post(
  '/consents',
  requireAuth,
  requirePermission('consents:write'),
  validateBody(
    s.object({
      phone: s.string({ min: 8, max: 20 }),
      status: s.enum(['OPTED_IN', 'OPTED_OUT', 'UNKNOWN']),
      source: s.string({ max: 120, defaultValue: 'manual_verification' }),
      scope: s.string({ max: 80, defaultValue: 'zalo_notification' }),
      note: s.string({ max: 300, defaultValue: '' })
    })
  ),
  (req, res) => {
    const check = normalizePhone(req.validatedBody.phone);
    const cleanPhone = check.normalized || req.validatedBody.phone;
    const saved = consentRepo.upsertConsent({
      ...req.validatedBody,
      phone: cleanPhone,
      actor: req.user.username
    });
    res.json({ ok: true, consent: saved, stats: consentRepo.getStats() });
  }
);

router.post(
  '/consents/bulk-opt-in',
  requireAuth,
  requirePermission('consents:write'),
  validateBody(
    s.object({
      phones: s.array(s.string({ min: 8, max: 20 }), { min: 1, max: 5000 }),
      source: s.string({ max: 120, defaultValue: 'bulk_verified_opt_in' }),
      note: s.string({ max: 300, defaultValue: '' })
    })
  ),
  (req, res) => {
    let count = 0;
    for (const raw of req.validatedBody.phones) {
      const check = normalizePhone(raw);
      const ph = check.normalized || raw;
      const existing = consentRepo.getByPhone(ph);
      if (existing && existing.status === 'OPTED_OUT') continue; // Tôn trọng danh sách Opt-out toàn hệ thống
      consentRepo.upsertConsent({
        phone: ph,
        status: 'OPTED_IN',
        source: req.validatedBody.source,
        note: req.validatedBody.note,
        actor: req.user.username
      });
      count++;
    }
    res.json({ ok: true, updated: count, stats: consentRepo.getStats() });
  }
);

// ==================== TEMPLATES & ATTACHMENTS ====================

router.get('/templates', requireAuth, requirePermission('templates:read'), (req, res) => {
  res.json({ ok: true, templates: templateRepo.list() });
});

router.post(
  '/templates',
  requireAuth,
  requirePermission('templates:write'),
  validateBody(
    s.object({
      name: s.string({ min: 1, max: 120 }),
      body: s.string({ min: 1, max: 4000 }),
      channel: s.enum(['zalo_oa', 'web_assisted', 'mock_sandbox'], { defaultValue: 'zalo_oa' }),
      isDefault: s.boolean({ defaultValue: false })
    })
  ),
  (req, res) => {
    const check = inspectTemplate(req.validatedBody.body);
    const tpl = templateRepo.create(req.validatedBody);
    res.status(201).json({ ok: true, template: tpl, inspection: check });
  }
);

router.patch(
  '/templates/:id',
  requireAuth,
  requirePermission('templates:write'),
  validateBody(
    s.object({
      name: s.string({ min: 1, max: 120, optional: true }),
      body: s.string({ min: 1, max: 4000, optional: true }),
      channel: s.enum(['zalo_oa', 'web_assisted', 'mock_sandbox'], { optional: true })
    })
  ),
  (req, res) => {
    const updated = templateRepo.update(req.params.id, req.validatedBody);
    if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy mẫu tin nhắn.' } });
    res.json({ ok: true, template: updated, inspection: inspectTemplate(updated.body) });
  }
);

router.post('/templates/:id/approve', requireAuth, requirePermission('templates:write'), (req, res) => {
  const tpl = templateRepo.approve(req.params.id, req.user.userId, req.user.username);
  if (!tpl) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy mẫu tin nhắn.' } });
  res.json({ ok: true, template: tpl });
});

router.delete('/templates/:id', requireAuth, requirePermission('templates:write'), (req, res) => {
  templateRepo.delete(req.params.id);
  res.json({ ok: true });
});

router.post('/templates/preview', requireAuth, (req, res) => {
  const { template, contact, useCustomMessageFirst } = req.body || {};
  const sampleContact = contact || {
    phone: '0912345678',
    name: 'Nguyễn Văn An',
    info: 'Đơn hàng #DH2026',
    note: 'Khách hàng đồng ý nhận tin'
  };
  const body = template ?? settingsRepo.getAppSettings().template;
  const rendered = renderMessage(body, sampleContact, { useCustomMessageFirst: useCustomMessageFirst ?? true });
  const inspection = inspectTemplate(body, sampleContact);
  res.json({ ok: true, rendered, inspection, sampleContact });
});

router.get('/attachments', requireAuth, (req, res) => {
  res.json({ ok: true, attachedImages: settingsRepo.listAttachments() });
});

router.post('/attachments/upload', requireAuth, requirePermission('templates:write'), upload.array('images', 10), (req, res) => {
  const cfg = getConfig();
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: { code: 'NO_FILES', message: 'Chưa chọn ảnh.' } });

  fs.mkdirSync(cfg.imagesDir, { recursive: true });
  for (const f of files) {
    const v = validateUploadedImage(f, cfg.maxUploadImageBytes);
    if (!v.ok) {
      return res.status(400).json({ error: { code: 'INVALID_IMAGE', message: v.error } });
    }
    const id = `img_${crypto.randomUUID()}`;
    const storedName = `${id}${v.ext}`;
    const destPath = path.join(cfg.imagesDir, storedName);
    fs.writeFileSync(destPath, f.buffer);
    const sha256 = crypto.createHash('sha256').update(f.buffer).digest('hex');
    settingsRepo.addAttachment({
      id,
      originalName: v.safeOriginalName,
      storedName,
      filePath: destPath,
      mimeType: v.mimeType,
      sizeBytes: f.buffer.length,
      sha256
    });
  }
  res.json({ ok: true, attachedImages: settingsRepo.listAttachments() });
});

router.delete('/attachments/:id', requireAuth, requirePermission('templates:write'), (req, res) => {
  const { removed, remaining } = settingsRepo.removeAttachment(req.params.id);
  if (removed && removed.file_path && fs.existsSync(removed.file_path)) {
    try {
      fs.unlinkSync(removed.file_path);
    } catch {}
  }
  res.json({ ok: true, attachedImages: remaining });
});

router.delete('/attachments', requireAuth, requirePermission('templates:write'), (req, res) => {
  const removed = settingsRepo.clearAttachments();
  for (const r of removed) {
    if (r.file_path && fs.existsSync(r.file_path)) {
      try {
        fs.unlinkSync(r.file_path);
      } catch {}
    }
  }
  res.json({ ok: true, attachedImages: [] });
});

// ==================== CONVERSATIONS & INBOX ====================

router.get('/conversations', requireAuth, requirePermission('conversations:read'), (req, res) => {
  const { accountId = 'ALL', matchStatus = 'ALL', unreadOnly = 'false', search = '', limit = 50, offset = 0 } = req.query;
  const result = conversationRepo.list({
    accountId,
    matchStatus,
    unreadOnly: unreadOnly === 'true',
    search,
    limit,
    offset
  });
  res.json({ ok: true, ...result });
});

router.get('/conversations/notifications/unread', requireAuth, requirePermission('conversations:read'), (req, res) => {
  res.json({ ok: true, notifications: conversationRepo.listUnreadNotifications() });
});

router.get('/conversations/:id/messages', requireAuth, requirePermission('conversations:read'), (req, res) => {
  const conv = conversationRepo.getById(req.params.id);
  if (!conv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy hội thoại.' } });
  const messages = conversationRepo.getMessages(req.params.id);
  res.json({ ok: true, conversation: conv, messages });
});

router.post(
  '/conversations/:id/verify',
  requireAuth,
  requirePermission('conversations:write'),
  validateBody(s.object({ contactId: s.string({ min: 1 }) })),
  (req, res, next) => {
    try {
      const updated = conversationRepo.verifyLink(req.params.id, {
        contactId: req.validatedBody.contactId,
        actor: req.user.username
      });
      res.json({ ok: true, conversation: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/conversations/:id',
  requireAuth,
  requirePermission('conversations:write'),
  validateBody(
    s.object({
      assignedUserId: s.string({ optional: true }),
      internalNote: s.string({ max: 2000, optional: true })
    })
  ),
  (req, res) => {
    const updated = conversationRepo.assignConversation(req.params.id, {
      ...req.validatedBody,
      actor: req.user.username
    });
    res.json({ ok: true, conversation: updated });
  }
);

router.post('/conversations/:id/seen', requireAuth, requirePermission('conversations:write'), (req, res) => {
  conversationRepo.markRead(req.params.id === 'all' ? null : req.params.id);
  res.json({ ok: true });
});

module.exports = router;
