const { ZaloWebAdapter } = require('../adapters/zaloWebAdapter');
const { executeAdapterCommand } = require('./adapterCommands');
const { monitorEventLoopDelay } = require('perf_hooks');

const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
loopMonitor.enable();

const adapter = new ZaloWebAdapter({
  onStatusChange(accountId, status, profileName) {
    process.send?.({ type: 'session_status', accountId, status, profileName });
  },
  onLog(level, message) {
    process.send?.({ type: 'log', level, message });
  }
});

process.on('message', async (msg) => {
  if (!msg || msg.type !== 'rpc') return;
  try {
    let result;
    if (msg.cmd === 'getHealth') {
      const mem = process.memoryUsage();
      result = {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        loopLagMs: Number((loopMonitor.percentile(95) / 1e6).toFixed(2)) || 0,
        activeSessions: adapter.sessions.size,
        state: 'ONLINE'
      };
    } else {
      result = await executeAdapterCommand(adapter, msg.cmd, msg.args || {});
    }
    process.send?.({ type: 'rpc_result', reqId: msg.reqId, ok: true, result });
  } catch (err) {
    process.send?.({ type: 'rpc_result', reqId: msg.reqId, ok: false, error: err.message });
  }
});

async function shutdown() {
  await adapter.closeAll().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (process.send) {
  process.send({ type: 'agent_ready', pid: process.pid });
}
