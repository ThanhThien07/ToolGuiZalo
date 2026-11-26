import { apiFetch, escapeHtml, showToast } from './api.js';
import { appState } from './state.js';
import { connectRealtime, disconnectRealtime } from './realtime.js';
import {
  loadDevicesAndSync,
  loadMonitorAndAudit,
  loadBackups,
  loadUsersIfAdmin,
  bindOpsEvents
} from './panels_ops.js';

let searchDebounceTimer = null;
let screenshotTimer = null;
let pieChart = null;
let previewFileBuffer = null;

function applyTheme(theme) {
  appState.theme = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('tgz_v2_theme', appState.theme);
  document.body.setAttribute('data-theme', appState.theme);
  const btn = document.getElementById('btnToggleTheme');
  if (btn) btn.textContent = appState.theme === 'dark' ? '☀️ Sáng' : '🌙 Tối';
}

function showAuthOverlay(mode = 'login') {
  const overlay = document.getElementById('authOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  const title = document.getElementById('authModalTitle');
  const mfaWrap = document.getElementById('authMfaWrap');
  const btnSubmit = document.getElementById('btnAuthSubmit');
  overlay.dataset.mode = mode;
  if (mode === 'setup') {
    title.textContent = '🔐 Thiết lập Quản trị viên V2 lần đầu';
    btnSubmit.textContent = 'Tạo tài khoản Admin & Bắt đầu';
    mfaWrap?.classList.add('hidden');
  } else {
    title.textContent = '🔐 Đăng nhập ToolGuiZalo Pro V2';
    btnSubmit.textContent = 'Đăng nhập';
  }
}

function hideAuthOverlay() {
  document.getElementById('authOverlay')?.classList.add('hidden');
}

window.__onUnauthorized = () => {
  disconnectRealtime();
  showAuthOverlay('login');
};

async function initAuthAndBoot() {
  applyTheme(appState.theme);
  const boot = await apiFetch('/api/v2/auth/bootstrap-status');
  if (boot.needsInitialSetup) {
    showAuthOverlay('setup');
    return;
  }
  try {
    const me = await apiFetch('/api/v2/auth/me');
    appState.user = me.user;
    await bootWorkspace();
  } catch {
    showAuthOverlay('login');
  }
}

async function bootWorkspace() {
  hideAuthOverlay();
  const uLabel = document.getElementById('topbarUserLabel');
  if (uLabel && appState.user) {
    uLabel.textContent = `${appState.user.username} (${appState.user.role})`;
  }
  await refreshAllCore();
  switchPanel(appState.currentPanel);

  connectRealtime({
    'contact.updated': () => {
      refreshAnalyticsOnly();
      if (appState.currentPanel === 'contacts') loadContactsPage();
    },
    'task.updated': () => {
      if (appState.currentPanel === 'tasks') loadTasksPage();
      if (appState.currentPanel === 'campaigns') loadCampaigns();
    },
    'conversation.updated': (evt) => {
      const cust = evt?.data?.conversation?.customerName || 'Khách hàng';
      const acc = evt?.data?.accountName || 'Zalo';
      showToast({
        key: `conv_${evt?.entityId || cust}`,
        title: `🔔 ${cust} vừa phản hồi`,
        message: `Tại ${acc}`,
        durationMs: 2500,
        onClick: () => switchPanel('inbox')
      });
      if (appState.currentPanel === 'inbox') loadConversations();
    },
    'system.health': () => refreshAnalyticsOnly(),
    'sync.completed': () => {
      if (appState.currentPanel === 'devices') loadDevicesAndSync();
    }
  });
}

async function refreshAnalyticsOnly() {
  try {
    const res = await apiFetch('/api/v2/reports/analytics');
    appState.stats = res.contactStats || {};
    appState.consentStats = res.consentStats || {};
    appState.campaigns = res.recentCampaigns || [];
    renderOverview();
  } catch {}
}

async function refreshAllCore() {
  const [analytics, accRes, setRes] = await Promise.all([
    apiFetch('/api/v2/reports/analytics'),
    apiFetch('/api/v2/accounts'),
    apiFetch('/api/v2/settings')
  ]);
  appState.stats = analytics.contactStats || {};
  appState.consentStats = analytics.consentStats || {};
  appState.campaigns = analytics.recentCampaigns || [];
  appState.accounts = accRes.accounts || [];
  appState.settings = setRes.settings || {};
  appState.attachments = appState.settings.attachedImages || [];
  renderOverview();
  renderAccounts();
  applySettingsToForm();
}

export async function switchPanel(panelId) {
  appState.currentPanel = panelId || 'overview';
  localStorage.setItem('tgz_v2_panel', appState.currentPanel);

  document.querySelectorAll('.panel-card').forEach((p) => {
    p.classList.toggle('active-panel', p.dataset.panel === appState.currentPanel);
  });
  document.querySelectorAll('.sidebar-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === appState.currentPanel);
  });

  if (appState.currentPanel === 'overview') await refreshAnalyticsOnly();
  else if (appState.currentPanel === 'accounts') await refreshAllCore();
  else if (appState.currentPanel === 'contacts') await loadContactsPage();
  else if (appState.currentPanel === 'consents') await loadConsentsPage();
  else if (appState.currentPanel === 'templates') await loadTemplatesAndAttachments();
  else if (appState.currentPanel === 'campaigns') await loadCampaigns();
  else if (appState.currentPanel === 'tasks') await loadTasksPage();
  else if (appState.currentPanel === 'inbox') await loadConversations();
  else if (appState.currentPanel === 'devices') await loadDevicesAndSync();
  else if (appState.currentPanel === 'monitor') await loadMonitorAndAudit();
  else if (appState.currentPanel === 'backups') await loadBackups();
  else if (appState.currentPanel === 'settings') await loadUsersIfAdmin();
}
window.switchPanel = switchPanel;

