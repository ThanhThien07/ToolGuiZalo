const os = require('os');
const EventEmitter = require('events');
const userRepo = require('./db/repositories/userRepo');
const auditRepo = require('./db/repositories/auditRepo');
const deltaSyncService = require('./services/deltaSyncService');

/**
 * Sync Engine V2 (Roadmap Mục 9):
 * - Ngừng phát snapshot dữ liệu khách hàng hay phiên qua public relay ntfy.sh.
 * - Mọi đồng bộ thực hiện qua HTTPS Delta Sync có xác thực device token, outbox & conflict review.
 */
class AuthenticatedSyncFacade extends EventEmitter {
  constructor() {
    super();
    this.hostname = os.hostname();
    this.port = Number(process.env.PORT) || 3000;
  }

  start() {
    // Khởi tạo sạch, không mở socket broadcast dữ liệu PII ra ngoài khi chưa cấu hình.
  }

  stop() {}

  getInfo() {
    const devices = userRepo.listDevices().filter((d) => d.status !== 'REVOKED');
    return {
      mode: 'authenticated_delta_sync',
      hostname: this.hostname,
      port: this.port,
      serverCursor: auditRepo.getLatestSyncEventId(),
      pendingOutbox: auditRepo.getPendingOutbox().length,
      openConflicts: auditRepo.listConflicts('OPEN').length,
      peersCount: devices.length,
      peers: devices.map((d) => ({
        id: d.id,
        hostname: d.hostname || d.name,
        ip: d.platform,
        port: this.port,
        role: d.role,
        transport: 'HTTPS Delta Sync (Đã xác thực)',
        lastSeen: d.last_seen_at ? new Date(d.last_seen_at).getTime() : Date.now()
      }))
    };
  }

  async pushPendingOutboxToServer({ serverUrl, deviceToken, sinceCursor = 0 }) {
    const mutations = auditRepo.getPendingOutbox(500);
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v2/sync/delta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Token': deviceToken
      },
      body: JSON.stringify({ sinceCursor, mutations }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
      throw new Error(`Delta sync thất bại: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (mutations.length > 0 && Array.isArray(data.ackedMutationIds) && data.ackedMutationIds.length > 0) {
      const maxAckCursor = Math.max(...mutations.map((m) => m.cursor));
      auditRepo.ackOutboxUpTo(maxAckCursor);
    }
    this.emit('sync_updated', data);
    return data;
  }

  applyLocalDelta(payload) {
    return deltaSyncService.applyClientDelta(payload);
  }
}

module.exports = new AuthenticatedSyncFacade();
