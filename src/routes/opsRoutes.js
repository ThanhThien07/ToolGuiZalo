const express = require('express');
const router = express.Router();
const userRepo = require('../db/repositories/userRepo');
const auditRepo = require('../db/repositories/auditRepo');
const contactRepo = require('../db/repositories/contactRepo');
const consentRepo = require('../db/repositories/consentRepo');
const campaignRepo = require('../db/repositories/campaignRepo');
const authService = require('../services/authService');
const backupService = require('../services/backupService');
const deltaSyncService = require('../services/deltaSyncService');
const { getSystemHealth } = require('../services/healthService');
const reportService = require('../services/reportService');
const agentManager = require('../agent/agentManager');
const zaloBot = require('../zaloBot');
const { ZaloOfficialAdapter } = require('../adapters/zaloOfficialAdapter');
const sseHub = require('../realtime/sseHub');
const { requireAuth, requireDeviceAuth, requireRole, requirePermission } = require('../middleware/security');
const { validateBody, s } = require('../utils/validator');

const oaAdapter = new ZaloOfficialAdapter();

// ==================== HEALTH & SYSTEM MONITOR ====================

router.get('/health/live', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/health', requireAuth, async (req, res) => {
  const agentHealth = await agentManager.refreshHealth();
  res.json({ ok: true, ...getSystemHealth({ agentHealth }) });
});

router.get('/system/metrics', requireAuth, requirePermission('health:read'), async (req, res) => {
  const agentHealth = await agentManager.refreshHealth();
  res.json({ ok: true, ...getSystemHealth({ agentHealth }) });
});

// ==================== REALTIME SSE STREAM ====================

router.get('/events', requireAuth, (req, res) => {
  sseHub.subscribe(req, res, {
    status: zaloBot.getStatus(),
    contactsStats: contactRepo.getStats()
  });
});

// ==================== BROWSER VIEWER & AGENT CONTROLS ====================

router.post('/browser/open', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    const { accountId } = req.body || {};
    const status = await zaloBot.launchBrowser(accountId, { makeActive: false, setViewing: true });
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/browser/viewer-state',
  requireAuth,
  requirePermission('accounts:operate'),
  validateBody(s.object({ active: s.boolean() })),
  async (req, res) => {
    await zaloBot.setViewerActive(req.validatedBody.active, req.validatedBody.active ? 15000 : 0);
    res.json({ ok: true, active: req.validatedBody.active });
  }
);

router.get('/browser/screenshot', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    const shot = await zaloBot.getLiveScreenshot(req.query.accountId || null, true);
    if (!shot) return res.json({ ok: true, active: false });
    res.json({ ok: true, active: true, ...shot });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/browser/click',
  requireAuth,
  requirePermission('accounts:operate'),
  validateBody(s.object({ xRatio: s.number({ min: 0, max: 1 }), yRatio: s.number({ min: 0, max: 1 }) })),
  async (req, res, next) => {
    try {
      await zaloBot.clickOnPage(req.validatedBody.xRatio, req.validatedBody.yRatio);
      const shot = await zaloBot.getLiveScreenshot(null, true);
      res.json({ ok: true, ...(shot || {}) });
    } catch (err) {
      next(err);
    }
  }
);

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
    const { accountId, all = false } = req.body || {};
    if (all) await zaloBot.closeAllBrowsers();
    else await zaloBot.closeBrowser(accountId);
    res.json({ ok: true, status: zaloBot.getStatus() });
  } catch (err) {
    next(err);
  }
});