function renderOverview() {
  const s = appState.stats || {};
  const cs = appState.consentStats || {};
  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setText('statTotal', s.total ?? 0);
  setText('statSuccess', s.success ?? 0);
  setText('statBlocked', s.blockedStranger ?? 0);
  setText('statNotRegistered', s.notRegistered ?? 0);
  setText('statPending', (s.pending ?? 0) + (s.processing ?? 0));
  setText('statReview', s.review ?? 0);
  setText('lblOptedInCount', cs.OPTED_IN ?? 0);
  setText('lblOptedOutCount', cs.OPTED_OUT ?? 0);
  setText('badgeContactsTotal', `${s.total ?? 0}`);
  setText('badgeAccountsCount', `${appState.accounts.length} nick`);
  setText('badgeReviewTasks', `${s.review ?? 0} review`);

  const canvas = document.getElementById('chartStatusPie');
  if (canvas && typeof Chart !== 'undefined') {
    const dataArr = [
      s.success ?? 0,
      s.blockedStranger ?? 0,
      s.notRegistered ?? 0,
      s.pending ?? 0,
      s.review ?? 0,
      (s.invalidPhone ?? 0) + (s.error ?? 0) + (s.optedOut ?? 0)
    ];
    if (pieChart) {
      pieChart.data.datasets[0].data = dataArr;
      pieChart.update();
    } else {
      pieChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: ['Thành công', 'Chặn người lạ', 'Chưa ĐK', 'Chờ xử lý', 'REVIEW', 'Lỗi / Sai / Opt-out'],
          datasets: [{ data: dataArr, backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899'], borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '65%' }
      });
    }
  }
}

function renderAccounts() {
  const wrap = document.getElementById('accountsListContainer');
  if (!wrap) return;
  wrap.innerHTML = appState.accounts
    .map(
      (a) => `<div class="card p-3 mb-2 d-flex flex-row align-items-center justify-content-between">
        <div>
          <div class="d-flex align-items-center gap-2">
            <span class="dot ${a.status === 'READY' ? 'dot-green' : 'dot-gray'}"></span>
            <strong>${escapeHtml(a.name)}</strong>
            <span class="badge bg-light text-dark border">${escapeHtml(a.channel)}</span>
            <span class="badge badge-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span>
            ${a.isActivePrimary ? '<span class="badge bg-primary">Nick chính</span>' : ''}
          </div>
          <small class="text-muted">Đã gửi: ${a.sentCount || 0} • Hồ sơ: ${escapeHtml(a.zaloProfileName || 'Chưa nhận diện')}</small>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-primary btn-sm" data-switch-acc="${a.id}">Chọn</button>
          <button class="btn btn-primary btn-sm" data-open-qr="${a.id}">📱 Quét QR / Xem ngầm</button>
          <button class="btn btn-outline-danger btn-sm" data-revoke-acc="${a.id}">Thu hồi</button>
        </div>
      </div>`
    )
    .join('');
}

async function loadContactsPage() {
  const p = appState.contactsPage;
  const qs = new URLSearchParams({
    status: p.status,
    consent: p.consent,
    search: p.search,
    limit: String(p.limit),
    offset: String(p.offset)
  });
  const res = await apiFetch(`/api/v2/contacts?${qs.toString()}`);
  p.items = res.items || [];
  p.total = res.total || 0;
  appState.stats = res.stats || appState.stats;
  renderContactsTable();
  renderOverview();
}

