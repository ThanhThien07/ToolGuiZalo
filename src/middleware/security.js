const crypto = require('crypto');
const authService = require('../services/authService');
const { getConfig } = require('../config');
const logger = require('../utils/logger');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    cookies[key] = val;
  }
  return cookies;
}

function attachCorrelationId(req, res, next) {
  const corr = String(req.headers['x-correlation-id'] || crypto.randomUUID());
  req.correlationId = corr;
  res.setHeader('X-Correlation-Id', corr);
  next();
}

function csrfAndOriginGuard(req, res, next) {
  const cfg = getConfig();
  const origin = req.headers.origin;

  // Allow non-browser / direct curl / same-origin requests without Origin header, OR allowlisted Origins
  if (origin) {
    const allowed = cfg.corsAllowlist.some((item) => origin === item) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
    if (!allowed) {
      return res.status(403).json({
        error: {
          code: 'ORIGIN_FORBIDDEN',
          message: 'Origin không nằm trong danh sách cho phép.',
          correlationId: req.correlationId
        }
      });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Token, X-Correlation-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return next();
}

function createRateLimiter({ windowMs = 60000, maxRequests = 180 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip || 'local'}:${req.baseUrl || ''}`;
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;
    if (rec.count > maxRequests) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Gửi quá nhiều yêu cầu trong thời gian ngắn, vui lòng thử lại sau.',
          correlationId: req.correlationId
        }
      });
    }
    return next();
  };
}

function extractToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.tgz_session) {
    return cookies.tgz_session;
  }
  if (req.query && req.query.token) {
    return String(req.query.token).trim();
  }
  return '';
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  const session = authService.verifyAccessToken(token);
  if (!session) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Chưa đăng nhập hoặc phiên làm việc đã hết hạn.',
        correlationId: req.correlationId
      }
    });
  }
  req.user = session;
  req.authToken = token;
  return next();
}

function requireDeviceAuth(req, res, next) {
  const deviceTok = String(req.headers['x-device-token'] || '');
  if (deviceTok) {
    const device = authService.verifyDeviceToken(deviceTok);
    if (!device) {
      return res.status(401).json({
        error: {
          code: 'INVALID_DEVICE_TOKEN',
          message: 'Token thiết bị không hợp lệ hoặc đã bị thu hồi.',
          correlationId: req.correlationId
        }
      });
    }
    req.device = device;
    return next();
  }
  // Cũng cho phép Admin/Operator đang đăng nhập gọi API sync trực tiếp từ UI
  return requireAuth(req, res, next);
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.', correlationId: req.correlationId }
      });
    }
    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: `Vai trò "${req.user.role}" không có quyền thực hiện thao tác này.`,
        correlationId: req.correlationId
      }
    });
  };
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu đăng nhập.', correlationId: req.correlationId }
      });
    }
    const perms = req.user.permissions || [];
    if (perms.includes('*') || perms.includes(perm)) {
      return next();
    }
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: `Thiếu quyền truy cập: ${perm}.`,
        correlationId: req.correlationId
      }
    });
  };
}

function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  const code = err.code || (status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
  logger.error(err.message || 'Unhandled API error', {
    correlationId: req.correlationId,
    path: req.originalUrl,
    status
  });
  res.status(status).json({
    error: {
      code,
      message: err.message || 'Đã xảy ra lỗi hệ thống.',
      correlationId: req.correlationId,
      ...(err.details ? { details: err.details } : {})
    }
  });
}

module.exports = {
  parseCookies,
  attachCorrelationId,
  csrfAndOriginGuard,
  createRateLimiter,
  requireAuth,
  requireDeviceAuth,
  requireRole,
  requirePermission,
  errorHandler
};
