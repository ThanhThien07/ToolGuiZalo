import { apiFetch, escapeHtml, showToast } from './api.js';
import { appState } from './state.js';

export async function loadDevicesAndSync() {
  const [devRes, syncRes, confRes] = await Promise.all([
    apiFetch('/api/v2/devices'),
    apiFetch('/api/v2/sync/info'),
    apiFetch('/api/v2/sync/conflicts?status=OPEN')
  ]);
  appState.devices = devRes.devices || [];
  appState.syncInfo = syncRes;
  appState.conflicts = confRes.conflicts || [];
  renderDevicesPanel();
}

export function renderDevicesPanel() {
  const elMeta = document.getElementById('syncMetaSummary');
  if (elMeta) {
    elMeta.innerHTML = `Cursor máy chủ: <code>${appState.syncInfo.serverCursor || 0}</code> • Outbox chờ gửi: <b>${appState.syncInfo.pendingOutbox || 0}</b> • Xung đột mở: <b class="text-warning">${appState.conflicts.length}</b>`;
  }

  const tbody = document.getElementById('tblDevicesBody');
  if (tbody) {
    tbody.innerHTML = appState.devices.length
      ? appState.devices
          .map(
            (d) => `<tr>
              <td class="fw-semibold">${escapeHtml(d.name)} <small class="text-muted">(${escapeHtml(d.hostname || '-')})</small></td>
              <td><span class="badge bg-light text-dark border">${escapeHtml(d.role)}</span></td>
              <td><span class="badge badge-${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td>
              <td><code>${d.last_seen_cursor || 0}</code></td>
              <td class="small text-muted">${d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('vi-VN') : '-'}</td>
              <td class="text-end">${
                d.status !== 'REVOKED'
                  ? `<button class="btn btn-outline-danger btn-sm py-0 px-2" data-revoke-dev="${d.id}">Thu hồi</button>`
                  : '<span class="small text-muted">Đã thu hồi</span>'
              }</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="text-center text-muted py-3">Chưa có thiết bị nào được ghép đôi.</td></tr>';
  }

  const cBody = document.getElementById('tblConflictsBody');
  if (cBody) {
    cBody.innerHTML = appState.conflicts.length
      ? appState.conflicts
          .map(
            (c) => `<tr>
              <td><code>${escapeHtml(c.entity_id)}</code></td>
              <td class="small">Local v${c.local_version}: <b>${escapeHtml(c.localPayload?.name || '-')}</b> / ${escapeHtml(c.localPayload?.info || '-')}</td>
              <td class="small">Remote v${c.remote_version}: <b>${escapeHtml(c.remotePayload?.name || '-')}</b> / ${escapeHtml(c.remotePayload?.info || '-')}</td>
              <td class="text-end">
                <button class="btn btn-sm btn-outline-primary py-0 px-2" data-resolve-conflict="${c.id}" data-decision="RESOLVED_LOCAL">Giữ Local</button>
                <button class="btn btn-sm btn-outline-success py-0 px-2" data-resolve-conflict="${c.id}" data-decision="RESOLVED_REMOTE">Nhận Remote</button>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="text-center text-muted py-2">Không có xung đột đồng bộ nào.</td></tr>';
  }
}

export async function loadMonitorAndAudit() {
  const [sysRes, auditRes] = await Promise.all([
    apiFetch('/api/v2/system/metrics'),
    apiFetch('/api/v2/audit/logs?limit=50')
  ]);
  appState.health = sysRes;
  appState.auditLogs = auditRes.items || [];
  renderMonitorPanel();
}

export function renderMonitorPanel() {
  const box = document.getElementById('systemMetricsCards');
  const h = appState.health;
  if (box && h) {
    const dbKb = Math.round((h.database?.sizeBytes || 0) / 1024);
    const walKb = Math.round((h.database?.walSizeBytes || 0) / 1024);
    box.innerHTML = `
      <div class="col-md-3"><div class="card p-3"><small class="text-muted">RAM Server</small><div class="fs-5 fw-bold">${h.memory?.rssMb || 0} MB</div><small class="text-muted">Heap: ${h.memory?.heapUsedMb || 0} MB</small></div></div>
      <div class="col-md-3"><div class="card p-3"><small class="text-muted">Event Loop Lag (p95)</small><div class="fs-5 fw-bold">${h.eventLoop?.p95LagMs ?? 0} ms</div><small class="text-muted">Uptime: ${h.uptimeSec || 0}s</small></div></div>
      <div class="col-md-3"><div class="card p-3"><small class="text-muted">SQLite WAL</small><div class="fs-5 fw-bold">${dbKb} KB</div><small class="text-muted">WAL: ${walKb} KB</small></div></div>
      <div class="col-md-3"><div class="card p-3"><small class="text-muted">Local Agent</small><div class="fs-5 fw-bold">${escapeHtml(h.agent?.state || 'IDLE')}</div><small class="text-muted">Mode: ${escapeHtml(h.agent?.mode || 'isolated')}</small></div></div>
    `;
  }

  const tbody = document.getElementById('tblAuditLogsBody');
  if (tbody) {
    tbody.innerHTML = appState.auditLogs.length
      ? appState.auditLogs
          .map(
            (l) => `<tr>
              <td class="small text-muted">${new Date(l.created_at).toLocaleString('vi-VN')}</td>
              <td><span class="badge bg-light text-dark border">${escapeHtml(l.actor_username)}</span></td>
              <td><code>${escapeHtml(l.action)}</code></td>
              <td class="small">${escapeHtml(l.resource_type)} ${escapeHtml(l.resource_id || '')}</td>
              <td class="small text-muted">${escapeHtml(JSON.stringify(l.details || {}))}</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="text-center text-muted py-3">Chưa có nhật ký kiểm toán.</td></tr>';
  }
}

export async function loadBackups() {
  const res = await apiFetch('/api/v2/backups');
  appState.backups = res.backups || [];
  const tbody = document.getElementById('tblBackupsBody');
  if (tbody) {
    tbody.innerHTML = appState.backups.length
      ? appState.backups
          .map(
            (b) => `<tr>
              <td class="small fw-semibold">${escapeHtml(b.filename)}</td>
              <td><span class="badge bg-light text-dark border">${escapeHtml(b.kind)}</span></td>
              <td class="small">${Math.round((b.size_bytes || 0) / 1024)} KB</td>
              <td class="small text-muted">${new Date(b.created_at).toLocaleString('vi-VN')}</td>
              <td class="small">${b.verified_at ? '✅ Đã kiểm tra' : 'Chưa verify'}</td>
              <td class="text-end">
                <button class="btn btn-outline-primary btn-sm py-0 px-2" data-verify-backup="${b.id}">Kiểm tra</button>
                <button class="btn btn-outline-warning btn-sm py-0 px-2" data-restore-backup="${b.id}">Phục hồi</button>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="text-center text-muted py-3">Chưa có bản sao lưu nào.</td></tr>';
  }
}

export async function loadUsersIfAdmin() {
  const wrap = document.getElementById('adminUsersCard');
  if (!wrap) return;
  if (appState.user?.role !== 'admin') {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const res = await apiFetch('/api/v2/auth/users');
  const tbody = document.getElementById('tblUsersBody');
  if (tbody) {
    tbody.innerHTML = (res.users || [])
      .map(
        (u) => `<tr>
          <td class="fw-semibold">${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.displayName)}</td>
          <td><span class="badge bg-primary-subtle text-primary">${escapeHtml(u.role)}</span></td>
          <td>${u.mfaEnabled ? '🔐 Bật' : 'Tắt'}</td>
          <td>${u.isActive ? '🟢 Hoạt động' : '🔴 Khóa'}</td>
        </tr>`
      )
      .join('');
  }
}

export function bindOpsEvents(refreshOverviewFn) {
  document.getElementById('btnPairDevice')?.addEventListener('click', async () => {
    const res = await apiFetch('/api/v2/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'SYNC_CLIENT', ttlSec: 300 })
    });
    const out = document.getElementById('pairingCodeResult');
    if (out) {
      out.classList.remove('hidden');
      out.innerHTML = `Mã ghép thiết bị dùng 1 lần: <code class="fs-5 fw-bold">${escapeHtml(res.code)}</code> (Hết hạn lúc ${new Date(res.expiresAt).toLocaleTimeString('vi-VN')})`;
    }
  });

  document.getElementById('btnRunDeltaSync')?.addEventListener('click', async () => {
    const res = await apiFetch('/api/v2/sync/delta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sinceCursor: 0, mutations: [] })
    });
    showToast({ title: 'Đồng bộ Delta hoàn tất', message: `Cursor hiện tại: ${res.serverCursor}` });
    await loadDevicesAndSync();
  });

  document.getElementById('tblDevicesBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-revoke-dev]');
    if (!btn) return;
    if (!confirm('Xác nhận thu hồi quyền truy cập của thiết bị này?')) return;
    await apiFetch(`/api/v2/devices/${btn.dataset.revokeDev}/revoke`, { method: 'POST' });
    showToast({ title: 'Đã thu hồi thiết bị' });
    await loadDevicesAndSync();
  });

  document.getElementById('tblConflictsBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-resolve-conflict]');
    if (!btn) return;
    await apiFetch(`/api/v2/sync/conflicts/${btn.dataset.resolveConflict}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: btn.dataset.decision })
    });
    showToast({ title: 'Đã xử lý xung đột đồng bộ' });
    await loadDevicesAndSync();
  });

  document.getElementById('btnCreateBackupNow')?.addEventListener('click', async () => {
    const res = await apiFetch('/api/v2/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'manual' })
    });
    showToast({ title: 'Đã tạo bản sao lưu mã hóa', message: res.backup.filename });
    await loadBackups();
  });

  document.getElementById('tblBackupsBody')?.addEventListener('click', async (e) => {
    const verifyBtn = e.target.closest('[data-verify-backup]');
    if (verifyBtn) {
      const r = await apiFetch(`/api/v2/backups/${verifyBtn.dataset.verifyBackup}/verify`, { method: 'POST' });
      showToast({ title: 'Checksum & SQLite hợp lệ', message: `${r.counts?.contacts || 0} liên hệ` });
      await loadBackups();
      return;
    }
    const restoreBtn = e.target.closest('[data-restore-backup]');
    if (restoreBtn) {
      if (!confirm('Xác nhận phục hồi dữ liệu từ bản sao lưu này? Thao tác sẽ thay thế DB hiện tại!')) return;
      const r = await apiFetch(`/api/v2/backups/${restoreBtn.dataset.restoreBackup}/restore`, { method: 'POST' });
      showToast({ title: 'Phục hồi thành công', message: `${r.verifiedContactsCount} liên hệ đã khôi phục` });
      await refreshOverviewFn();
      await loadBackups();
    }
  });

  document.getElementById('btnCreateUser')?.addEventListener('click', async () => {
    const username = document.getElementById('txtNewUsername')?.value.trim();
    const password = document.getElementById('txtNewUserPassword')?.value;
    const role = document.getElementById('selNewUserRole')?.value || 'operator';
    if (!username || !password) return alert('Nhập đủ username và mật khẩu >= 6 ký tự.');
    await apiFetch('/api/v2/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    document.getElementById('txtNewUsername').value = '';
    document.getElementById('txtNewUserPassword').value = '';
    showToast({ title: 'Đã tạo tài khoản', message: `${username} (${role})` });
    await loadUsersIfAdmin();
  });

  document.getElementById('btnSetupMfa')?.addEventListener('click', async () => {
    const res = await apiFetch('/api/v2/auth/mfa/setup', { method: 'POST' });
    const box = document.getElementById('mfaSetupBox');
    if (box) {
      box.classList.remove('hidden');
      document.getElementById('lblMfaSecret').textContent = res.secret;
    }
  });

  document.getElementById('btnVerifyMfa')?.addEventListener('click', async () => {
    const code = document.getElementById('txtMfaConfirmCode')?.value.trim();
    await apiFetch('/api/v2/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    showToast({ title: 'Đã kích hoạt MFA TOTP' });
    document.getElementById('mfaSetupBox')?.classList.add('hidden');
  });
}