function renderContactsTable() {
  const p = appState.contactsPage;
  const tbody = document.getElementById('contactsTableBody');
  const pageInfo = document.getElementById('pageInfo');
  const pageNum = Math.floor(p.offset / p.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(p.total / p.limit));
  if (pageInfo) pageInfo.textContent = `Trang ${pageNum}/${totalPages} (${p.total} bản ghi)`;

  if (!tbody) return;
  tbody.innerHTML = p.items.length
    ? p.items
        .map(
          (c, i) => `<tr>
            <td class="small text-muted">${p.offset + i + 1}</td>
            <td class="font-monospace fw-semibold">${escapeHtml(c.phone)}</td>
            <td>${escapeHtml(c.name || '-')}</td>
            <td><span class="badge badge-${escapeHtml(c.consentStatus || 'UNKNOWN')}">${escapeHtml(c.consentStatus || 'UNKNOWN')}</span></td>
            <td><span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
            <td class="small text-muted">${escapeHtml((c.tags || []).join(', ') || '-')}</td>
            <td class="small text-muted text-truncate" style="max-width:220px;" title="${escapeHtml(c.reason || '')}">${escapeHtml(c.reason || '-')}</td>
            <td class="text-end">
              <button class="btn btn-outline-success btn-sm py-0 px-1" data-optin="${escapeHtml(c.phone)}" title="Xác nhận Opt-in">✓</button>
              <button class="btn btn-outline-warning btn-sm py-0 px-1" data-optout="${escapeHtml(c.phone)}" title="Đưa vào Opt-out">⊘</button>
              <button class="btn btn-outline-danger btn-sm py-0 px-1" data-del-contact="${c.id}" title="Xóa">✖</button>
            </td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="8" class="text-center text-muted py-4">Không có liên hệ nào phù hợp.</td></tr>';
}

async function loadConsentsPage() {
  const c = appState.consentsPage;
  const qs = new URLSearchParams({ status: c.status, search: c.search, limit: '50', offset: '0' });
  const res = await apiFetch(`/api/v2/consents?${qs.toString()}`);
  c.items = res.items || [];
  appState.consentStats = res.stats || {};
  const tbody = document.getElementById('tblConsentsBody');
  if (tbody) {
    tbody.innerHTML = c.items.length
      ? c.items
          .map(
            (r) => `<tr>
              <td class="font-monospace fw-semibold">${escapeHtml(r.phone)}</td>
              <td>${escapeHtml(r.contactName || '-')}</td>
              <td><span class="badge badge-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
              <td class="small">${escapeHtml(r.source || '-')}</td>
              <td class="small text-muted">${new Date(r.updatedAt).toLocaleString('vi-VN')}</td>
              <td class="text-end">
                <button class="btn btn-outline-success btn-sm py-0 px-2" data-cns-set="OPTED_IN" data-phone="${escapeHtml(r.phone)}">Opt-in</button>
                <button class="btn btn-outline-danger btn-sm py-0 px-2" data-cns-set="OPTED_OUT" data-phone="${escapeHtml(r.phone)}">Opt-out</button>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="text-center text-muted py-3">Chưa có dữ liệu consent.</td></tr>';
  }
}

