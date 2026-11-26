const crypto = require('crypto');
const db = require('../database');
const { recordSyncEvent, enqueueOutbox, writeAudit } = require('./common');

function msgDedupeHash(direction, body, timestampBucket = '') {
  return crypto
    .createHash('sha256')
    .update(`${direction}|${String(body || '').trim()}|${timestampBucket}`)
    .digest('hex')
    .slice(0, 24);
}

class ConversationRepo {
  mapConv(r) {
    if (!r) return null;
    return {
      id: r.id,
      externalThreadId: r.external_thread_id,
      accountId: r.account_id,
      accountName: r.account_name || '',
      contactId: r.contact_id,
      phone: r.phone,
      customerName: r.customer_name,
      matchStatus: r.match_status,
      lastMessageText: r.last_message_text,
      lastMessageDirection: r.last_message_direction,
      lastMessageAt: r.last_message_at,
      unreadCount: Number(r.unread_count || 0),
      assignedUserId: r.assigned_user_id,
      assignedUsername: r.assigned_username || '',
      internalNote: r.internal_note,
      sidebarRank: r.sidebar_rank,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version
    };
  }

  list({ accountId = null, matchStatus = null, unreadOnly = false, search = '', limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (accountId && accountId !== 'ALL') {
      where.push('conv.account_id = ?');
      params.push(accountId);
    }
    if (matchStatus && matchStatus !== 'ALL') {
      where.push('conv.match_status = ?');
      params.push(matchStatus);
    }
    if (unreadOnly) {
      where.push('conv.unread_count > 0');
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where.push('(conv.customer_name LIKE ? OR conv.phone LIKE ? OR conv.last_message_text LIKE ?)');
      params.push(q, q, q);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = db.queryOne(`SELECT COUNT(*) AS cnt FROM conversations conv ${whereClause}`, params);
    const rows = db.queryAll(
      `SELECT conv.*, a.name AS account_name, u.username AS assigned_username
       FROM conversations conv
       LEFT JOIN accounts a ON a.id = conv.account_id
       LEFT JOIN users u ON u.id = conv.assigned_user_id
       ${whereClause}
       ORDER BY conv.last_message_at DESC, conv.sidebar_rank ASC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    return {
      total: totalRow ? Number(totalRow.cnt) : 0,
      items: rows.map((r) => this.mapConv(r))
    };
  }

  getById(id) {
    const row = db.queryOne(
      `SELECT conv.*, a.name AS account_name, u.username AS assigned_username
       FROM conversations conv
       LEFT JOIN accounts a ON a.id = conv.account_id
       LEFT JOIN users u ON u.id = conv.assigned_user_id
       WHERE conv.id = ?`,
      [id]
    );
    return this.mapConv(row);
  }

  getMessages(conversationId, limit = 100) {
    return db.queryAll(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?`,
      [conversationId, Number(limit)]
    );
  }

  /**
   * Ghi nhận hội thoại theo ID ổn định (`externalThreadId` ưu tiên).
   * KHÔNG tự gộp mù theo tên hiển thị nếu có nhiều contact trùng tên -> gắn cờ `NEEDS_VERIFICATION`!
   */
  recordInboundOrOutbound({
    externalThreadId = null,
    accountId = null,
    contactId = null,
    phone = '',
    customerName = '',
    direction = 'INBOUND',
    channel = 'zalo_web',
    body = '',
    externalMsgId = null,
    timestamp = null,
    sidebarRank = 0
  }) {
    const now = timestamp || new Date().toISOString();
    return db.withTransaction(() => {
      let conv = null;
      if (externalThreadId && accountId) {
        conv = db.queryOne(
          'SELECT * FROM conversations WHERE account_id = ? AND external_thread_id = ?',
          [accountId, externalThreadId]
        );
      }
      if (!conv && contactId && accountId) {
        conv = db.queryOne(
          'SELECT * FROM conversations WHERE account_id = ? AND contact_id = ?',
          [accountId, contactId]
        );
      }

      // Xác định liên kết contact an toàn
      let resolvedContactId = contactId;
      let resolvedPhone = phone;
      let matchStatus = resolvedContactId ? 'VERIFIED' : 'UNLINKED';

      if (!resolvedContactId && customerName) {
        const exactMatches = db.queryAll(
          `SELECT id, phone, name, zalo_name FROM contacts
           WHERE LOWER(TRIM(zalo_name)) = LOWER(TRIM(?)) OR LOWER(TRIM(name)) = LOWER(TRIM(?))`,
          [customerName, customerName]
        );
        if (exactMatches.length === 1) {
          resolvedContactId = exactMatches[0].id;
          resolvedPhone = resolvedPhone || exactMatches[0].phone;
          matchStatus = 'NEEDS_VERIFICATION'; // Cần xác minh thủ công nếu chưa có thread ID / SĐT khớp tuyệt đối
        } else if (exactMatches.length > 1) {
          // Nhiều khách trùng tên (vd nhiều người tên "Khiêm") -> KHÔNG tự đoán!
          matchStatus = 'NEEDS_VERIFICATION';
        }
      }

      let isNewConv = false;
      if (!conv) {
        isNewConv = true;
        const convId = `cnv_${crypto.randomUUID()}`;
        db.run(
          `INSERT INTO conversations
            (id, external_thread_id, account_id, contact_id, phone, customer_name, match_status,
             last_message_text, last_message_direction, last_message_at, unread_count, sidebar_rank, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            convId,
            externalThreadId || null,
            accountId,
            resolvedContactId || null,
            resolvedPhone || '',
            customerName || resolvedPhone || 'Khách hàng',
            matchStatus,
            body,
            direction,
            now,
            direction === 'INBOUND' ? 1 : 0,
            sidebarRank,
            now,
            now
          ]
        );
        conv = db.queryOne('SELECT * FROM conversations WHERE id = ?', [convId]);
      }

      // Chống trùng tin nhắn bằng dedupe hash hoặc externalMsgId
      const bucket = externalMsgId || String(body || '').trim();
      const dedupe = msgDedupeHash(direction, body, externalMsgId ? externalMsgId : now.slice(0, 16));
      const dup = db.queryOne(
        'SELECT id FROM messages WHERE conversation_id = ? AND dedupe_hash = ?',
        [conv.id, dedupe]
      );

      let insertedMsg = null;
      if (!dup) {
        const msgId = `msg_${crypto.randomUUID()}`;
        db.run(
          `INSERT INTO messages (id, conversation_id, direction, channel, sender_name, body, external_msg_id, dedupe_hash, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            msgId,
            conv.id,
            direction,
            channel,
            direction === 'INBOUND' ? customerName : 'Hệ thống',
            body,
            externalMsgId,
            dedupe,
            direction === 'INBOUND' ? 'RECEIVED' : 'SENT',
            now
          ]
        );
        insertedMsg = db.queryOne('SELECT * FROM messages WHERE id = ?', [msgId]);

        if (!isNewConv) {
          db.run(
            `UPDATE conversations
             SET last_message_text = ?,
                 last_message_direction = ?,
                 last_message_at = ?,
                 unread_count = unread_count + ?,
                 sidebar_rank = ?,
                 updated_at = ?,
                 version = version + 1
             WHERE id = ?`,
            [body, direction, now, direction === 'INBOUND' ? 1 : 0, sidebarRank, now, conv.id]
          );
        }

        if (direction === 'INBOUND') {
          db.run(
            `INSERT INTO notifications (id, type, entity_type, entity_id, title, body, is_seen, created_at)
             VALUES (?, 'conversation.reply', 'conversation', ?, ?, ?, 0, ?)`,
            [
              `ntf_${crypto.randomUUID()}`,
              conv.id,
              `${customerName || resolvedPhone || 'Khách hàng'} phản hồi`,
              body.slice(0, 120),
              now
            ]
          );
        }
      }

      const fresh = this.getById(conv.id);
      if (insertedMsg) {
        enqueueOutbox('conversation', fresh.id, 'UPSERT', fresh.version, fresh);
        recordSyncEvent('conversation.updated', 'conversation', fresh.id, fresh.version, {
          conversation: fresh,
          newMessage: insertedMsg
        });
      }
      return { conversation: fresh, message: insertedMsg, isNewMessage: Boolean(insertedMsg) };
    });
  }

  verifyLink(conversationId, { contactId, actor = 'operator' }) {
    const contact = db.queryOne('SELECT * FROM contacts WHERE id = ?', [contactId]);
    if (!contact) throw new Error('Không tìm thấy liên hệ để ghép hội thoại.');
    const now = new Date().toISOString();
    db.run(
      `UPDATE conversations
       SET contact_id = ?, phone = ?, match_status = 'VERIFIED', updated_at = ?, version = version + 1
       WHERE id = ?`,
      [contact.id, contact.phone, now, conversationId]
    );
    writeAudit({
      actorUsername: actor,
      action: 'conversation.verified',
      resourceType: 'conversation',
      resourceId: conversationId,
      details: { contactId: contact.id, phone: contact.phone }
    });
    const updated = this.getById(conversationId);
    recordSyncEvent('conversation.updated', 'conversation', updated.id, updated.version, { conversation: updated });
    return updated;
  }

  assignConversation(conversationId, { userId = null, internalNote = undefined, actor = 'operator' }) {
    const now = new Date().toISOString();
    const sets = ['updated_at = ?', 'version = version + 1'];
    const params = [now];
    if (userId !== undefined) {
      sets.push('assigned_user_id = ?');
      params.push(userId || null);
    }
    if (internalNote !== undefined) {
      sets.push('internal_note = ?');
      params.push(String(internalNote));
    }
    params.push(conversationId);
    db.run(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, params);
    const updated = this.getById(conversationId);
    writeAudit({
      actorUsername: actor,
      action: 'conversation.updated',
      resourceType: 'conversation',
      resourceId: conversationId,
      details: { userId }
    });
    return updated;
  }

  markRead(conversationId = null) {
    const now = new Date().toISOString();
    if (conversationId) {
      db.run('UPDATE conversations SET unread_count = 0, updated_at = ?, version = version + 1 WHERE id = ?', [
        now,
        conversationId
      ]);
      db.run(`UPDATE notifications SET is_seen = 1, seen_at = ? WHERE entity_id = ? AND is_seen = 0`, [
        now,
        conversationId
      ]);
    } else {
      db.run('UPDATE conversations SET unread_count = 0, updated_at = ?, version = version + 1 WHERE unread_count > 0', [now]);
      db.run('UPDATE notifications SET is_seen = 1, seen_at = ? WHERE is_seen = 0', [now]);
    }
  }

  listUnreadNotifications() {
    return db.queryAll('SELECT * FROM notifications WHERE is_seen = 0 ORDER BY created_at DESC LIMIT 30');
  }
}

module.exports = new ConversationRepo();
