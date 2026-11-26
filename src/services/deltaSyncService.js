const crypto = require('crypto');
const db = require('../db/database');
const contactRepo = require('../db/repositories/contactRepo');
const consentRepo = require('../db/repositories/consentRepo');
const auditRepo = require('../db/repositories/auditRepo');
const { recordSyncEvent, writeAudit } = require('../db/repositories/common');

/**
 * Dịch vụ Đồng bộ Delta có xác thực (Roadmap Mục 9):
 * - Thay thế việc đẩy full snapshot plaintext qua ntfy.sh bằng delta sync qua HTTPS có token thiết bị.
 * - Dùng outbox, server cursor, version, idempotent ack theo mutationId và tombstones cho bản ghi xóa.
 * - Phát hiện xung đột phiên bản -> đưa vào `sync_conflicts` để kiểm duyệt thủ công.
 */
class DeltaSyncService {
  /**
   * Client gửi batch thay đổi từ outbox lên Master Server và kéo các thay đổi từ cursor về sau.
   */
  applyClientDelta({ device, sinceCursor = 0, mutations = [] }) {
    return db.withTransaction(() => {
      let applied = 0;
      let skippedDuplicate = 0;
      let conflictsCreated = 0;
      const ackedMutationIds = [];

      for (const m of mutations) {
        if (!m || !m.mutationId) continue;

        // Idempotency check: nếu mutation_id đã từng được xử lý trên server, ack lại và bỏ qua (chống nhân đôi khi replay!)
        const alreadySeen = db.queryOne('SELECT mutation_id FROM outbox WHERE mutation_id = ?', [m.mutationId]);
        if (alreadySeen) {
          skippedDuplicate++;
          ackedMutationIds.push(m.mutationId);
          continue;
        }

        const now = new Date().toISOString();
        if (m.entityType === 'contact' && m.operation === 'DELETE') {
          const existing = contactRepo.getById(m.entityId);
          if (existing) {
            contactRepo.deleteContact(m.entityId, device?.name || 'sync_client');
          }
          db.run(
            `INSERT INTO outbox (mutation_id, entity_type, entity_id, operation, entity_version, payload_json, acked_by_server, created_at)
             VALUES (?, 'contact', ?, 'DELETE', ?, ?, 1, ?)`,
            [m.mutationId, m.entityId, Number(m.entityVersion || 1), JSON.stringify({ id: m.entityId }), now]
          );
          applied++;
          ackedMutationIds.push(m.mutationId);
        } else if (m.entityType === 'contact' && m.operation === 'UPSERT' && m.payload) {
          const p = m.payload;
          const existing = p.id ? contactRepo.getById(p.id) : p.phone ? contactRepo.getByPhone(p.phone) : null;

          if (existing) {
            const clientBaseVer = Number(m.baseVersion ?? m.entityVersion - 1);
            // Nếu server đã tăng version vượt quá baseVersion của client và dữ liệu khác nhau -> đưa vào hàng đợi REVIEW xung đột!
            if (existing.version > clientBaseVer && existing.name !== p.name && existing.info !== p.info) {
              db.run(
                `INSERT INTO sync_conflicts
                  (id, entity_type, entity_id, local_version, remote_version, local_payload_json, remote_payload_json, source_device_id, status, created_at)
                 VALUES (?, 'contact', ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
                [
                  `cnf_${crypto.randomUUID()}`,
                  existing.id,
                  existing.version,
                  Number(m.entityVersion || 1),
                  JSON.stringify(existing),
                  JSON.stringify(p),
                  device?.id || null,
                  now
                ]
              );
              conflictsCreated++;
            } else {
              contactRepo.updateContact(existing.id, {
                name: p.name,
                info: p.info,
                customMessage: p.customMessage,
                note: p.note,
                zaloName: p.zaloName,
                status: p.status,
                reason: p.reason
              });
              applied++;
            }
          } else {
            contactRepo.importBatch([p], { deduplicate: true, consentStatus: p.consentStatus || 'UNKNOWN' });
            applied++;
          }

          db.run(
            `INSERT INTO outbox (mutation_id, entity_type, entity_id, operation, entity_version, payload_json, acked_by_server, created_at)
             VALUES (?, 'contact', ?, 'UPSERT', ?, ?, 1, ?)`,
            [m.mutationId, m.entityId || p.id || p.phone, Number(m.entityVersion || 1), JSON.stringify(p), now]
          );
          ackedMutationIds.push(m.mutationId);
        } else if (m.entityType === 'consent' && m.payload) {
          consentRepo.upsertConsent({
            phone: m.payload.phone,
            status: m.payload.status,
            source: m.payload.source || 'sync_client',
            scope: m.payload.scope || 'zalo_notification',
            note: m.payload.note || '',
            actor: device?.name || 'sync_client'
          });
          db.run(
            `INSERT INTO outbox (mutation_id, entity_type, entity_id, operation, entity_version, payload_json, acked_by_server, created_at)
             VALUES (?, 'consent', ?, 'UPSERT', ?, ?, 1, ?)`,
            [m.mutationId, m.entityId || m.payload.phone, Number(m.entityVersion || 1), JSON.stringify(m.payload), now]
          );
          applied++;
          ackedMutationIds.push(m.mutationId);
        } else {
          ackedMutationIds.push(m.mutationId);
        }
      }

      // Kéo các thay đổi phía server kể từ sinceCursor
      const serverCursorRow = db.queryOne('SELECT COALESCE(MAX(id), 0) AS max_id FROM sync_events');
      const serverCursor = Number(serverCursorRow?.max_id || 0);
      const changes = auditRepo.listSyncEventsSince(sinceCursor, 200);
      const deletedTombstones = db.queryAll('SELECT * FROM tombstones ORDER BY deleted_at DESC LIMIT 200');

      if (device && device.id) {
        db.run('UPDATE devices SET last_seen_cursor = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', [
          serverCursor,
          new Date().toISOString(),
          new Date().toISOString(),
          device.id
        ]);
      }

      if (applied > 0 || conflictsCreated > 0) {
        recordSyncEvent('sync.completed', 'sync', device?.id || 'local', 1, {
          applied,
          conflictsCreated,
          serverCursor
        });
      }

      return {
        ok: true,
        applied,
        skippedDuplicate,
        conflictsCreated,
        ackedMutationIds,
        serverCursor,
        changes,
        tombstones: deletedTombstones
      };
    });
  }

  resolveConflict(conflictId, { decision = 'RESOLVED_LOCAL', actor = 'operator' } = {}) {
    const row = db.queryOne('SELECT * FROM sync_conflicts WHERE id = ?', [conflictId]);
    if (!row) throw new Error('Không tìm thấy xung đột.');
    const now = new Date().toISOString();

    if (decision === 'RESOLVED_REMOTE' && row.entity_type === 'contact') {
      const remotePayload = JSON.parse(row.remote_payload_json);
      contactRepo.updateContact(row.entity_id, {
        name: remotePayload.name,
        info: remotePayload.info,
        customMessage: remotePayload.customMessage,
        note: remotePayload.note
      });
    }

    db.run(
      `UPDATE sync_conflicts SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
      [decision, actor, now, conflictId]
    );
    writeAudit({
      actorUsername: actor,
      action: 'sync.conflict_resolved',
      resourceType: 'sync_conflict',
      resourceId: conflictId,
      details: { decision }
    });
    return db.queryOne('SELECT * FROM sync_conflicts WHERE id = ?', [conflictId]);
  }
}

module.exports = new DeltaSyncService();
