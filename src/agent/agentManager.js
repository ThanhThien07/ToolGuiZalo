const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { fork } = require('child_process');
const { getConfig } = require('../config');
const { ZaloWebAdapter } = require('../adapters/zaloWebAdapter');
const { executeAdapterCommand } = require('./adapterCommands');
const accountRepo = require('../db/repositories/accountRepo');

class AgentManager extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.pending = new Map();
    this.inlineAdapter = null;
    this.lastHealth = { state: 'STOPPED', mode: 'isolated', pid: null, activeSessions: 0, rssMb: 0 };
  }

  start() {
    const cfg = getConfig();
    if (!cfg.agentIsolated) {
      if (!this.inlineAdapter) {
        this.inlineAdapter = new ZaloWebAdapter({
          onStatusChange: (accountId, status, profileName) => {
            this._handleSessionStatus(accountId, status, profileName);
          }
        });
      }
      this.lastHealth = { state: 'ONLINE', mode: 'inline', pid: process.pid, activeSessions: 0 };
      return;
    }

    if (this.child && !this.child.killed) return;
    const workerScript = path.join(__dirname, 'agentWorker.js');
    const child = fork(workerScript, [], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    this.child = child;
    this.lastHealth = { state: 'STARTING', mode: 'isolated', pid: child.pid, activeSessions: 0 };

    child.on('message', (msg) => {
      if (!msg) return;
      if (msg.type === 'agent_ready') {
        this.lastHealth = { ...this.lastHealth, state: 'ONLINE', pid: msg.pid };
        this.emit('ready', this.lastHealth);
      } else if (msg.type === 'session_status') {
        this._handleSessionStatus(msg.accountId, msg.status, msg.profileName);
      } else if (msg.type === 'log') {
        this.emit('log', msg);
      } else if (msg.type === 'rpc_result' && msg.reqId) {
        const entry = this.pending.get(msg.reqId);
        if (entry) {
          this.pending.delete(msg.reqId);
          clearTimeout(entry.timer);
          if (msg.ok) entry.resolve(msg.result);
          else entry.reject(new Error(msg.error || 'Agent RPC error'));
        }
      }
    });

    child.on('exit', (code) => {
      for (const [id, entry] of this.pending.entries()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Tiến trình Local Agent đã dừng (mã ${code}).`));
        this.pending.delete(id);
      }
      this.child = null;
      this.lastHealth = { ...this.lastHealth, state: 'STOPPED', pid: null, lastExitCode: code };
      this.emit('exit', { code });
    });
  }

  _handleSessionStatus(accountId, status, profileName) {
    try {
      accountRepo.update(accountId, {
        status,
        ...(profileName ? { zaloProfileName: profileName } : {})
      });
    } catch {}
    this.emit('session_status', { accountId, status, profileName });
  }

  async call(cmd, args = {}, timeoutMs = 45000) {
    const cfg = getConfig();
    if (!cfg.agentIsolated) {
      this.start();
      if (cmd === 'getHealth') {
        return { state: 'ONLINE', mode: 'inline', pid: process.pid, activeSessions: this.inlineAdapter.sessions.size };
      }
      return executeAdapterCommand(this.inlineAdapter, cmd, args);
    }

    if (!this.child) this.start();
    const reqId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Agent RPC timeout (${cmd})`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      this.child.send({ type: 'rpc', reqId, cmd, args });
    });
  }

  async refreshHealth() {
    try {
      if (!this.child && getConfig().agentIsolated) {
        return this.lastHealth;
      }
      const h = await this.call('getHealth', {}, 3000);
      this.lastHealth = { ...h, mode: getConfig().agentIsolated ? 'isolated' : 'inline' };
      return this.lastHealth;
    } catch {
      return this.lastHealth;
    }
  }

  async shutdown() {
    if (this.inlineAdapter) {
      await this.inlineAdapter.closeAll().catch(() => {});
    }
    if (this.child && !this.child.killed) {
      try {
        await this.call('closeAll', {}, 5000).catch(() => {});
        this.child.kill('SIGTERM');
      } catch {}
    }
  }
}

module.exports = new AgentManager();
module.exports.AgentManager = AgentManager;
