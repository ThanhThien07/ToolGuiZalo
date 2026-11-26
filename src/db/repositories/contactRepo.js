const crypto = require('crypto');
const db = require('../database');
const { safeParseJson, enqueueOutbox, recordSyncEvent } = require('./common');

class ContactRepo {
  mapRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      phone: row.phone,
      rawPhone: row.raw_phone,
      name: row.name,
      zaloName: row.zalo_name,
      info: row.info,
      customMessage: row.custom_message,
      note: row.note,
      extraFields: safeParseJson(row.extra_fields_json, {}),
      status: row.status,
      reason: row.reason,
      sentByAccount: row.sent_by_account,
      sentByAccountId: row.sent_by_account_id,
      sentMessage: row.sent_message,
      sentAt: row.sent_at,
      results: safeParseJson(row.results_json, {}),
      consentStatus: row.consent_status || 'UNKNOWN',
      consentSource: row.consent_source || '',
      tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version
    };
  }

  getById(id) {
    const row = db.queryOne(
      `SELECT c.*, cc.status AS consent_status, cc.source AS consent_source,
              GROUP_CONCAT(t.name) AS tags
       FROM contacts c
       LEFT JOIN contact_consents cc ON cc.phone = c.phone
       LEFT JOIN contact_tag_links ctl ON ctl.contact_id = c.id
       LEFT JOIN contact_tags t ON t.id = ctl.tag_id
       WHERE c.id = ?
       GROUP BY c.id`,
      [id]
    );
    return this.mapRow(row);
  }

  getByPhone(phone) {
    const row = db.queryOne(
      `SELECT c.*, cc.status AS consent_status, cc.source AS consent_source,
              GROUP_CONCAT(t.name) AS tags
       FROM contacts c
       LEFT JOIN contact_consents cc ON cc.phone = c.phone
       LEFT JOIN contact_tag_links ctl ON ctl.contact_id = c.id
       LEFT JOIN contact_tags t ON t.id = ctl.tag_id
       WHERE c.phone = ?
       GROUP BY c.id`,
      [String(phone || '').trim()]
    );
    return this.mapRow(row);
  }

  /**
   * Truy vấn phân trang phía server (hiệu năng cao cho 50.000+ bản ghi)
   */
  listPaginated({ status = 'ALL', search = '', consent = '', tag = '', limit = 25, offset = 0, cursorUpdatedAt = null, cursorId = null } = {}) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 25));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const where = [];
    const params = [];

    if (status && status !== 'ALL') {
      if (status === 'PENDING') {
        where.push("c.status IN ('PENDING', 'PROCESSING')");
      } else if (status === 'SAI_SO') {
        where.push("c.status IN ('SAI_SO', 'LOI')");
      } else {
        where.push('c.status = ?');
        params.push(status);
      }
    }

    if (consent && ['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'].includes(consent)) {
      if (consent === 'UNKNOWN') {
        where.push("(cc.status IS NULL OR cc.status = 'UNKNOWN')");
      } else {
        where.push('cc.status = ?');
        params.push(consent);
      }
    }

    if (tag) {
      where.push('EXISTS (SELECT 1 FROM contact_tag_links ctl2 JOIN contact_tags t2 ON t2.id = ctl2.tag_id WHERE ctl2.contact_id = c.id AND t2.name = ?)');
      params.push(tag);
    }

    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where.push('(c.phone LIKE ? OR c.name LIKE ? OR c.zalo_name LIKE ? OR c.info LIKE ? OR c.reason LIKE ?)');
      params.push(q, q, q, q, q);
    }

    if (cursorUpdatedAt && cursorId) {
      where.push('(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))');
      params.push(cursorUpdatedAt, cursorUpdatedAt, cursorId);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const needConsentJoinForFilter = Boolean(consent);
    const countSql = needConsentJoinForFilter
      ? `SELECT COUNT(*) AS cnt FROM contacts c LEFT JOIN contact_consents cc ON cc.phone = c.phone ${whereClause}`
      : `SELECT COUNT(*) AS cnt FROM contacts c ${whereClause}`;
    const totalRow = db.queryOne(countSql, params);
    const total = totalRow ? Number(totalRow.cnt) : 0;

    const rows = db.queryAll(
      `SELECT c.*, cc.status AS consent_status, cc.source AS consent_source,
              (SELECT GROUP_CONCAT(t.name) FROM contact_tag_links ctl JOIN contact_tags t ON t.id = ctl.tag_id WHERE ctl.contact_id = c.id) AS tags
       FROM contacts c
       LEFT JOIN contact_consents cc ON cc.phone = c.phone
       ${whereClause}
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, cursorUpdatedAt ? 0 : safeOffset]
    );

    const items = rows.map((r) => this.mapRow(r));
    const last = items[items.length - 1];
    return {
      total,
      limit: safeLimit,
      offset: safeOffset,
      nextCursor: last ? { updatedAt: last.updatedAt, id: last.id } : null,
      items
    };
  }

  getAll() {
    return db
      .queryAll(
        `SELECT c.*, cc.status AS consent_status, cc.source AS consent_source
         FROM contacts c
         LEFT JOIN contact_consents cc ON cc.phone = c.phone
         ORDER BY c.updated_at DESC, c.created_at DESC`
      )
      .map((r) => this.mapRow(r));
  }

  getStats() {
    const rows = db.queryAll('SELECT status, COUNT(*) AS cnt FROM contacts GROUP BY status');
    const cacheRow = db.queryOne('SELECT COUNT(*) AS cnt FROM phone_cache');
    const stats = {
      total: 0,
      pending: 0,
      processing: 0,
      success: 0,
      blockedStranger: 0,
      notRegistered: 0,
      invalidPhone: 0,
      optedOut: 0,
      review: 0,
      error: 0,
      cacheCount: cacheRow ? Number(cacheRow.cnt) : 0
    };
    for (const r of rows) {
      const n = Number(r.cnt);
      stats.total += n;
      switch (r.status) {
        case 'PENDING':
          stats.pending += n;
          break;
        case 'PROCESSING':
          stats.processing += n;
          break;
        case 'THANH_CONG':
          stats.success += n;
          break;
        case 'CHAN_NGUOI_LA':
          stats.blockedStranger += n;
          break;
        case 'KHONG_DANG_KY':
          stats.notRegistered += n;
          break;
        case 'SAI_SO':
          stats.invalidPhone += n;
          break;
        case 'OPTED_OUT':
          stats.optedOut += n;
          break;
        case 'REVIEW':
          stats.review += n;
          break;
        default:
          stats.error += n;
          break;
      }
    }
    return stats;
  }

  /**
   * Nhập hàng loạt trong 1 transaction.
   * Không reset lịch sử chiến dịch cũ khi nhập lại (chỉ cập nhật thông tin liên hệ và tùy chọn consent).
   */
  importBatch(records, { deduplicate = true, replaceExisting = false, consentStatus = 'UNKNOWN', consentSource = 'import', tags = [] } = {}) {
    return db.withTransaction(() => {
      if (replaceExisting) {
        db.run('DELETE FROM contacts');
      }

      const now = new Date().toISOString();
      let addedCount = 0;
      let updatedCount = 0;
      const seenPhones = new Set();

      const insertContact = db.prepare(`
        INSERT INTO contacts
          (id, phone, raw_phone, name, zalo_name, info, custom_message, note, extra_fields_json, status, reason, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);

      const updateContactMeta = db.prepare(`
        UPDATE contacts
        SET name = CASE WHEN ? != '' THEN ? ELSE name END,
            info = CASE WHEN ? != '' THEN ? ELSE info END,
            custom_message = CASE WHEN ? != '' THEN ? ELSE custom_message END,
            note = CASE WHEN ? != '' THEN ? ELSE note END,
            extra_fields_json = ?,
            updated_at = ?,
            version = version + 1
        WHERE id = ?
      `);

      const findByPhone = db.prepare('SELECT id, version FROM contacts WHERE phone = ?');
      const upsertConsentStmt = db.prepare(`
        INSERT INTO contact_consents (id, contact_id, phone, status, source, scope, consented_at, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, 'zalo_notification', ?, ?, ?, 1)
        ON CONFLICT(phone) DO UPDATE SET
          contact_id = COALESCE(excluded.contact_id, contact_consents.contact_id),
          status = CASE
            WHEN contact_consents.status = 'OPTED_OUT' THEN 'OPTED_OUT'
            WHEN excluded.status = 'OPTED_IN' THEN 'OPTED_IN'
            ELSE contact_consents.status
          END,
          source = CASE WHEN contact_consents.status = 'OPTED_OUT' THEN contact_consents.source ELSE excluded.source END,
          consented_at = COALESCE(contact_consents.consented_at, excluded.consented_at),
          updated_at = excluded.updated_at,
          version = contact_consents.version + 1
      `);

      const importedIds = [];

      for (const rec of records) {
        const phoneKey = String(rec.phone || rec.rawPhone || '').trim();
        if (!phoneKey) continue;
        if (deduplicate && seenPhones.has(phoneKey)) continue;
        seenPhones.add(phoneKey);

        const existing = findByPhone.get(phoneKey);
        let contactId;
        if (existing) {
          contactId = existing.id;
          updateContactMeta.run(
            rec.name || '',
            rec.name || '',
            rec.info || '',
            rec.info || '',
            rec.customMessage || '',
            rec.customMessage || '',
            rec.note || '',
            rec.note || '',
            JSON.stringify(rec.extraFields || {}),
            now,
            contactId
          );
          updatedCount++;
        } else {
          contactId = rec.id || `ct_${crypto.randomUUID()}`;
          insertContact.run(
            contactId,
            phoneKey,
            rec.rawPhone || phoneKey,
            rec.name || '',
            rec.zaloName || '',
            rec.info || '',
            rec.customMessage || '',
            rec.note || '',
            JSON.stringify(rec.extraFields || {}),
            rec.status || 'PENDING',
            rec.reason || 'Đang chờ xử lý',
            now,
            now
          );
          addedCount++;
        }
        importedIds.push(contactId);

        if (phoneKey !== 'Từ Zalo Web') {
          const cnsStatus = rec.consentStatus || consentStatus || 'UNKNOWN';
          upsertConsentStmt.run(
            `cns_${crypto.randomUUID()}`,
            contactId,
            phoneKey,
            cnsStatus,
            rec.consentSource || consentSource,
            cnsStatus === 'OPTED_IN' ? now : null,
            now,
            now
          );
        }
      }

      if (Array.isArray(tags) && tags.length > 0 && importedIds.length > 0) {
        for (const tagName of tags) {
          const cleanTag = String(tagName || '').trim();
          if (!cleanTag) continue;
          const tagRow = this.ensureTag(cleanTag);
          const linkStmt = db.prepare('INSERT OR IGNORE INTO contact_tag_links (contact_id, tag_id, created_at) VALUES (?, ?, ?)');
          for (const cid of importedIds) {
            linkStmt.run(cid, tagRow.id, now);
          }
        }
      }

      const evt = recordSyncEvent('contact.updated', 'contacts_batch', 'batch', 1, {
        addedCount,
        updatedCount
      });
      enqueueOutbox('contacts_batch', 'batch', 'UPSERT', 1, { addedCount, updatedCount });

      return {
        addedCount,
        updatedCount,
        importedIds,
        syncEvent: evt,
        stats: this.getStats()
      };
    });
  }

  ensureTag(name, color = '#2563eb') {
    const clean = String(name || '').trim();
    const existing = db.queryOne('SELECT * FROM contact_tags WHERE LOWER(name) = LOWER(?)', [clean]);
    if (existing) return existing;
    const id = `tag_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.run('INSERT INTO contact_tags (id, name, color, created_at) VALUES (?, ?, ?, ?)', [id, clean, color, now]);
    return db.queryOne('SELECT * FROM contact_tags WHERE id = ?', [id]);
  }

  listTags() {
    return db.queryAll('SELECT * FROM contact_tags ORDER BY name ASC');
  }

  assignTag(contactId, tagName, color = '#2563eb') {
    const tag = this.ensureTag(tagName, color);
    db.run('INSERT OR IGNORE INTO contact_tag_links (contact_id, tag_id, created_at) VALUES (?, ?, ?)', [
      contactId,
      tag.id,
      new Date().toISOString()
    ]);
    return this.getById(contactId);
  }

  removeTag(contactId, tagName) {
    const tag = db.queryOne('SELECT id FROM contact_tags WHERE LOWER(name) = LOWER(?)', [String(tagName || '').trim()]);
    if (tag) {
      db.run('DELETE FROM contact_tag_links WHERE contact_id = ? AND tag_id = ?', [contactId, tag.id]);
    }
    return this.getById(contactId);
  }

  updateContact(id, patch = {}, { emitEvent = true } = {}) {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const nextVersion = (existing.version || 1) + 1;

    const merged = {
      name: patch.name !== undefined ? patch.name : existing.name,
      zaloName: patch.zaloName !== undefined ? patch.zaloName : existing.zaloName,
      info: patch.info !== undefined ? patch.info : existing.info,
      customMessage: patch.customMessage !== undefined ? patch.customMessage : existing.customMessage,
      note: patch.note !== undefined ? patch.note : existing.note,
      extraFields: patch.extraFields !== undefined ? patch.extraFields : existing.extraFields,
      status: patch.status !== undefined ? patch.status : existing.status,
      reason: patch.reason !== undefined ? patch.reason : existing.reason,
      sentByAccount: patch.sentByAccount !== undefined ? patch.sentByAccount : existing.sentByAccount,
      sentByAccountId: patch.sentByAccountId !== undefined ? patch.sentByAccountId : existing.sentByAccountId,
      sentMessage: patch.sentMessage !== undefined ? patch.sentMessage : existing.sentMessage,
      sentAt: patch.sentAt !== undefined ? patch.sentAt : existing.sentAt,
      results: patch.results !== undefined ? patch.results : existing.results
    };

    db.run(
      `UPDATE contacts
       SET name = ?, zalo_name = ?, info = ?, custom_message = ?, note = ?, extra_fields_json = ?,
           status = ?, reason = ?, sent_by_account = ?, sent_by_account_id = ?, sent_message = ?, sent_at = ?,
           results_json = ?, updated_at = ?, version = ?
       WHERE id = ?`,
      [
        merged.name,
        merged.zaloName,
        merged.info,
        merged.customMessage,
        merged.note,
        JSON.stringify(merged.extraFields || {}),
        merged.status,
        merged.reason,
        merged.sentByAccount,
        merged.sentByAccountId,
        merged.sentMessage,
        merged.sentAt,
        JSON.stringify(merged.results || {}),
        now,
        nextVersion,
        id
      ]
    );

    const updated = this.getById(id);
    enqueueOutbox('contact', id, 'UPSERT', updated.version, updated);
    if (emitEvent) {
      recordSyncEvent('contact.updated', 'contact', id, updated.version, updated);
    }
    return updated;
  }

  deleteContact(id, deletedBy = 'system') {
    const existing = this.getById(id);
    if (!existing) return false;
    const now = new Date().toISOString();
    const nextVersion = (existing.version || 1) + 1;
    db.withTransaction(() => {
      db.run('DELETE FROM contacts WHERE id = ?', [id]);
      db.run(
        `INSERT INTO tombstones (id, entity_type, entity_id, entity_version, deleted_by, deleted_at)
         VALUES (?, 'contact', ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET entity_version = excluded.entity_version, deleted_by = excluded.deleted_by, deleted_at = excluded.deleted_at`,
        [`tmb_${crypto.randomUUID()}`, id, nextVersion, deletedBy, now]
      );
      enqueueOutbox('contact', id, 'DELETE', nextVersion, { id, deletedAt: now });
      recordSyncEvent('contact.updated', 'contact', id, nextVersion, { id, deleted: true });
    });
    return true;
  }

  clearAll(deletedBy = 'system') {
    const ids = db.queryAll('SELECT id, version FROM contacts');
    const now = new Date().toISOString();
    db.withTransaction(() => {
      db.run('DELETE FROM contacts');
      const tmbStmt = db.prepare(
        `INSERT INTO tombstones (id, entity_type, entity_id, entity_version, deleted_by, deleted_at)
         VALUES (?, 'contact', ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET entity_version = excluded.entity_version, deleted_at = excluded.deleted_at`
      );
      for (const row of ids) {
        tmbStmt.run(`tmb_${crypto.randomUUID()}`, row.id, (row.version || 1) + 1, deletedBy, now);
      }
      recordSyncEvent('contact.updated', 'contacts_cleared', 'all', 1, { cleared: ids.length });
    });
    return ids.length;
  }

  resetStatus(filterStatus = 'ALL') {
    const now = new Date().toISOString();
    if (filterStatus === 'ALL') {
      db.run(
        `UPDATE contacts
         SET status = 'PENDING', reason = 'Đang chờ xử lý', updated_at = ?, version = version + 1
         WHERE status != 'SAI_SO' AND status != 'OPTED_OUT'`,
        [now]
      );
    } else {
      db.run(
        `UPDATE contacts
         SET status = 'PENDING', reason = 'Đang chờ xử lý', updated_at = ?, version = version + 1
         WHERE status = ? AND status != 'SAI_SO' AND status != 'OPTED_OUT'`,
        [now, filterStatus]
      );
    }
    recordSyncEvent('contact.updated', 'contacts_reset', filterStatus, 1, { filterStatus });
  }

  // Phone cache
  getPhoneCache(phone) {
    return db.queryOne('SELECT * FROM phone_cache WHERE phone = ?', [String(phone || '').trim()]);
  }

  setPhoneCache(phone, status, reason = '') {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO phone_cache (phone, status, reason, cached_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET status = excluded.status, reason = excluded.reason, cached_at = excluded.cached_at`,
      [phone, status, reason, now]
    );
  }

  clearPhoneCache() {
    db.run('DELETE FROM phone_cache');
  }

  getAllPhoneCacheMap() {
    const rows = db.queryAll('SELECT * FROM phone_cache');
    const out = {};
    for (const r of rows) {
      out[r.phone] = { status: r.status, reason: r.reason, at: r.cached_at };
    }
    return out;
  }
}

module.exports = new ContactRepo();