async function loadTemplatesAndAttachments() {
  const [tplRes, attRes] = await Promise.all([apiFetch('/api/v2/templates'), apiFetch('/api/v2/attachments')]);
  appState.templates = tplRes.templates || [];
  appState.attachments = attRes.attachedImages || [];
  const tbody = document.getElementById('tblTemplatesBody');
  if (tbody) {
    tbody.innerHTML = appState.templates.length
      ? appState.templates
          .map(
            (t) => `<tr>
              <td class="fw-semibold">${escapeHtml(t.name)} <small class="text-muted">v${t.templateVersion}</small></td>
              <td><span class="badge bg-light text-dark border">${escapeHtml(t.channel)}</span></td>
              <td><span class="badge badge-${escapeHtml(t.approvalStatus)}">${escapeHtml(t.approvalStatus)}</span></td>
              <td class="small text-muted text-truncate" style="max-width:260px;">${escapeHtml(t.body)}</td>
              <td class="text-end">
                <button class="btn btn-outline-success btn-sm py-0 px-2" data-approve-tpl="${t.id}">Phê duyệt</button>
                <button class="btn btn-outline-danger btn-sm py-0 px-2" data-del-tpl="${t.id}">Xóa</button>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="text-center text-muted py-3">Chưa có mẫu nào.</td></tr>';
  }
  const attWrap = document.getElementById('attachedImagesContainer');
  if (attWrap) {
    attWrap.innerHTML = appState.attachments
      .map(
        (img) => `<div class="img-thumb-item"><img src="${escapeHtml(img.url)}" alt="" /><button class="btn-remove-thumb" data-del-img="${img.id}">×</button></div>`
      )
      .join('');
  }
}

async function loadCampaigns() {
  const res = await apiFetch('/api/v2/campaigns');
  appState.campaigns = res.campaigns || [];
  const tbody = document.getElementById('tblCampaignsBody');
  if (tbody) {
    tbody.innerHTML = appState.campaigns.length
      ? appState.campaigns
          .map(
            (c) => `<tr>
              <td class="fw-semibold">${escapeHtml(c.name)}<div class="small text-muted">${escapeHtml(c.channel)}</div></td>
              <td><span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
              <td class="small">${c.counts?.completed || 0}/${c.counts?.total || 0} (Review: ${c.counts?.review || 0})</td>
              <td class="small text-muted">${escapeHtml(c.stopReason || '-')}</td>
              <td class="text-end">
                ${c.status === 'DRAFT' ? `<button class="btn btn-outline-primary btn-sm py-0 px-2" data-cmp-approve="${c.id}">Duyệt</button>` : ''}
                ${['APPROVED', 'PAUSED', 'SCHEDULED', 'DRAFT'].includes(c.status) ? `<button class="btn btn-success btn-sm py-0 px-2" data-cmp-start="${c.id}">Chạy</button>` : ''}
                ${c.status === 'RUNNING' ? `<button class="btn btn-warning btn-sm py-0 px-2" data-cmp-pause="${c.id}">Tạm dừng</button>` : ''}
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="text-center text-muted py-3">Chưa có chiến dịch nào.</td></tr>';
  }
}

async function loadTasksPage() {
  const t = appState.tasksPage;
  const res = await apiFetch(`/api/v2/tasks?status=${encodeURIComponent(t.status)}&limit=50`);
  t.items = res.items || [];
  const tbody = document.getElementById('tblTasksBody');
  if (tbody) {
    tbody.innerHTML = t.items.length
      ? t.items
          .map(
            (r) => `<tr>
              <td class="font-monospace small">${escapeHtml(r.phone)}</td>
              <td>${escapeHtml(r.contactName || '-')}</td>
              <td><span class="badge badge-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
              <td class="small text-muted">${escapeHtml(r.resultReason || '-')}</td>
              <td class="text-end">${
                r.status === 'REVIEW'
                  ? `<button class="btn btn-success btn-sm py-0 px-2" data-review-task="${r.id}" data-res="COMPLETED">Đã gửi</button>
                     <button class="btn btn-danger btn-sm py-0 px-2" data-review-task="${r.id}" data-res="FAILED">Đánh dấu lỗi</button>
                     <button class="btn btn-outline-secondary btn-sm py-0 px-2" data-review-task="${r.id}" data-res="PENDING">Gửi lại</button>`
                  : `<small class="text-muted">${escapeHtml(r.resultCode || '-')}</small>`
              }</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="text-center text-muted py-3">Chưa có tác vụ nào.</td></tr>';
  }
}

async function loadConversations() {
  const res = await apiFetch('/api/v2/conversations?limit=50');
  appState.conversations.items = res.items || [];
  const tbody = document.getElementById('repliesTableBody');
  if (tbody) {
    tbody.innerHTML = appState.conversations.items.length
      ? appState.conversations.items
          .map(
            (c) => `<tr>
              <td class="fw-semibold">${escapeHtml(c.customerName)} ${
              c.matchStatus === 'NEEDS_VERIFICATION' ? '<span class="badge bg-warning text-dark">Cần xác minh SĐT</span>' : ''
            }</td>
              <td class="font-monospace small">${escapeHtml(c.phone || 'Chưa liên kết')}</td>
              <td><span class="badge bg-info-subtle text-dark">${escapeHtml(c.accountName || c.accountId || '-')}</span></td>
              <td class="small">${escapeHtml(c.lastMessageText)}<div class="text-muted" style="font-size:11px;">${new Date(c.lastMessageAt).toLocaleString('vi-VN')}</div></td>
              <td class="text-end">
                ${c.matchStatus !== 'VERIFIED' ? `<button class="btn btn-outline-warning btn-sm py-0 px-2" data-verify-conv="${c.id}">Gắn SĐT</button>` : ''}
                <button class="btn btn-outline-primary btn-sm py-0 px-2" data-open-chat="${c.id}" data-acc="${escapeHtml(c.accountId || '')}" data-phone="${escapeHtml(c.phone || '')}" data-name="${escapeHtml(c.customerName)}">Mở chat</button>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="5" class="text-center text-muted py-3">Chưa có hội thoại phản hồi nào.</td></tr>';
  }
}

function applySettingsToForm() {
  const s = appState.settings || {};
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  const setChk = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(v);
  };
  setVal('txtTemplate', s.template || '');
  setVal('numMinDelay', s.minDelaySec ?? 12);
  setVal('numMaxDelay', s.maxDelaySec ?? 25);
  setVal('numBatchSize', s.batchSize ?? 15);
  setVal('numBatchPause', s.batchPauseSec ?? 120);
  setChk('chkRequireOptIn', s.requireOptInConsent !== false);
  setChk('chkUsePhoneCache', s.usePhoneCache !== false);
  setChk('chkActiveHoursEnabled', s.activeHoursEnabled);
  setVal('tmActiveStart', s.activeHourStart || '08:00');
  setVal('tmActiveEnd', s.activeHourEnd || '21:30');
}

// ==================== QR MODAL (STRICT ON-DEMAND SCREENSHOT) ====================

async function pollScreenshotOnce() {
  const overlay = document.getElementById('qrModalOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  try {
    const data = await apiFetch(`/api/v2/browser/screenshot?t=${Date.now()}`);
    if (data.active && data.imageBase64) {
      const img = document.getElementById('liveZaloImage');
      if (img) {
        img.src = data.imageBase64;
        img.style.display = 'inline-block';
      }
      document.getElementById('liveZaloImageSpinner')?.classList.add('hidden');
      const st = document.getElementById('qrModalStatusText');
      if (st) st.textContent = data.isLoggedIn ? '🟢 Đã đăng nhập Zalo thành công!' : '🟡 Quét mã QR trên màn hình bên dưới...';
    }
  } catch {}
}

function openQrModal() {
  const overlay = document.getElementById('qrModalOverlay');
  overlay?.classList.remove('hidden');
  apiFetch('/api/v2/browser/viewer-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true })
  }).catch(() => {});
  pollScreenshotOnce();
  if (!screenshotTimer) {
    screenshotTimer = setInterval(pollScreenshotOnce, 500);
  }
}

