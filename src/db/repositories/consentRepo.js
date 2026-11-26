const crypto = require('crypto');
const db = require('../database');
const { enqueueOutbox, recordSyncEvent, writeAudit } = require('./common');

class ConsentRepo {
  mapRow(r) {
    if (!r) return null;
    return {
      id: r.id,
      contactId: r.contact_id,
      phone: r.phone,
      status: r.status, // OPTED_IN | OPTED_OUT | UNKNOWN
      source: r.source,
      scope: r.scope,
      consentedAt: r.consented_at,
      revokedAt: r.revoked_at,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version
    };
  }

  getByPhone(phone) {
    const row = db.queryOne('SELECT * FROM contact_consents WHERE phone = ?', [String(phone || '').trim()]);
    return this.mapRow(row);
  }

  list({ status = null, search = '', limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (status && status !== 'ALL') {
      where.push('cc.status = ?');
      params.push(status);
    }
    if (search) {
      where.push('(cc.phone LIKE ? OR COALESCE(c.name, \'\') LIKE ? OR cc.source LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = db.queryOne(
      `SELECT COUNT(*) AS cnt FROM contact_consents cc LEFT JOIN contacts c ON c.id = cc.contact_id ${whereClause}`,
      params
    );
    const items = db
      .queryAll(
        `SELECT cc.*, c.name AS contact_name
         FROM contact_consents cc
         LEFT JOIN contacts c ON c.id = cc.contact_id
         ${whereClause}
         ORDER BY cc.updated_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), Number(offset)]
      )
      .map((r) => ({ ...this.mapRow(r), contactName: r.contact_name || '' }));

    return { total: totalRow ? Number(totalRow.cnt) : 0, items };
  }

  getStats() {
    const rows = db.queryAll('SELECT status, COUNT(*) AS cnt FROM contact_consents GROUP BY status');
    const summary = { OPTED_IN: 0, OPTED_OUT: 0, UNKNOWN: 0 };
    for (const r of rows) {
      summary[r.status] = Number(r.cnt);
    }
    return summary;
  }

  /**
   * Ghi nhận đồng ý (OPTED_IN) hoặc từ chối (OPTED_OUT) cho 1 SĐT.
   */
  upsertConsent({
    phone,
    contactId = null,
    status = 'OPTED_IN',
    source = 'manual_import',
    scope = 'zalo_notification',
    note = '',
    actor = 'system'
  }) {
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) throw new Error('Số điện thoại không được trống.');
    if (!['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'].includes(status)) {
      throw new Error('Trạng thái consent phải là OPTED_IN, OPTED_OUT hoặc UNKNOWN.');
    }

    const now = new Date().toISOString();
    const existing = this.getByPhone(cleanPhone);

    const resolvedContact =
      contactId ||
      db.queryOne('SELECT id FROM contacts WHERE phone = ?', [cleanPhone])?.id ||
      null;

    if (existing) {
      const nextVersion = existing.version + 1;
      const consentedAt = status === 'OPTED_IN' ? now : existing.consentedAt;
      const revokedAt = status === 'OPTED_OUT' ? now : status === 'OPTED_IN' ? null : existing.revokedAt;
      db.run(
        `UPDATE contact_consents
         SET contact_id = COALESCE(?, contact_id),
             status = ?,
             source = ?,
             scope = ?,
             consented_at = ?,
             revoked_at = ?,
             note = ?,
             updated_at = ?,
             version = ?
         WHERE id = ?`,
        [resolvedContact, status, source || existing.source, scope || existing.scope, consentedAt, revokedAt, note, now, nextVersion, existing.id]
      );
      if (resolvedContact && status === 'OPTED_OUT') {
        db.run(
          `UPDATE contacts SET status = 'OPTED_OUT', reason = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
          ['Khách hàng đã từ chối nhận tin (Opt-out)', now, resolvedContact]
        );
      }
      const saved = this.getByPhone(cleanPhone);
      enqueueOutbox('consent', saved.id, 'UPSERT', saved.version, saved);
      recordSyncEvent('contact.updated', 'consent', saved.id, saved.version, saved);
      writeAudit({
        actorUsername: actor,
        action: `consent.${status.toLowerCase()}`,
        resourceType: 'consent',
        resourceId: saved.id,
        details: { phone: cleanPhone, source, scope }
      });
      return saved;
    }

    const id = `cns_${crypto.randomUUID()}`;
    const consentedAt = status === 'OPTED_IN' ? now : null;
    const revokedAt = status === 'OPTED_OUT' ? now : null;
    db.run(
      `INSERT INTO contact_consents
        (id, contact_id, phone, status, source, scope, consented_at, revoked_at, note, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, resolvedContact, cleanPhone, status, source, scope, consentedAt, revokedAt, note, now, now]
    );
    if (resolvedContact && status === 'OPTED_OUT') {
      db.run(
        `UPDATE contacts SET status = 'OPTED_OUT', reason = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
        ['Khách hàng đã từ chối nhận tin (Opt-out)', now, resolvedContact]
      );
    }
    const saved = this.getByPhone(cleanPhone);
    enqueueOutbox('consent', saved.id, 'UPSERT', saved.version, saved);
    writeAudit({
      actorUsername: actor,
      action: `consent.${status.toLowerCase()}`,
      resourceType: 'consent',
      resourceId: saved.id,
      details: { phone: cleanPhone, source, scope }
    });
    return saved;
  }

  /**
   * Kiểm tra liên hệ có được phép nhắn tin hay không.
   * Danh sách từ chối (OPTED_OUT) luôn chặn vô điều kiện.
   * Khi requireOptIn = true, chỉ OPTED_IN mới được phép gửi.
   */
  canMessagePhone(phone, { requireOptIn = true } = {}) {
    const clean = String(phone || '').trim();
    if (!clean) return { allowed: false, status: 'UNKNOWN', reason: 'Thiếu số điện thoại' };
    const consent = this.getByPhone(clean);
    if (consent && consent.status === 'OPTED_OUT') {
      return {
        allowed: false,
        status: 'OPTED_OUT',
        reason: 'SĐT nằm trong danh sách từ chối nhận tin (Opt-out)'
      };
    }
    if (requireOptIn && (!consent || consent.status !== 'OPTED_IN')) {
      return {
        allowed: false,
        status: consent ? consent.status : 'UNKNOWN',
        reason: 'Chưa xác nhận đồng ý nhận tin (Opt-in Consent)'
      };
    }
    return {
      allowed: true,
      status: consent ? consent.status : 'UNKNOWN',
      consent
    };
  }
}

module.exports = new ConsentRepo();
