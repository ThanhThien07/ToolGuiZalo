const crypto = require('crypto');
const db = require('../database');
const { recordSyncEvent, writeAudit } = require('./common');

/**
 * Repository cho Task Engine bền vững (Roadmap Mục 8):
 * Trạng thái: PENDING -> ASSIGNED -> PROCESSING -> COMPLETED / FAILED / REVIEW / CANCELLED
 */
class TaskRepo {
  mapTask(r) {
    if (!r) return null;
    return {
      id: r.id,
      campaignId: r.campaign_id,
      campaignContactId: r.campaign_contact_id,
      contactId: r.contact_id,
      phone: r.phone,
      accountId: r.account_id,
      deviceId: r.device_id,
      status: r.status,
      idempotencyKey: r.idempotency_key,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      leaseOwner: r.lease_owner,
      leaseExpiresAt: r.lease_expires_at,
      heartbeatAt: r.heartbeat_at,
      resultCode: r.result_code,
      resultReason: r.result_reason,
      zaloName: r.zalo_name,
      sentMessage: r.sent_message,
      reviewNote: r.review_note,
      contactName: r.contact_name || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      version: r.version
    };
  }

  enqueueCampaignTasks(campaignId, entries = []) {
    return db.withTransaction(() => {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO tasks
          (id, campaign_id, campaign_contact_id, contact_id, phone, account_id, status, idempotency_key, attempts, max_attempts, sent_message, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, 1, ?, ?, ?, 1)
        ON CONFLICT(idempotency_key) DO NOTHING
      `);
      let count = 0;
      for (const e of entries) {
        const idempKey = e.idempotencyKey || `${campaignId}:${e.contactId}`;
        const res = stmt.run(
          `tsk_${crypto.randomUUID()}`,
          campaignId,
          e.campaignContactId || null,
          e.contactId,
          e.phone,
          e.accountId || null,
          idempKey,
          e.renderedMessage || '',
          now,
          now
        );
        count += Number(res.changes || 0);
      }
      return count;
    });
  }

  getById(id) {
    const row = db.queryOne(
      `SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE t.id = ?`,
      [id]
    );
    return this.mapTask(row);
  }

  list({ campaignId = null, status = null, limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (campaignId) {
      where.push('t.campaign_id = ?');
      params.push(campaignId);
    }
    if (status && status !== 'ALL') {
      where.push('t.status = ?');
      params.push(status);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = db.queryOne(`SELECT COUNT(*) AS cnt FROM tasks t ${whereClause}`, params);
    const rows = db.queryAll(
      `SELECT t.*, c.name AS contact_name
       FROM tasks t
       LEFT JOIN contacts c ON c.id = t.contact_id
       ${whereClause}
       ORDER BY t.updated_at DESC, t.created_at ASC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    return {
      total: totalRow ? Number(totalRow.cnt) : 0,
      items: rows.map((r) => this.mapTask(r))
    };
  }

  /**
   * Giao dịch nhận việc có khóa thời hạn (atomic transactional claim).
   * Đảm bảo không bao giờ 2 worker bốc trùng 1 task.
   */
  claimNextTask({ campaignId = null, workerId, accountId = null, deviceId = null, leaseMs = 90000 }) {
    return db.withTransaction(() => {
      const now = new Date();
      const nowIso = now.toISOString();
      const leaseExpIso = new Date(now.getTime() + leaseMs).toISOString();

      const candidate = campaignId
        ? db.queryOne(
            `SELECT * FROM tasks WHERE campaign_id = ? AND status = 'PENDING' ORDER BY created_at ASC LIMIT 1`,
            [campaignId]
          )
        : db.queryOne(
            `SELECT t.* FROM tasks t
             JOIN campaigns cmp ON cmp.id = t.campaign_id
             WHERE cmp.status = 'RUNNING' AND t.status = 'PENDING'
             ORDER BY t.created_at ASC LIMIT 1`
          );
      if (!candidate) return null;

      const updateRes = db.run(
        `UPDATE tasks
         SET status = 'ASSIGNED',
             account_id = COALESCE(?, account_id),
             device_id = COALESCE(?, device_id),
             lease_owner = ?,
             lease_expires_at = ?,
             heartbeat_at = ?,
             updated_at = ?,
             version = version + 1
         WHERE id = ? AND status = 'PENDING' AND version = ?`,
        [accountId, deviceId, workerId, leaseExpIso, nowIso, nowIso, candidate.id, candidate.version]
      );
      if (!updateRes.changes) return null;

      if (candidate.campaign_contact_id) {
        db.run(`UPDATE campaign_contacts SET status = 'ASSIGNED', updated_at = ?, version = version + 1 WHERE id = ?`, [
          nowIso,
          candidate.campaign_contact_id
        ]);
      }

      const claimed = this.getById(candidate.id);
      recordSyncEvent('task.updated', 'task', claimed.id, claimed.version, {
        status: claimed.status,
        campaignId: claimed.campaignId,
        contactId: claimed.contactId
      });
      return claimed;
    });
  }

  startProcessing(taskId, { workerId, accountId = null, deviceId = null } = {}) {
    return db.withTransaction(() => {
      const task = this.getById(taskId);
      if (!task || !['ASSIGNED', 'PENDING'].includes(task.status)) return null;
      const now = new Date().toISOString();
      const attemptNo = (task.attempts || 0) + 1;
      const attemptId = `att_${crypto.randomUUID()}`;

      db.run(
        `UPDATE tasks
         SET status = 'PROCESSING',
             attempts = ?,
             lease_owner = COALESCE(?, lease_owner),
             heartbeat_at = ?,
             updated_at = ?,
             version = version + 1
         WHERE id = ?`,
        [attemptNo, workerId || null, now, now, taskId]
      );

      db.run(
        `INSERT INTO task_attempts (id, task_id, attempt_no, account_id, device_id, status, idempotency_key, started_at)
         VALUES (?, ?, ?, ?, ?, 'STARTED', ?, ?)`,
        [attemptId, taskId, attemptNo, accountId || task.accountId, deviceId || task.deviceId, task.idempotencyKey, now]
      );

      if (task.campaignContactId) {
        db.run(`UPDATE campaign_contacts SET status = 'PROCESSING', updated_at = ?, version = version + 1 WHERE id = ?`, [
          now,
          task.campaignContactId
        ]);
      }
      db.run(`UPDATE contacts SET status = 'PROCESSING', updated_at = ?, version = version + 1 WHERE id = ?`, [
        now,
        task.contactId
      ]);

      const updated = this.getById(taskId);
      recordSyncEvent('task.updated', 'task', updated.id, updated.version, { status: 'PROCESSING', attemptId });
      return { task: updated, attemptId };
    });
  }

  heartbeat(taskId, leaseMs = 90000) {
    const now = new Date();
    const leaseExpIso = new Date(now.getTime() + leaseMs).toISOString();
    db.run(
      `UPDATE tasks SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('ASSIGNED', 'PROCESSING')`,
      [now.toISOString(), leaseExpIso, now.toISOString(), taskId]
    );
  }

  /**
   * Kết thúc task sau khi thực thi ngoài:
   * - COMPLETED / FAILED (lỗi rõ ràng trước gửi như SAI_SO / KHONG_DANG_KY) / REVIEW (không chắc chắn đã gửi hay chưa!)
   */
  finalizeTask(taskId, { finalStatus, resultCode, reason = '', zaloName = '', sentMessage = '', accountId = null, accountName = '', attemptId = null } = {}) {
    if (!['COMPLETED', 'FAILED', 'REVIEW', 'CANCELLED'].includes(finalStatus)) {
      throw new Error(`finalStatus không hợp lệ: ${finalStatus}`);
    }
    return db.withTransaction(() => {
      const task = this.getById(taskId);
      if (!task) return null;
      const now = new Date().toISOString();

      db.run(
        `UPDATE tasks
         SET status = ?,
             result_code = ?,
             result_reason = ?,
             zalo_name = ?,
             sent_message = CASE WHEN ? != '' THEN ? ELSE sent_message END,
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?,
             version = version + 1
         WHERE id = ?`,
        [finalStatus, resultCode || finalStatus, reason, zaloName, sentMessage || '', sentMessage || '', now, taskId]
      );

      if (attemptId) {
        db.run(
          `UPDATE task_attempts SET status = ?, error_message = ?, finished_at = ? WHERE id = ?`,
          [finalStatus, finalStatus === 'COMPLETED' ? '' : reason, now, attemptId]
        );
      }

      if (task.campaignContactId) {
        db.run(
          `UPDATE campaign_contacts SET status = ?, reason = ?, account_id = COALESCE(?, account_id), updated_at = ?, version = version + 1 WHERE id = ?`,
          [finalStatus, reason, accountId, now, task.campaignContactId]
        );
      }

      // Cập nhật trạng thái tổng hợp trên contacts nếu có mã kết quả nghiệp vụ rõ
      const contactStatus =
        finalStatus === 'REVIEW'
          ? 'REVIEW'
          : resultCode || (finalStatus === 'COMPLETED' ? 'THANH_CONG' : 'LOI');

      db.run(
        `UPDATE contacts
         SET status = ?,
             zalo_name = CASE WHEN ? != '' THEN ? ELSE zalo_name END,
             reason = ?,
             sent_by_account = CASE WHEN ? != '' THEN ? ELSE sent_by_account END,
             sent_by_account_id = COALESCE(?, sent_by_account_id),
             sent_message = CASE WHEN ? != '' THEN ? ELSE sent_message END,
             sent_at = CASE WHEN ? = 'THANH_CONG' THEN ? ELSE sent_at END,
             updated_at = ?,
             version = version + 1
         WHERE id = ?`,
        [
          contactStatus,
          zaloName || '',
          zaloName || '',
          reason,
          accountName || '',
          accountName || '',
          accountId,
          sentMessage || '',
          sentMessage || '',
          contactStatus,
          now,
          now,
          task.contactId
        ]
      );

      const updated = this.getById(taskId);
      recordSyncEvent('task.updated', 'task', updated.id, updated.version, {
        status: updated.status,
        resultCode: updated.resultCode,
        campaignId: updated.campaignId
      });
      return updated;
    });
  }

  /**
   * Khôi phục an toàn sau crash / restart:
   * - Task đang PROCESSING (có thể đã chạm thao tác bên ngoài) -> chuyển sang REVIEW (KHÔNG tự gửi lại gây gửi trùng!)
   * - Task mới ASSIGNED (chưa chạy external action) hoặc hết lease -> trả về PENDING
   */
  recoverInterruptedTasks({ actor = 'startup_recovery' } = {}) {
    return db.withTransaction(() => {
      const now = new Date().toISOString();
      const processingTasks = db.queryAll(`SELECT * FROM tasks WHERE status = 'PROCESSING'`);
      const assignedTasks = db.queryAll(
        `SELECT * FROM tasks WHERE status = 'ASSIGNED' AND (lease_expires_at IS NULL OR lease_expires_at <= ? OR 1=1)`,
        [now]
      );

      for (const t of processingTasks) {
        db.run(
          `UPDATE tasks SET status = 'REVIEW', result_code = 'INTERRUPTED', result_reason = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?`,
          ['Tác vụ bị gián đoạn khi đang gửi (chuyển REVIEW để tránh gửi trùng)', now, t.id]
        );
        if (t.campaign_contact_id) {
          db.run(`UPDATE campaign_contacts SET status = 'REVIEW', reason = ?, updated_at = ? WHERE id = ?`, [
            'Bị gián đoạn khi đang gửi — cần kiểm tra',
            now,
            t.campaign_contact_id
          ]);
        }
        db.run(`UPDATE contacts SET status = 'REVIEW', reason = ?, updated_at = ? WHERE id = ?`, [
          'Bị gián đoạn khi đang gửi — chuyển REVIEW',
          now,
          t.contact_id
        ]);
      }

      for (const t of assignedTasks) {
        db.run(
          `UPDATE tasks SET status = 'PENDING', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?`,
          [now, t.id]
        );
        if (t.campaign_contact_id) {
          db.run(`UPDATE campaign_contacts SET status = 'PENDING', updated_at = ? WHERE id = ?`, [
            now,
            t.campaign_contact_id
          ]);
        }
        db.run(`UPDATE contacts SET status = 'PENDING', updated_at = ? WHERE id = ? AND status = 'PROCESSING'`, [
          now,
          t.contact_id
        ]);
      }

      if (processingTasks.length > 0 || assignedTasks.length > 0) {
        writeAudit({
          actorUsername: actor,
          action: 'tasks.recovered',
          resourceType: 'task',
          details: { movedToReview: processingTasks.length, returnedToPending: assignedTasks.length }
        });
      }

      return {
        movedToReview: processingTasks.length,
        returnedToPending: assignedTasks.length
      };
    });
  }

  resolveReviewTask(taskId, { resolution = 'COMPLETED', note = '', actor = 'operator' } = {}) {
    if (!['COMPLETED', 'FAILED', 'CANCELLED', 'PENDING'].includes(resolution)) {
      throw new Error('Quyết định REVIEW phải là COMPLETED, FAILED, CANCELLED hoặc PENDING.');
    }
    const now = new Date().toISOString();
    return db.withTransaction(() => {
      const task = this.getById(taskId);
      if (!task) return null;
      db.run(
        `UPDATE tasks SET status = ?, review_note = ?, result_reason = CASE WHEN ? != '' THEN ? ELSE result_reason END, updated_at = ?, version = version + 1 WHERE id = ?`,
        [resolution, note, note, note, now, taskId]
      );
      const contactStatus =
        resolution === 'COMPLETED' ? 'THANH_CONG' : resolution === 'FAILED' ? 'LOI' : 'PENDING';
      db.run(`UPDATE contacts SET status = ?, reason = ?, updated_at = ?, version = version + 1 WHERE id = ?`, [
        contactStatus,
        note || `Xác nhận từ hàng chờ REVIEW (${resolution})`,
        now,
        task.contactId
      ]);
      writeAudit({
        actorUsername: actor,
        action: 'task.review_resolved',
        resourceType: 'task',
        resourceId: taskId,
        details: { resolution, note }
      });
      return this.getById(taskId);
    });
  }

  cancelCampaignTasks(campaignId, reason = 'Chiến dịch đã hủy') {
    const now = new Date().toISOString();
    db.run(
      `UPDATE tasks SET status = 'CANCELLED', result_reason = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, version = version + 1
       WHERE campaign_id = ? AND status IN ('PENDING', 'ASSIGNED')`,
      [reason, now, campaignId]
    );
  }

  listAttempts(taskId) {
    return db.queryAll('SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt_no ASC', [taskId]);
  }
}

module.exports = new TaskRepo();
