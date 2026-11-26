const db = require('../database');
const { safeParseJson } = require('./common');

class AuditRepo {
  listAuditLogs({ action = null, limit = 100, offset = 0 } = {}) {
    const where = action ? 'WHERE action LIKE ?' : '';
    const params = action ? [`%${action}%`] : [];
    const totalRow = db.queryOne(`SELECT COUNT(*) AS cnt FROM audit_logs ${where}`, params);
    const items = db
      .queryAll(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [
        ...params,
        Number(limit),
        Number(offset)
      ])
      .map((r) => ({
        ...r,
        details: safeParseJson(r.details_json, {})
      }));
    return {
      total: totalRow ? Number(totalRow.cnt) : 0,
      items
    };
  }

  listSyncEventsSince(sinceId = 0, limit = 200) {
    return db
      .queryAll('SELECT * FROM sync_events WHERE id > ? ORDER BY id ASC LIMIT ?', [Number(sinceId) || 0, Number(limit)])
      .map((r) => ({
        eventId: r.id,
        eventUuid: r.event_uuid,
        type: r.event_type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        version: r.version,
        timestamp: r.created_at,
        data: safeParseJson(r.payload_json, {})
      }));
  }

  getLatestSyncEventId() {
    const row = db.queryOne('SELECT MAX(id) AS max_id FROM sync_events');
    return row && row.max_id ? Number(row.max_id) : 0;
  }

  // Outbox & Delta Sync
  getPendingOutbox(limit = 500) {
    return db
      .queryAll('SELECT * FROM outbox WHERE acked_by_server = 0 ORDER BY cursor ASC LIMIT ?', [Number(limit)])
      .map((r) => ({
        cursor: r.cursor,
        mutationId: r.mutation_id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        operation: r.operation,
        entityVersion: r.entity_version,
        payload: safeParseJson(r.payload_json, {}),
        createdAt: r.created_at
      }));
  }

  ackOutboxUpTo(maxCursor) {
    db.run('UPDATE outbox SET acked_by_server = 1 WHERE cursor <= ? AND acked_by_server = 0', [Number(maxCursor) || 0]);
  }

  listConflicts(status = 'OPEN') {
    const where = status && status !== 'ALL' ? 'WHERE status = ?' : '';
    const params = status && status !== 'ALL' ? [status] : [];
    return db
      .queryAll(`SELECT * FROM sync_conflicts ${where} ORDER BY created_at DESC LIMIT 100`, params)
      .map((r) => ({
        ...r,
        localPayload: safeParseJson(r.local_payload_json, {}),
        remotePayload: safeParseJson(r.remote_payload_json, {})
      }));
  }

  listBackups() {
    return db
      .queryAll('SELECT * FROM backups ORDER BY created_at DESC')
      .map((r) => ({
        ...r,
        recordsSummary: safeParseJson(r.records_summary_json, {})
      }));
  }
}

module.exports = new AuditRepo();
