const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const userRepo = require('../db/repositories/userRepo');
const { requireAuth, requireRole, createRateLimiter } = require('../middleware/security');
const { validateBody, s } = require('../utils/validator');
const { getConfig } = require('../config');

const authLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30 });

function setSessionCookie(res, token) {
  const cfg = getConfig();
  res.cookie('tgz_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.nodeEnv === 'production' && cfg.host !== '127.0.0.1' && cfg.host !== 'localhost',
    maxAge: cfg.accessTokenTtlSec * 1000,
    path: '/'
  });
}

router.get('/bootstrap-status', (req, res) => {
  res.json({ ok: true, ...authService.getBootstrapStatus() });
});

router.post(
  '/setup',
  authLimiter,
  validateBody(
    s.object({
      username: s.string({ min: 3, max: 40, defaultValue: 'admin' }),
      displayName: s.string({ min: 1, max: 80, optional: true, defaultValue: 'Quản trị viên' }),
      password: s.string({ min: 6, max: 128 })
    })
  ),
  (req, res, next) => {
    try {
      const session = authService.setupInitialAdmin(req.validatedBody);
      setSessionCookie(res, session.accessToken);
      res.status(201).json({ ok: true, ...session });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/login',
  authLimiter,
  validateBody(
    s.object({
      username: s.string({ min: 1, max: 64 }),
      password: s.string({ min: 1, max: 128 }),
      totpCode: s.string({ max: 12, optional: true, defaultValue: '' })
    })
  ),
  (req, res, next) => {
    try {
      const result = authService.login({
        ...req.validatedBody,
        deviceLabel: req.headers['user-agent']?.slice(0, 80) || '',
        ipAddress: req.ip || '127.0.0.1'
      });
      if (result.mfaRequired) {
        return res.status(200).json({ ok: true, mfaRequired: true });
      }
      setSessionCookie(res, result.accessToken);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/logout', requireAuth, (req, res) => {
  authService.logout(req.authToken);
  res.clearCookie('tgz_session', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

router.post('/mfa/setup', requireAuth, (req, res, next) => {
  try {
    const out = authService.beginMfaSetup(req.user.userId);
    res.json({ ok: true, ...out });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/mfa/verify',
  requireAuth,
  validateBody(s.object({ code: s.string({ min: 6, max: 6 }) })),
  (req, res, next) => {
    try {
      const out = authService.confirmMfa(req.user.userId, req.validatedBody.code);
      res.json({ ok: true, ...out });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/mfa/disable', requireAuth, (req, res) => {
  const out = authService.disableMfa(req.user.userId);
  res.json({ ok: true, ...out });
});

// Quản lý users (Admin only)
router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ ok: true, users: userRepo.listUsers(), roles: userRepo.listRoles() });
});

router.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  validateBody(
    s.object({
      username: s.string({ min: 3, max: 40 }),
      displayName: s.string({ min: 1, max: 80, optional: true }),
      role: s.enum(['admin', 'operator', 'viewer'], { defaultValue: 'operator' }),
      password: s.string({ min: 6, max: 128 })
    })
  ),
  (req, res, next) => {
    try {
      const user = authService.createUserByAdmin({
        ...req.validatedBody,
        actor: req.user
      });
      res.status(201).json({ ok: true, user });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  validateBody(
    s.object({
      displayName: s.string({ min: 1, max: 80, optional: true }),
      role: s.enum(['admin', 'operator', 'viewer'], { optional: true }),
      isActive: s.boolean({ optional: true })
    })
  ),
  (req, res, next) => {
    try {
      const updated = userRepo.updateUser(req.params.id, req.validatedBody);
      if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy user.' } });
      res.json({ ok: true, user: updated });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
