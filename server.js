const { getConfig } = require('./src/config');
const { createApp } = require('./src/app');
const agentManager = require('./src/agent/agentManager');
const campaignService = require('./src/services/campaignService');
const sseHub = require('./src/realtime/sseHub');
const db = require('./src/db/database');
const logger = require('./src/utils/logger');

const cfg = getConfig();
const app = createApp({ initBot: true });
sseHub.startHeartbeat();

let httpServer = null;

function startServer(port = cfg.port, host = cfg.host) {
  httpServer = app.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log('\n================================================================');
    console.log(`🚀 ToolGuiZalo Pro V2 đang chạy an toàn tại: ${url}`);
    console.log(`🔒 Bind mặc định: ${host} | Database: SQLite WAL`);
    console.log('================================================================\n');

    if (process.env.NO_AUTO_OPEN !== 'true') {
      const openCmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
      require('child_process').exec(openCmd, () => {});
    }
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Cổng ${port} đang bận, thử cổng ${port + 1}`);
      startServer(port + 1, host);
    } else {
      logger.error('Lỗi server HTTP', { message: err.message });
      process.exit(1);
    }
  });
}

async function gracefulShutdown(signal) {
  logger.info(`Nhận tín hiệu ${signal}, đang tắt an toàn...`);
  campaignService.stopScheduler();
  sseHub.stopHeartbeat();
  await agentManager.shutdown().catch(() => {});
  if (httpServer) {
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => {
      db.close();
      process.exit(0);
    }, 3000).unref();
  } else {
    db.close();
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer(cfg.port, cfg.host);
