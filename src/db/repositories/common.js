const crypto = require('crypto');
const db = require('../database');

function safeParseJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function recordSyncEvent(eventType, entityType, entityId, version = 1, payload = {}) {
  const now = new Date().toISOString();
  const eventUuid = crypto.randomUUID();
  const res = db.run(
    `INSERT INTO sync_events (event_uuid, event_type, entity_type, entity_id, version, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventUuid, eventType, entityType, String(entityId || ''), version, JSON.stringify(payload || {}), now]
  );
  return {
    eventId: Number(res.lastInsertRowid),
    eventUuid,
    type: eventType,
    entityType,
    entityId: String(entityId || ''),
    version,
    timestamp: now,
    data: payload
  };
}

function enqueueOutbox(entityType, entityId, operation, entityVersion = 1, payload = {}) {
  const now = new Date().toISOString();
  const mutationId = crypto.randomUUID();
  db.run(
    `INSERT INTO outbox (mutation_id, entity_type, entity_id, operation, entity_version, payload_json, acked_by_server, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [mutationId, entityType, String(entityId || ''), operation, entityVersion, JSON.stringify(payload || {}), now]
  );
  return mutationId;
}

function writeAudit({
  actorUserId = null,
  actorUsername = 'system',
  actorRole = 'system',
  deviceId = null,
  action,
  resourceType,
  resourceId = '',
  correlationId = '',
  details = {}
}) {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO audit_logs
      (event_uuid, actor_user_id, actor_username, actor_role, device_id, action, resource_type, resource_id, correlation_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      actorUserId,
      actorUsername,
      actorRole,
      deviceId,
      action,
      resourceType,
      String(resourceId || ''),
      correlationId,
      JSON.stringify(details || {}),
      now
    ]
  );
}

module.exports = {
  safeParseJson,
  recordSyncEvent,
  enqueueOutbox,
  writeAudit
};
