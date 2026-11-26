const express = require('express');
const router = express.Router();
const campaignService = require('../services/campaignService');
const campaignRepo = require('../db/repositories/campaignRepo');
const taskRepo = require('../db/repositories/taskRepo');
const { accountRepo, settingsRepo } = require('../db/repositories/accountRepo');
const zaloBot = require('../zaloBot');
const { requireAuth, requirePermission, requireRole } = require('../middleware/security');
const { validateBody, s } = require('../utils/validator');

// ==================== ACCOUNTS ====================

router.get('/accounts', requireAuth, requirePermission('accounts:read'), (req, res) => {
  res.json({ ok: true, accounts: accountRepo.list(), activeAccount: accountRepo.getActive() });
});

router.post(
  '/accounts',
  requireAuth,
  requireRole('admin', 'operator'),
  validateBody(
    s.object({
      name: s.string({ min: 1, max: 80 }),
      channel: s.enum(['zalo_web', 'zalo_oa', 'mock_sandbox'], { defaultValue: 'zalo_web' })
    })
  ),
  (req, res) => {
    const acc = accountRepo.create(req.validatedBody);
    res.status(201).json({ ok: true, account: acc, accounts: accountRepo.list() });
  }
);

router.post(
  '/accounts/switch',
  requireAuth,
  requirePermission('accounts:operate'),
  validateBody(s.object({ accountId: s.string({ min: 1 }), launch: s.boolean({ defaultValue: false }) })),
  async (req, res, next) => {
    try {
      const { accountId, launch } = req.validatedBody;
      const target = accountRepo.setActive(accountId);
      if (!target) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' } });
      zaloBot.viewingAccountId = target.id;
      if (launch) await zaloBot.launchBrowser(target.id, { makeActive: true });
      res.json({ ok: true, status: zaloBot.getStatus() });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/accounts/launch-all', requireAuth, requirePermission('accounts:operate'), async (req, res, next) => {
  try {
    const status = await zaloBot.launchAllAccounts();
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

router.post('/accounts/:id/revoke', requireAuth, requireRole('admin'), async (req, res) => {
  await zaloBot.closeBrowser(req.params.id).catch(() => {});
  const updated = accountRepo.update(req.params.id, { status: 'REVOKED' });
  res.json({ ok: true, account: updated, accounts: accountRepo.list() });
});

router.delete('/accounts/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    await zaloBot.closeBrowser(req.params.id).catch(() => {});
    const accounts = accountRepo.delete(req.params.id);
    res.json({ ok: true, accounts });
  } catch (err) {
    next(err);
  }
});

// ==================== CAMPAIGNS ====================

router.get('/campaigns', requireAuth, requirePermission('campaigns:read'), (req, res) => {
  const { status = 'ALL', limit = 50, offset = 0 } = req.query;
  res.json({ ok: true, campaigns: campaignRepo.list({ status, limit, offset }) });
});

router.get('/campaigns/:id', requireAuth, requirePermission('campaigns:read'), (req, res) => {
  const cmp = campaignRepo.getById(req.params.id);
  if (!cmp) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy chiến dịch.' } });
  const contacts = campaignRepo.listCampaignContacts(req.params.id, { limit: 100, offset: 0 });
  res.json({ ok: true, campaign: cmp, contacts });
});

router.post(
  '/campaigns',
  requireAuth,
  requirePermission('campaigns:write'),
  validateBody(
    s.object({
      name: s.string({ min: 1, max: 140 }),
      channel: s.enum(['web_assisted', 'zalo_oa', 'mock_sandbox', 'auto'], { defaultValue: 'web_assisted' }),
      accountId: s.string({ optional: true }),
      templateId: s.string({ optional: true }),
      templateBody: s.string({ max: 4000, optional: true }),
      scheduledAt: s.string({ optional: true }),
      contactIds: s.array(s.string({ min: 1 }), { optional: true }),
      requireOptInConsent: s.boolean({ optional: true })
    })
  ),
  (req, res, next) => {
    try {
      const result = campaignService.createCampaign({
        ...req.validatedBody,
        createdBy: req.user.userId
      });
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/campaigns/:id/approve', requireAuth, requireRole('admin', 'operator'), (req, res) => {
  const updated = campaignService.approveCampaign(req.params.id, {
    userId: req.user.userId,
    actor: req.user.username
  });
  if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy chiến dịch.' } });
  res.json({ ok: true, campaign: updated });
});

router.post('/campaigns/:id/start', requireAuth, requirePermission('campaigns:run'), async (req, res, next) => {
  try {
    const wait = req.query.wait === 'true';
    const cmp = await campaignService.runCampaign(req.params.id, {
      actor: req.user.username,
      waitForCompletion: wait
    });
    res.json({ ok: true, campaign: cmp });
  } catch (err) {
    next(err);
  }
});

router.post('/campaigns/:id/pause', requireAuth, requirePermission('campaigns:run'), (req, res) => {
  const cmp = campaignService.pauseCampaign(req.params.id, { actor: req.user.username });
  res.json({ ok: true, campaign: cmp });
});

router.post('/campaigns/:id/cancel', requireAuth, requirePermission('campaigns:run'), (req, res) => {
  const cmp = campaignService.cancelCampaign(req.params.id, { actor: req.user.username });
  res.json({ ok: true, campaign: cmp });
});

// ==================== TASKS ====================

router.get('/tasks', requireAuth, requirePermission('tasks:read'), (req, res) => {
  const { campaignId = null, status = 'ALL', limit = 50, offset = 0 } = req.query;
  res.json({ ok: true, ...taskRepo.list({ campaignId, status, limit, offset }) });
});

router.get('/tasks/:id/attempts', requireAuth, requirePermission('tasks:read'), (req, res) => {
  res.json({ ok: true, attempts: taskRepo.listAttempts(req.params.id) });
});

router.post(
  '/tasks/:id/resolve-review',
  requireAuth,
  requirePermission('tasks:review'),
  validateBody(
    s.object({
      resolution: s.enum(['COMPLETED', 'FAILED', 'CANCELLED', 'PENDING']),
      note: s.string({ max: 500, optional: true, defaultValue: '' })
    })
  ),
  (req, res) => {
    const updated = taskRepo.resolveReviewTask(req.params.id, {
      ...req.validatedBody,
      actor: req.user.username
    });
    if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tác vụ.' } });
    res.json({ ok: true, task: updated });
  }
);

// ==================== SETTINGS ====================

router.get('/settings', requireAuth, (req, res) => {
  res.json({ ok: true, settings: settingsRepo.getAppSettings() });
});

router.post('/settings', requireAuth, requireRole('admin', 'operator'), (req, res) => {
  const updated = settingsRepo.updateAppSettings(req.body || {});
  res.json({ ok: true, settings: updated });
});

module.exports = router;
