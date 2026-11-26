const os = require('os');
const fs = require('fs');
const { monitorEventLoopDelay } = require('perf_hooks');
const db = require('../db/database');
const { getConfig } = require('../config');

const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
loopMonitor.enable();

function getSystemHealth({ agentHealth = null } = {}) {
  const cfg = getConfig();
  const mem = process.memoryUsage();
  const totalSysMem = os.totalmem();
  const freeSysMem = os.freemem();

  let dbSizeBytes = 0;
  let walSizeBytes = 0;
  try {
    if (fs.existsSync(cfg.dbPath)) dbSizeBytes = fs.statSync(cfg.dbPath).size;
    if (fs.existsSync(`${cfg.dbPath}-wal`)) walSizeBytes = fs.statSync(`${cfg.dbPath}-wal`).size;
  } catch {}

  let dbOk = false;
  try {
    const row = db.queryOne('SELECT 1 AS ok');
    dbOk = Boolean(row && row.ok === 1);
  } catch {}

  const p95LoopLagMs = Number((loopMonitor.percentile(95) / 1e6).toFixed(2)) || 0;
  const meanLoopLagMs = Number((loopMonitor.mean / 1e6).toFixed(2)) || 0;

  return {
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    hostname: os.hostname(),
    memory: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      systemTotalMb: Math.round(totalSysMem / 1048576),
      systemFreeMb: Math.round(freeSysMem / 1048576)
    },
    cpuLoadAvg: os.loadavg(),
    eventLoop: {
      meanLagMs: meanLoopLagMs,
      p95LagMs: p95LoopLagMs
    },
    database: {
      ok: dbOk,
      path: cfg.dbPath,
      sizeBytes: dbSizeBytes,
      walSizeBytes
    },
    agent: agentHealth || { mode: cfg.agentIsolated ? 'isolated' : 'inline', state: 'IDLE' }
  };
}

module.exports = {
  getSystemHealth
};
