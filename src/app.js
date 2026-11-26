const express = require('express');
const path = require('path');
const fs = require('fs');

const { getConfig } = require('./config');
const storage = require('./storage');
const zaloBot = require('./zaloBot');
const p2pSync = require('./p2pSync');
const campaignService = require('./services/campaignService');
const sseHub = require('./realtime/sseHub');
const {
  attachCorrelationId,
  csrfAndOriginGuard,
  createRateLimiter,
  errorHandler
} = require('./middleware/security');

const authRoutes = require('./routes/authRoutes');
const crmRoutes = require('./routes/crmRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const opsRoutes = require('./routes/opsRoutes');
const v1CompatRoutes = require('./routes/v1CompatRoutes');

function createApp({ initBot = true } = {}) {
  const cfg = getConfig();
  fs.mkdirSync(cfg.imagesDir, { recursive: true });
  fs.mkdirSync(cfg.backupDir, { recursive: true });

  if (initBot) {
    zaloBot.init();
  } else {
    storage.init();
  }

  const app = express();
  app.disable('x-powered-by');

  app.use(attachCorrelationId);
  app.use(csrfAndOriginGuard);
  app.use('/api', createRateLimiter({ windowMs: 60000, maxRequests: 600 }));
  app.use(express.json({ limit: '12mb' }));

  app.use(
    express.static(path.join(cfg.rootDir, 'public'), {
      etag: false,
      lastModified: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    })
  );
  app.use('/uploads/images', express.static(cfg.imagesDir));

  // API V2 (Chuẩn mới)
  app.use('/api/v2/auth', authRoutes);
  app.use('/api/v2', crmRoutes);
  app.use('/api/v2', campaignRoutes);
  app.use('/api/v2', opsRoutes);

  // V1 Compatibility Adapter (yêu cầu auth & RBAC)
  app.use('/api', v1CompatRoutes);

  // Nối sự kiện domain từ zaloBot & p2pSync vào Incremental SSE Hub
  if (!app.locals._sseWired) {
    zaloBot.on('status', (status) => {
      sseHub.broadcast('system.health', { type: 'system.health', timestamp: new Date().toISOString(), data: status });
      sseHub.broadcast('status', status);
    });
    zaloBot.on('contact_updated', (contact) => {
      sseHub.broadcast('contact.updated', {
        type: 'contact.updated',
        entityId: contact.id,
        version: contact.version,
        timestamp: contact.updatedAt,
        data: contact
      });
      sseHub.broadcast('contact_updated', contact);
    });
    campaignService.on('task_processed', ({ campaignId, taskId, outcome }) => {
      sseHub.broadcast('task.updated', {
        type: 'task.updated',
        entityId: taskId,
        timestamp: new Date().toISOString(),
        data: { campaignId, taskId, outcome }
      });
    });
    zaloBot.on('reply_received', (data) => {
      sseHub.broadcast('conversation.updated', {
        type: 'conversation.updated',
        entityId: data.conversation?.id,
        version: data.conversation?.version,
        timestamp: data.replyAt,
        data
      });
      sseHub.broadcast('reply_received', data);
    });
    app.locals._sseWired = true;
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