function closeQrModal() {
  document.getElementById('qrModalOverlay')?.classList.add('hidden');
  if (screenshotTimer) {
    clearInterval(screenshotTimer);
    screenshotTimer = null;
  }
  apiFetch('/api/v2/browser/viewer-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: false })
  }).catch(() => {});
}

function bindEvents() {
  // Auth form
  document.getElementById('authForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.getElementById('authOverlay').dataset.mode || 'login';
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const totpCode = document.getElementById('authTotpCode')?.value.trim() || '';
    const errEl = document.getElementById('authErrorBox');
    errEl.classList.add('hidden');
    try {
      const endpoint = mode === 'setup' ? '/api/v2/auth/setup' : '/api/v2/auth/login';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, totpCode })
      });
      if (res.mfaRequired) {
        document.getElementById('authMfaWrap')?.classList.remove('hidden');
        errEl.textContent = 'Tài khoản này bật MFA. Vui lòng nhập mã TOTP 6 chữ số.';
        errEl.classList.remove('hidden');
        return;
      }
      appState.user = res.user;
      await bootWorkspace();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await apiFetch('/api/v2/auth/logout', { method: 'POST' }).catch(() => {});
    disconnectRealtime();
    appState.user = null;
    showAuthOverlay('login');
  });

  document.getElementById('btnToggleTheme')?.addEventListener('click', () => {
    applyTheme(appState.theme === 'dark' ? 'light' : 'dark');
  });

  document.querySelectorAll('.sidebar-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  // Contacts search debounce
  document.getElementById('txtSearchTable')?.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      appState.contactsPage.search = e.target.value;
      appState.contactsPage.offset = 0;
      loadContactsPage();
    }, 300);
  });

  document.getElementById('selContactsStatusFilter')?.addEventListener('change', (e) => {
    appState.contactsPage.status = e.target.value;
    appState.contactsPage.offset = 0;
    loadContactsPage();
  });

  document.getElementById('btnPrevPage')?.addEventListener('click', () => {
    appState.contactsPage.offset = Math.max(0, appState.contactsPage.offset - appState.contactsPage.limit);
    loadContactsPage();
  });
  document.getElementById('btnNextPage')?.addEventListener('click', () => {
    if (appState.contactsPage.offset + appState.contactsPage.limit < appState.contactsPage.total) {
      appState.contactsPage.offset += appState.contactsPage.limit;
      loadContactsPage();
    }
  });

  // Quick Text Import
  document.getElementById('btnImportText')?.addEventListener('click', async () => {
    const text = document.getElementById('txtBulkContacts')?.value.trim();
    const consentStatus = document.getElementById('selImportConsent')?.value || 'UNKNOWN';
    if (!text) return alert('Vui lòng dán danh sách SĐT.');
    const res = await apiFetch('/api/v2/contacts/import-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, consentStatus })
    });
    document.getElementById('txtBulkContacts').value = '';
    showToast({ title: 'Nhập danh sách thành công', message: `+${res.addedCount} mới, ${res.updatedCount} cập nhật` });
    await loadContactsPage();
  });

  // Excel Preview & Mapped Import
  document.getElementById('fileExcelInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    previewFileBuffer = file;
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiFetch('/api/v2/contacts/import-preview', { method: 'POST', body: fd });
    const box = document.getElementById('excelPreviewMappingBox');
    if (box) {
      box.classList.remove('hidden');
      const opts = (selected) =>
        `<option value="">-- Không dùng --</option>` +
        (res.headers || []).map((h) => `<option value="${escapeHtml(h)}" ${h === selected ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('');
      document.getElementById('mapColPhone').innerHTML = opts(res.suggestedMapping?.phone);
      document.getElementById('mapColName').innerHTML = opts(res.suggestedMapping?.name);
      document.getElementById('mapColInfo').innerHTML = opts(res.suggestedMapping?.info);
      document.getElementById('lblExcelRowCount').textContent = `${res.totalRows} dòng tìm thấy trong "${res.activeSheet}"`;
    }
  });

  document.getElementById('btnUploadExcel')?.addEventListener('click', async () => {
    const file = previewFileBuffer || document.getElementById('fileExcelInput')?.files?.[0];
    if (!file) return alert('Vui lòng chọn file Excel/CSV.');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('consentStatus', document.getElementById('selExcelConsent')?.value || 'UNKNOWN');
    fd.append(
      'mapping',
      JSON.stringify({
        phone: document.getElementById('mapColPhone')?.value || '',
        name: document.getElementById('mapColName')?.value || '',
        info: document.getElementById('mapColInfo')?.value || ''
      })
    );
    const res = await apiFetch('/api/v2/contacts/import-file', { method: 'POST', body: fd });
    showToast({ title: 'Nhập Excel thành công', message: `+${res.addedCount} liên hệ mới` });
    document.getElementById('excelPreviewMappingBox')?.classList.add('hidden');
    await loadContactsPage();
  });

  // Contact actions (Opt-in / Opt-out / Delete)
  document.getElementById('contactsTableBody')?.addEventListener('click', async (e) => {
    const optin = e.target.closest('[data-optin]');
    if (optin) {
      await apiFetch('/api/v2/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: optin.dataset.optin, status: 'OPTED_IN', source: 'ui_verified' })
      });
      showToast({ title: 'Đã cấp Opt-in Consent', message: optin.dataset.optin });
      await loadContactsPage();
      return;
    }
    const optout = e.target.closest('[data-optout]');
    if (optout) {
      await apiFetch('/api/v2/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: optout.dataset.optout, status: 'OPTED_OUT', source: 'ui_optout' })
      });
      showToast({ title: 'Đã đưa vào danh sách Opt-out', level: 'warning' });
      await loadContactsPage();
      return;
    }
    const del = e.target.closest('[data-del-contact]');
    if (del) {
      if (!confirm('Xác nhận xóa liên hệ này?')) return;
      await apiFetch(`/api/v2/contacts/${del.dataset.delContact}`, { method: 'DELETE' });
      await loadContactsPage();
    }
  });

  // Consents Panel actions
  document.getElementById('tblConsentsBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cns-set]');
    if (!btn) return;
    await apiFetch('/api/v2/consents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: btn.dataset.phone, status: btn.dataset.cnsSet, source: 'consent_center' })
    });
    await loadConsentsPage();
  });

  // Templates & Attachments
  document.getElementById('btnPreviewTemplate')?.addEventListener('click', async () => {
    const template = document.getElementById('txtTemplate')?.value || '';
    const res = await apiFetch('/api/v2/templates/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template })
    });
    document.getElementById('previewBox').textContent = res.rendered || '(Trống)';
    const warnEl = document.getElementById('lblTemplateValidation');
    if (warnEl) {
      warnEl.textContent = res.inspection?.hasObfuscationSyntax
        ? '⚠️ Cú pháp Spintax {a|b} không còn dùng để né spam.'
        : res.inspection?.missingVariables?.length
        ? `⚠️ Thiếu giá trị biến: ${res.inspection.missingVariables.join(', ')}`
        : '✅ Mẫu hợp lệ';
    }
  });

  document.getElementById('btnCreateTemplate')?.addEventListener('click', async () => {
    const name = document.getElementById('txtTemplateName')?.value.trim() || 'Mẫu CSKH';
    const body = document.getElementById('txtTemplate')?.value || '';
    const channel = document.getElementById('selTemplateChannel')?.value || 'zalo_oa';
    await apiFetch('/api/v2/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, body, channel })
    });
    showToast({ title: 'Đã tạo mẫu tin nhắn' });
    await loadTemplatesAndAttachments();
  });

  document.getElementById('tblTemplatesBody')?.addEventListener('click', async (e) => {
    const app = e.target.closest('[data-approve-tpl]');
    if (app) {
      await apiFetch(`/api/v2/templates/${app.dataset.approveTpl}/approve`, { method: 'POST' });
      await loadTemplatesAndAttachments();
      return;
    }
    const del = e.target.closest('[data-del-tpl]');
    if (del) {
      await apiFetch(`/api/v2/templates/${del.dataset.delTpl}`, { method: 'DELETE' });
      await loadTemplatesAndAttachments();
    }
  });

  document.getElementById('fileImageInput')?.addEventListener('change', async (e) => {
    if (!e.target.files?.length) return;
    const fd = new FormData();
    for (const f of e.target.files) fd.append('images', f);
    await apiFetch('/api/v2/attachments/upload', { method: 'POST', body: fd });
    e.target.value = '';
    await loadTemplatesAndAttachments();
  });

  document.getElementById('attachedImagesContainer')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-img]');
    if (!btn) return;
    await apiFetch(`/api/v2/attachments/${btn.dataset.delImg}`, { method: 'DELETE' });
    await loadTemplatesAndAttachments();
  });

  // Accounts & QR Modal
  document.getElementById('btnAddAccount')?.addEventListener('click', async () => {
    const name = document.getElementById('txtNewAccountName')?.value.trim();
    if (!name) return;
    await apiFetch('/api/v2/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    document.getElementById('txtNewAccountName').value = '';
    await refreshAllCore();
  });

  document.getElementById('accountsListContainer')?.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-switch-acc]');
    if (sw) {
      await apiFetch('/api/v2/accounts/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: sw.dataset.switchAcc, launch: false })
      });
      await refreshAllCore();
      return;
    }
    const qr = e.target.closest('[data-open-qr]');
    if (qr) {
      openQrModal();
      await apiFetch('/api/v2/browser/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: qr.dataset.openQr })
      });
      return;
    }
    const rev = e.target.closest('[data-revoke-acc]');
    if (rev && confirm('Thu hồi & ngắt phiên tài khoản này?')) {
      await apiFetch(`/api/v2/accounts/${rev.dataset.revokeAcc}/revoke`, { method: 'POST' });
      await refreshAllCore();
    }
  });

  document.getElementById('btnCloseQrModal')?.addEventListener('click', closeQrModal);
  document.getElementById('btnReloadZaloQr')?.addEventListener('click', () => apiFetch('/api/v2/browser/reload', { method: 'POST' }));
  document.getElementById('liveZaloImage')?.addEventListener('click', async (e) => {
    const rect = e.target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    await apiFetch('/api/v2/browser/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        xRatio: (e.clientX - rect.left) / rect.width,
        yRatio: (e.clientY - rect.top) / rect.height
      })
    });
    setTimeout(pollScreenshotOnce, 120);
  });

  // Campaigns & Tasks
  document.getElementById('btnCreateCampaign')?.addEventListener('click', async () => {
    const name = document.getElementById('txtCampaignName')?.value.trim() || `Chiến dịch ${new Date().toLocaleTimeString('vi-VN')}`;
    const channel = document.getElementById('selCampaignChannel')?.value || 'web_assisted';
    const res = await apiFetch('/api/v2/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, channel })
    });
    showToast({ title: 'Đã tạo bản nháp chiến dịch', message: `${res.queuedTasks} tác vụ đủ consent, bỏ qua ${res.skippedByConsent}` });
    await loadCampaigns();
  });

  document.getElementById('tblCampaignsBody')?.addEventListener('click', async (e) => {
    const app = e.target.closest('[data-cmp-approve]');
    if (app) {
      await apiFetch(`/api/v2/campaigns/${app.dataset.cmpApprove}/approve`, { method: 'POST' });
      await loadCampaigns();
      return;
    }
    const st = e.target.closest('[data-cmp-start]');
    if (st) {
      await apiFetch(`/api/v2/campaigns/${st.dataset.cmpStart}/start`, { method: 'POST' });
      showToast({ title: 'Đã khởi chạy chiến dịch' });
      await loadCampaigns();
      return;
    }
    const pa = e.target.closest('[data-cmp-pause]');
    if (pa) {
      await apiFetch(`/api/v2/campaigns/${pa.dataset.cmpPause}/pause`, { method: 'POST' });
      await loadCampaigns();
    }
  });

  document.getElementById('selTaskStatusFilter')?.addEventListener('change', (e) => {
    appState.tasksPage.status = e.target.value;
    loadTasksPage();
  });

  document.getElementById('tblTasksBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-review-task]');
    if (!btn) return;
    await apiFetch(`/api/v2/tasks/${btn.dataset.reviewTask}/resolve-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: btn.dataset.res })
    });
    showToast({ title: 'Đã cập nhật trạng thái REVIEW' });
    await loadTasksPage();
  });

  // Inbox
  document.getElementById('btnCheckReplies')?.addEventListener('click', async () => {
    const r = await apiFetch('/api/v2/replies/check', { method: 'POST' });
    showToast({ title: 'Hoàn tất quét phản hồi', message: `Tìm thấy ${r.foundCount || 0} tin mới` });
    await loadConversations();
  });

  document.getElementById('repliesTableBody')?.addEventListener('click', async (e) => {
    const vBtn = e.target.closest('[data-verify-conv]');
    if (vBtn) {
      const phone = prompt('Nhập đúng số điện thoại khách hàng để liên kết (chính xác 10 số):');
      if (!phone) return;
      const page = await apiFetch(`/api/v2/contacts?search=${encodeURIComponent(phone.trim())}&limit=5`);
      if (!page.items?.length) return alert('Không tìm thấy liên hệ có SĐT này.');
      await apiFetch(`/api/v2/conversations/${vBtn.dataset.verifyConv}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: page.items[0].id })
      });
      showToast({ title: 'Đã xác minh SĐT cho hội thoại' });
      await loadConversations();
      return;
    }
    const openBtn = e.target.closest('[data-open-chat]');
    if (openBtn) {
      openQrModal();
      await apiFetch('/api/v2/browser/open-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: openBtn.dataset.acc,
          phone: openBtn.dataset.phone,
          contactName: openBtn.dataset.name
        })
      });
    }
  });

  // Settings + Safe Presets (KHÔNG còn TURBO)
  document.querySelectorAll('[data-safe-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-safe-preset]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.safePreset;
      if (mode === 'STANDARD') {
        document.getElementById('numMinDelay').value = 8;
        document.getElementById('numMaxDelay').value = 15;
        document.getElementById('numBatchSize').value = 20;
        document.getElementById('numBatchPause').value = 60;
      } else if (mode === 'SAFE') {
        document.getElementById('numMinDelay').value = 12;
        document.getElementById('numMaxDelay').value = 25;
        document.getElementById('numBatchSize').value = 15;
        document.getElementById('numBatchPause').value = 120;
      } else {
        document.getElementById('numMinDelay').value = 20;
        document.getElementById('numMaxDelay').value = 40;
        document.getElementById('numBatchSize').value = 10;
        document.getElementById('numBatchPause').value = 180;
      }
    });
  });

  document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
    const payload = {
      template: document.getElementById('txtTemplate')?.value || '',
      minDelaySec: Math.max(5, Number(document.getElementById('numMinDelay')?.value || 12)),
      maxDelaySec: Math.max(5, Number(document.getElementById('numMaxDelay')?.value || 25)),
      batchSize: Math.max(1, Number(document.getElementById('numBatchSize')?.value || 15)),
      batchPauseSec: Math.max(30, Number(document.getElementById('numBatchPause')?.value || 120)),
      requireOptInConsent: document.getElementById('chkRequireOptIn')?.checked !== false,
      usePhoneCache: document.getElementById('chkUsePhoneCache')?.checked !== false,
      activeHoursEnabled: Boolean(document.getElementById('chkActiveHoursEnabled')?.checked),
      activeHourStart: document.getElementById('tmActiveStart')?.value || '08:00',
      activeHourEnd: document.getElementById('tmActiveEnd')?.value || '21:30'
    };
    const res = await apiFetch('/api/v2/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    appState.settings = res.settings;
    showToast({ title: 'Đã lưu cấu hình an toàn' });
  });

  bindOpsEvents(refreshAllCore);
}

bindEvents();
initAuthAndBoot();
