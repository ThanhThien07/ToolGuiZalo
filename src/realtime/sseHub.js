const auditRepo = require('../db/repositories/auditRepo');

/**
 * Incremental SSE Hub (Roadmap Mục 6):
 * - Mỗi sự kiện mang eventId, type, entityId, version, timestamp, data.
 * - Khi client kết nối lại với Last-Event-ID hoặc sinceEventId, tự động phát bù các event còn thiếu (incremental).
 */
class SseHub {
  constructor() {
    this.clients = new Set();
    this.heartbeatTimer = null;
  }

  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const res of this.clients) {
        try {
          res.write(': keepalive\n\n');
        } catch {
          this.clients.delete(res);
        }
      }
    }, 25000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  subscribe(req, res, initialSnapshot = {}) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const lastEventId = Number(req.headers['last-event-id'] || req.query.sinceEventId || 0);
    const latestId = auditRepo.getLatestSyncEventId();

    if (lastEventId > 0 && latestId >= lastEventId && latestId - lastEventId <= 150) {
      const missed = auditRepo.listSyncEventsSince(lastEventId, 150);
      for (const evt of missed) {
        this.writeEvent(res, evt.type, evt);
      }
    } else {
      this.writeEvent(res, 'snapshot', {
        eventId: latestId,
        type: 'snapshot',
        timestamp: new Date().toISOString(),
        data: initialSnapshot
      });
    }

    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  writeEvent(res, eventName, payload) {
    const idLine = payload?.eventId !== undefined ? `id: ${payload.eventId}\n` : '';
    res.write(`${idLine}event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  broadcast(eventName, payload) {
    for (const res of this.clients) {
      try {
        this.writeEvent(res, eventName, payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}

module.exports = new SseHub();