router.post('/browser/open-chat', requireAuth, requirePermission('conversations:write'), async (req, res, next) => {
  try {
    const { accountId, phone, contactName } = req.body || {};
    const status = await zaloBot.openChat(accountId, phone, contactName);
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

router.post('/replies/check', requireAuth, requirePermission('conversations:read'), async (req, res, next) => {
  try {
    const { accountId } = req.body || {};
    const result = await zaloBot.checkReplies(accountId);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ==================== DEVICES & AUTHENTICATED DELTA SYNC ====================

router.get('/devices', requireAuth, (req, res) => {
  res.json({ ok: true, devices: userRepo.listDevices() });
});

router.post(
  '/devices/pair',
  requireAuth,
  requireRole('admin'),
  validateBody(s.object({ role: s.enum(['MASTER', 'AGENT', 'SYNC_CLIENT'], { defaultValue: 'SYNC_CLIENT' }), ttlSec: s.number({ min: 30, max: 3600, defaultValue: 300 }) })),
  (req, res) => {
    const pairing = userRepo.createPairingCode({
      role: req.validatedBody.role,
      createdBy: req.user.userId,
      ttlSec: req.validatedBody.ttlSec
    });
    res.status(201).json({ ok: true, ...pairing });
  }
);

router.post(
  '/devices/enroll',
  validateBody(
    s.object({
      code: s.string({ min: 4, max: 32 }),
      deviceName: s.string({ min: 1, max: 80 }),
      hostname: s.string({ max: 80, defaultValue: '' }),
      platform: s.string({ max: 30, defaultValue: 'win32' }),
      appVersion: s.string({ max: 30, defaultValue: '2.0.0' })
    })
  ),
  (req, res, next) => {
    try {
      const enrolled = authService.enrollDeviceWithPairingCode(req.validatedBody);
      res.status(201).json({ ok: true, ...enrolled });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/devices/:id/revoke', requireAuth, requireRole('admin'), (req, res) => {
  const revoked = userRepo.revokeDevice(req.params.id, req.user.username);
  res.json({ ok: true, device: revoked });
});

router.get('/sync/info', requireAuth, (req, res) => {
  res.json({
    ok: true,
    serverCursor: auditRepo.getLatestSyncEventId(),
    pendingOutbox: auditRepo.getPendingOutbox().length,
    openConflicts: auditRepo.listConflicts('OPEN').length,
    devices: userRepo.listDevices()
  });
});

router.post('/sync/delta', requireDeviceAuth, (req, res) => {
  const { sinceCursor = 0, mutations = [] } = req.body || {};
  const result = deltaSyncService.applyClientDelta({
    device: req.device || { id: null, name: req.user?.username || 'ui' },
    sinceCursor,
    mutations
  });
  sseHub.broadcast('sync.completed', { type: 'sync.completed', data: { serverCursor: result.serverCursor } });
  res.json(result);
});

router.get('/sync/conflicts', requireAuth, (req, res) => {
  res.json({ ok: true, conflicts: auditRepo.listConflicts(req.query.status || 'OPEN') });
});

router.post(
  '/sync/conflicts/:id/resolve',
  requireAuth,
  requireRole('admin', 'operator'),
  validateBody(s.object({ decision: s.enum(['RESOLVED_LOCAL', 'RESOLVED_REMOTE', 'DISMISSED']) })),
  (req, res) => {
    const resolved = deltaSyncService.resolveConflict(req.params.id, {
      decision: req.validatedBody.decision,
      actor: req.user.username
    });
    res.json({ ok: true, conflict: resolved });
  }
);

// ==================== BACKUPS & RESTORE ====================

router.get('/backups', requireAuth, (req, res) => {
  res.json({ ok: true, backups: backupService.listBackups() });
});

router.post('/backups', requireAuth, requireRole('admin'), (req, res, next) => {
  try {
    const kind = ['manual', 'daily', 'weekly'].includes(req.body?.kind) ? req.body.kind : 'manual';
    const created = backupService.createBackup({ kind, actor: req.user.username });
    res.status(201).json({ ok: true, backup: created });
  } catch (err) {
    next(err);
  }
});

router.post('/backups/:id/verify', requireAuth, requireRole('admin'), (req, res, next) => {
  try {
    const result = backupService.verifyBackup(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/backups/:id/restore', requireAuth, requireRole('admin'), (req, res, next) => {
  try {
    const result = backupService.restoreBackup({
      backupId: req.params.id,
      targetDbPath: req.body?.targetDbPath || null,
      actor: req.user.username
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ==================== REPORTS, ANALYTICS & AUDIT ====================

router.get('/reports/export-excel', requireAuth, requirePermission('reports:export'), (req, res) => {
  const buf = reportService.buildContactsReportWorkbookBuffer();
  const ts = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="Bao_Cao_Zalo_${ts}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/reports/export-replies-excel', requireAuth, requirePermission('reports:export'), (req, res) => {
  const buf = reportService.buildRepliesReportWorkbookBuffer();
  const ts = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="Bao_Cao_Khach_Phan_Hoi_${ts}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/reports/analytics', requireAuth, (req, res) => {
  res.json({
    ok: true,
    contactStats: contactRepo.getStats(),
    consentStats: consentRepo.getStats(),
    recentCampaigns: campaignRepo.list({ limit: 10 })
  });
});

router.get('/audit/logs', requireAuth, (req, res) => {
  const { action = null, limit = 100, offset = 0 } = req.query;
  res.json({ ok: true, ...auditRepo.listAuditLogs({ action, limit, offset }) });
});

// ==================== OFFICIAL ZALO OA WEBHOOK ====================

router.post('/webhooks/zalo-oa', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-zevent-signature'] || '';
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
  if (!oaAdapter.verifyWebhookSignature(rawBody, sig)) {
    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Chữ ký webhook không hợp lệ.' } });
  }
  res.json({ ok: true, received: true });
});

module.exports = router;
