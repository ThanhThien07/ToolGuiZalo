const crypto = require('crypto');
const db = require('../database');
const { safeParseJson, recordSyncEvent, writeAudit } = require('./common');

class CampaignRepo {
  mapCampaign(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      channel: r.channel,
      accountId: r.account_id,
      templateId: r.template_id,
      templateBody: r.template_body,
      settingsSnapshot: safeParseJson(r.settings_snapshot_json, {}),
      scheduledAt: r.scheduled_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      stopReason: r.stop_reason,
      createdBy: r.created_by,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version
    };
  }

  list({ status = null, limit = 50, offset = 0 } = {}) {
    const where = status && status !== 'ALL' ? 'WHERE c.status = ?' : '';
    const params = status && status !== 'ALL' ? [status] : [];
    const rows = db.queryAll(
      `SELECT c.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id = c.id) AS total_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id = c.id AND t.status = 'COMPLETED') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id = c.id AND t.status = 'FAILED') AS failed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id = c.id AND t.status = 'REVIEW') AS review_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id = c.id AND t.status IN ('PENDING','ASSIGNED','PROCESSING')) AS remaining_tasks
       FROM campaigns c
       ${where}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    return rows.map((r) => ({
      ...this.mapCampaign(r),
      counts: {
        total: Number(r.total_tasks || 0),
        completed: Number(r.completed_tasks || 0),
        failed: Number(r.failed_tasks || 0),
        review: Number(r.review_tasks || 0),
        remaining: Number(r.remaining_tasks || 0)
      }
    }));
  }

  getById(id) {
    const row = db.queryOne('SELECT * FROM campaigns WHERE id = ?', [id]);
    if (!row) return null;
    const stats = db.queryAll('SELECT status, COUNT(*) AS cnt FROM tasks WHERE campaign_id = ? GROUP BY status', [id]);
    const counts = { total: 0, PENDING: 0, ASSIGNED: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, REVIEW: 0, CANCELLED: 0 };
    for (const s of stats) {
      counts[s.status] = Number(s.cnt);
      counts.total += Number(s.cnt);
    }
    return { ...this.mapCampaign(row), counts };
  }

  create({
    id = null,
    name,
    channel = 'web_assisted',
    accountId = null,
    templateId = null,
    templateBody = '',
    settingsSnapshot = {},
    scheduledAt = null,
    createdBy = null,
    status = 'DRAFT'
  }) {
    const cmpId = id || `cmp_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO campaigns
        (id, name, status, channel, account_id, template_id, template_body, settings_snapshot_json, scheduled_at, created_by, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        cmpId,
        String(name || `Chiến dịch ${now.slice(0, 10)}`),
        status,
        channel,
        accountId,
        templateId,
        String(templateBody || ''),
        JSON.stringify(settingsSnapshot || {}),
        scheduledAt,
        createdBy,
        now,
        now
      ]
    );
    writeAudit({
      actorUserId: createdBy,
      action: 'campaign.created',
      resourceType: 'campaign',
      resourceId: cmpId,
      details: { name, channel }
    });
    return this.getById(cmpId);
  }

  updateStatus(id, status, { stopReason = undefined, approvedBy = undefined, actor = 'system' } = {}) {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?', 'version = version + 1'];
    const params = [status, now];

    if (status === 'RUNNING' && !existing.startedAt) {
      sets.push('started_at = ?');
      params.push(now);
    }
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      sets.push('completed_at = ?');
      params.push(now);
    }
    if (stopReason !== undefined) {
      sets.push('stop_reason = ?');
      params.push(String(stopReason));
    }
    if (approvedBy !== undefined) {
      sets.push('approved_by = ?', 'approved_at = ?');
      params.push(approvedBy, now);
    }
    params.push(id);
    db.run(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, params);

    const updated = this.getById(id);
    recordSyncEvent('system.health', 'campaign', id, updated.version, { status: updated.status, stopReason: updated.stopReason });
    writeAudit({
      actorUsername: actor,
      action: `campaign.${status.toLowerCase()}`,
      resourceType: 'campaign',
      resourceId: id,
      details: { stopReason: stopReason || '' }
    });
    return updated;
  }

  addContacts(campaignId, items = []) {
    return db.withTransaction(() => {
      const now = new Date().toISOString();
      const insertCc = db.prepare(`
        INSERT INTO campaign_contacts
          (id, campaign_id, contact_id, phone, rendered_message, status, reason, account_id, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(campaign_id, contact_id) DO NOTHING
      `);
      let inserted = 0;
      for (const item of items) {
        const res = insertCc.run(
          item.id || `cc_${crypto.randomUUID()}`,
          campaignId,
          item.contactId,
          item.phone,
          item.renderedMessage || '',
          item.status || 'PENDING',
          item.reason || '',
          item.accountId || null,
          now,
          now
        );
        inserted += Number(res.changes || 0);
      }
      return inserted;
    });
  }

  listCampaignContacts(campaignId, { limit = 50, offset = 0 } = {}) {
    return db.queryAll(
      `SELECT cc.*, c.name AS contact_name, c.zalo_name
       FROM campaign_contacts cc
       JOIN contacts c ON c.id = cc.contact_id
       WHERE cc.campaign_id = ?
       ORDER BY cc.updated_at DESC
       LIMIT ? OFFSET ?`,
      [campaignId, Number(limit), Number(offset)]
    );
  }
}

module.exports = new CampaignRepo();
