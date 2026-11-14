const state = {
  contacts: [],
  settings: {},
  accounts: [],
  activeAccountId: 'acc_default',
  status: {},
  filterStatus: 'ALL',
  searchQuery: '',
  currentPanel: localStorage.getItem('tool_current_panel') || 'overview',
  pagination: {
    currentPage: 1,
    pageSize: 25,
    totalPages: 1
  },
  replies: [],
  repliesSearchQuery: '',
  repliesFilterAccount: 'ALL',
  chartInstance: null,
  logs: []
};

// ==================== DOM ELEMENTS ====================
const mainContainer = document.getElementById('mainContainer');
const sidebarMenu = document.getElementById('sidebarMenu');
const sidebarActiveAccName = document.getElementById('sidebarActiveAccName');
const sidebarDot = document.getElementById('sidebarDot');
const badgeAccountsCount = document.getElementById('badgeAccountsCount');
const badgeScheduleState = document.getElementById('badgeScheduleState');
const badgeContactsTotal = document.getElementById('badgeContactsTotal');
const badgeImagesTotal = document.getElementById('badgeImagesTotal');
const badgeTablePending = document.getElementById('badgeTablePending');
const badgeRepliesCount = document.getElementById('badgeRepliesCount');

// Topbar Elements
const browserDot = document.getElementById('browserDot');
const browserStatusText = document.getElementById('browserStatusText');
const btnOpenBrowser = document.getElementById('btnOpenBrowser');
const btnCloseBrowser = document.getElementById('btnCloseBrowser');
const btnStartCampaign = document.getElementById('btnStartCampaign');
const btnPauseCampaign = document.getElementById('btnPauseCampaign');

const campaignStateBadge = document.getElementById('campaignStateBadge');
const countdownBox = document.getElementById('countdownBox');
const countdownValue = document.getElementById('countdownValue');
const scheduleCountdownBox = document.getElementById('scheduleCountdownBox');
const scheduleCountdownValue = document.getElementById('scheduleCountdownValue');

// Modal Elements
const qrModalOverlay = document.getElementById('qrModalOverlay');
const qrModalTitle = document.getElementById('qrModalTitle');
const qrModalStatusBar = document.getElementById('qrModalStatusBar');
const qrModalStatusText = document.getElementById('qrModalStatusText');
const liveZaloImage = document.getElementById('liveZaloImage');
const btnReloadZaloQr = document.getElementById('btnReloadZaloQr');
const btnCloseQrModal = document.getElementById('btnCloseQrModal');

let liveScreenshotTimer = null;

// KPI Elements
const statTotal = document.getElementById('statTotal');
const statSuccess = document.getElementById('statSuccess');
const statBlocked = document.getElementById('statBlocked');
const statNotRegistered = document.getElementById('statNotRegistered');
const statPending = document.getElementById('statPending');

const tabCountAll = document.getElementById('tabCountAll');
const tabCountBlocked = document.getElementById('tabCountBlocked');
const tabCountUnreg = document.getElementById('tabCountUnreg');
const tabCountSuccess = document.getElementById('tabCountSuccess');
const tabCountPending = document.getElementById('tabCountPending');
const tabCountError = document.getElementById('tabCountError');

// Đa tài khoản Zalo & Lịch hẹn
const txtNewAccountName = document.getElementById('txtNewAccountName');
const btnAddAccount = document.getElementById('btnAddAccount');
const btnLaunchAllAccounts = document.getElementById('btnLaunchAllAccounts');
const accountsListContainer = document.getElementById('accountsListContainer');
const chkAutoRotateAccounts = document.getElementById('chkAutoRotateAccounts');

const chkScheduleEnabled = document.getElementById('chkScheduleEnabled');
const dtScheduleStartAt = document.getElementById('dtScheduleStartAt');
const chkActiveHoursEnabled = document.getElementById('chkActiveHoursEnabled');
const tmActiveStart = document.getElementById('tmActiveStart');
const tmActiveEnd = document.getElementById('tmActiveEnd');
const btnApplySchedule = document.getElementById('btnApplySchedule');
const scheduleStatePill = document.getElementById('scheduleStatePill');
const scheduleStartBlock = document.getElementById('scheduleStartBlock');
const activeHoursBlock = document.getElementById('activeHoursBlock');

// Nhập SĐT
const txtBulkContacts = document.getElementById('txtBulkContacts');
const chkDeduplicateText = document.getElementById('chkDeduplicateText');
const chkReplaceText = document.getElementById('chkReplaceText');
const btnImportText = document.getElementById('btnImportText');
const btnFillSampleText = document.getElementById('btnFillSampleText');

const fileExcelInput = document.getElementById('fileExcelInput');
const chkDeduplicateExcel = document.getElementById('chkDeduplicateExcel');
const chkReplaceExcel = document.getElementById('chkReplaceExcel');
const btnUploadExcel = document.getElementById('btnUploadExcel');

// Mẫu tin nhắn, Ảnh đính kèm & Cấu hình tốc độ
const txtTemplate = document.getElementById('txtTemplate');
const fileImageInput = document.getElementById('fileImageInput');
const attachedImagesContainer = document.getElementById('attachedImagesContainer');
const btnClearImages = document.getElementById('btnClearImages');

const previewBox = document.getElementById('previewBox');
const btnRegeneratePreview = document.getElementById('btnRegeneratePreview');
const numMinDelay = document.getElementById('numMinDelay');
const numMaxDelay = document.getElementById('numMaxDelay');
const numBatchSize = document.getElementById('numBatchSize');
const numBatchPause = document.getElementById('numBatchPause');
const chkFastPasteMode = document.getElementById('chkFastPasteMode');
const chkUseCustomFirst = document.getElementById('chkUseCustomFirst');
const chkUsePhoneCache = document.getElementById('chkUsePhoneCache');
const chkAutoAddFriend = document.getElementById('chkAutoAddFriend');
const btnSaveSettings = document.getElementById('btnSaveSettings');

// Bảng danh sách & Phân trang
const txtSearchTable = document.getElementById('txtSearchTable');
const selPageSize = document.getElementById('selPageSize');
const contactsTableBody = document.getElementById('contactsTableBody');
const chkSelectAll = document.getElementById('chkSelectAll');
const btnDeleteSelected = document.getElementById('btnDeleteSelected');
const btnResetSelectedStatus = document.getElementById('btnResetSelectedStatus');
const btnClearAll = document.getElementById('btnClearAll');
const pageInfo = document.getElementById('pageInfo');
const btnFirstPage = document.getElementById('btnFirstPage');
const btnPrevPage = document.getElementById('btnPrevPage');
const btnNextPage = document.getElementById('btnNextPage');
const btnLastPage = document.getElementById('btnLastPage');

// Panel Khách Đã Phản Hồi Elements
const btnCheckReplies = document.getElementById('btnCheckReplies');
const btnResetReplies = document.getElementById('btnResetReplies');
const txtSearchReplies = document.getElementById('txtSearchReplies');
const selRepliesFilterAccount = document.getElementById('selRepliesFilterAccount');
const repliesTableBody = document.getElementById('repliesTableBody');
const repliesCountHeaderBadge = document.getElementById('repliesCountHeaderBadge');

// ==================== KHỞI CHẠY ỨNG DỤNG ====================

async function initApp() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    state.contacts = data.contacts || [];
    state.settings = data.settings || {};
    state.accounts = data.accounts || [];
    state.activeAccountId = data.activeAccountId || 'acc_default';
    state.status = data.status || {};

    applySettingsToForm(state.settings);
    renderAttachedImages(state.settings.attachedImages || []);
    renderStatus(state.status);
    renderAccounts();
    renderTable();
    updatePreview();
    await loadReplies();
    loadSyncInfo();
    switchPanel(state.currentPanel);
    connectSSE();
  } catch (err) {
    console.error('Không thể kết nối máy chủ:', err);
  }
}

function connectSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.addEventListener('status', (e) => {
    const status = JSON.parse(e.data);
    state.status = status;
    if (status.accounts) state.accounts = status.accounts;
    if (status.activeAccountId) state.activeAccountId = status.activeAccountId;
    renderStatus(status);
    renderAccounts();
    updateOverviewChart(status.stats || {});
  });

  evtSource.addEventListener('contact_updated', (e) => {
    const updated = JSON.parse(e.data);
    upsertContactInState(updated);
    renderTable();
    renderReplies();
    updateOverviewChart(state.status?.stats || {});
    updatePanelBadges();
  });

  evtSource.addEventListener('contacts_replaced', (e) => {
    const contacts = JSON.parse(e.data);
    state.contacts = Array.isArray(contacts) ? contacts : [];
    renderTable();
    renderReplies();
    updateOverviewChart(state.status?.stats || {});
    updatePanelBadges();
  });

  evtSource.addEventListener('reply_received', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { contact, replyText, accountName } = data;
      if (contact) {
        upsertContactInState({ ...contact, hasReplied: true, replyText });
      }
      renderReplies();
      updatePanelBadges();
      playNotificationSound();
      showReplyToast(
        contact?.name || contact?.zaloName || contact?.phone || 'Khách hàng',
        replyText,
        accountName
      );
      // Nếu người dùng đang mở sẵn trang Khách Đã Phản Hồi thì đánh dấu đã xem luôn
      if (state.currentPanel === 'replies') {
        markRepliesSeenOnServer(contact?.id);
      }
    } catch (err) {
      console.error('Lỗi nhận SSE reply_received:', err);
    }
  });

  evtSource.addEventListener('replies_updated', (e) => {
    try {
      const replies = JSON.parse(e.data);
      if (Array.isArray(replies)) {
        replies.forEach((rep) => {
          upsertContactInState(rep);
        });
        renderReplies();
        updatePanelBadges();
      }
    } catch (err) {
      console.error(err);
    }
  });

  evtSource.addEventListener('sync_status', (e) => {
    try {
      const info = JSON.parse(e.data);
      state.syncInfo = info;
      renderSyncUI(info);
      updatePanelBadges();
    } catch (err) {}
  });

  evtSource.addEventListener('peer_connected', () => {
    loadSyncInfo();
  });

  evtSource.onopen = () => {
    loadReplies();
  };

  // Bổ sung vòng lặp đồng bộ realtime mỗi 2.5 giây cho danh sách phản hồi để đảm bảo 100% không bao giờ trễ nhịp
  if (!window._realtimeRepliesTimer) {
    window._realtimeRepliesTimer = setInterval(() => {
      loadReplies();
    }, 2500);
  }
}

function toLocalDatetimeInputValue(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function applySettingsToForm(s) {
  txtTemplate.value = s.template || '';
  numMinDelay.value = s.minDelaySec ?? 12;
  numMaxDelay.value = s.maxDelaySec ?? 25;
  numBatchSize.value = s.batchSize ?? 15;
  numBatchPause.value = s.batchPauseSec ?? 120;
  chkFastPasteMode.checked = s.fastPasteMode !== false;
  chkUseCustomFirst.checked = Boolean(s.useCustomMessageFirst);
  chkUsePhoneCache.checked = Boolean(s.usePhoneCache);
  chkAutoAddFriend.checked = Boolean(s.autoAddFriendWhenBlocked);

  // Cập nhật trạng thái hiển thị của nút Preset
  if (Number(s.minDelaySec) <= 1 && Number(s.batchPauseSec) === 0) {
    updateSpeedPresetUI('TURBO');
  } else if (Number(s.minDelaySec) <= 4 && Number(s.batchPauseSec) <= 20) {
    updateSpeedPresetUI('FAST');
  } else {
    updateSpeedPresetUI('SAFE');
  }

  if (chkAutoRotateAccounts) {
    chkAutoRotateAccounts.checked = s.autoRotateAccounts !== false;
  }

  const optModeRoundRobin = document.getElementById('optModeRoundRobin');
  const optModeParallel = document.getElementById('optModeParallel');
  const badgeCurrentSendMode = document.getElementById('badgeCurrentSendMode');
  const curMode = s.sendMode || (s.autoRotateAccounts !== false ? 'ROUND_ROBIN' : 'ROUND_ROBIN');
  if (optModeParallel && optModeRoundRobin) {
    if (curMode === 'PARALLEL') {
      optModeParallel.checked = true;
      if (badgeCurrentSendMode) {
        badgeCurrentSendMode.textContent = '⚡ Song song Đa luồng';
        badgeCurrentSendMode.className = 'badge bg-success px-2 py-1';
      }
    } else {
      optModeRoundRobin.checked = true;
      if (badgeCurrentSendMode) {
        badgeCurrentSendMode.textContent = '🔄 Luân phiên (An toàn)';
        badgeCurrentSendMode.className = 'badge bg-primary px-2 py-1';
      }
    }
  }

  chkScheduleEnabled.checked = Boolean(s.scheduleEnabled);
  dtScheduleStartAt.value = toLocalDatetimeInputValue(s.scheduleStartAt);
  chkActiveHoursEnabled.checked = Boolean(s.activeHoursEnabled);
  tmActiveStart.value = s.activeHourStart || '08:00';
  tmActiveEnd.value = s.activeHourEnd || '21:30';
  updateScheduleVisualState();
}

function updateScheduleVisualState() {
  const isSchedOn = chkScheduleEnabled.checked;
  const isHoursOn = chkActiveHoursEnabled.checked;
  const anyOn = isSchedOn || isHoursOn;

  scheduleStartBlock.classList.toggle('active', isSchedOn);
  activeHoursBlock.classList.toggle('active', isHoursOn);
  if (!isSchedOn) {
    scheduleCountdownBox.classList.add('hidden');
  }

  if (anyOn) {
    scheduleStatePill.className = 'badge bg-warning text-dark';
    scheduleStatePill.textContent = isSchedOn ? '🟢 ĐANG BẬT HẸN GIỜ' : '🟢 ĐANG BẬT KHUNG GIỜ';
  } else {
    scheduleStatePill.className = 'badge bg-secondary';
    scheduleStatePill.textContent = '⚪ ĐANG TẮT LỊCH';
  }
}

function collectSettingsFromForm() {
  const optModeParallel = document.getElementById('optModeParallel');
  const isParallel = optModeParallel ? optModeParallel.checked : false;
  const sendMode = isParallel ? 'PARALLEL' : 'ROUND_ROBIN';

  const minVal = numMinDelay.value !== '' ? Math.max(0, Number(numMinDelay.value)) : 12;
  const maxVal = numMaxDelay.value !== '' ? Math.max(minVal, Number(numMaxDelay.value)) : Math.max(minVal, 25);
  const pauseVal = numBatchPause.value !== '' ? Math.max(0, Number(numBatchPause.value)) : 120;

  return {
    template: txtTemplate.value,
    autoRotateAccounts: true,
    sendMode,
    minDelaySec: minVal,
    maxDelaySec: maxVal,
    batchSize: Math.max(1, Number(numBatchSize.value) || 15),
    batchPauseSec: pauseVal,
    fastPasteMode: chkFastPasteMode.checked,
    useCustomMessageFirst: chkUseCustomFirst.checked,
    usePhoneCache: chkUsePhoneCache.checked,
    autoAddFriendWhenBlocked: chkAutoAddFriend.checked,
    scheduleEnabled: chkScheduleEnabled.checked,
    scheduleStartAt: dtScheduleStartAt.value ? new Date(dtScheduleStartAt.value).toISOString() : '',
    activeHoursEnabled: chkActiveHoursEnabled.checked,
    activeHourStart: tmActiveStart.value || '08:00',
    activeHourEnd: tmActiveEnd.value || '21:30'
  };
}

async function saveSettings(silent = false) {
  const payload = collectSettingsFromForm();
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    state.settings = data.settings;
    if (!silent) {
      alert('Đã lưu cấu hình thành công!');
    }
  }
}

// ==================== TỔNG QUAN BÁO CÁO & SƠ ĐỒ TRÒN ====================

function updateOverviewChart(stats = {}) {
  const success = stats.success ?? 0;
  const blocked = stats.blockedStranger ?? 0;
  const notReg = stats.notRegistered ?? 0;
  const pending = stats.pending ?? 0;
  const invalidOrError = (stats.invalidPhone ?? 0) + (stats.error ?? 0);
  const total = stats.total ?? (success + blocked + notReg + pending + invalidOrError);

  // Cập nhật số liệu chú thích dưới biểu đồ
  const elSuccess = document.getElementById('legendSuccess');
  const elBlocked = document.getElementById('legendBlocked');
  const elNotReg = document.getElementById('legendNotReg');
  const elPending = document.getElementById('legendPending');
  if (elSuccess) elSuccess.textContent = success;
  if (elBlocked) elBlocked.textContent = blocked;
  if (elNotReg) elNotReg.textContent = notReg;
  if (elPending) elPending.textContent = pending;

  // Tính tỷ lệ thành công
  const processed = total - pending;
  const rate = processed > 0 ? Math.round((success / processed) * 100) : 0;
  const overviewSuccessRate = document.getElementById('overviewSuccessRate');
  const overviewProgressBar = document.getElementById('overviewProgressBar');
  if (overviewSuccessRate) overviewSuccessRate.textContent = `${rate}%`;
  if (overviewProgressBar) overviewProgressBar.style.width = `${rate}%`;

  // Số lượng khách phản hồi
  const repliedList = (state.contacts || []).filter((c) => c.hasReplied || c.replyText);
  const overviewRepliedCount = document.getElementById('overviewRepliedCount');
  if (overviewRepliedCount) overviewRepliedCount.textContent = repliedList.length;

  // Hiển thị tiến độ từng tài khoản Zalo
  const overviewAccountsProgress = document.getElementById('overviewAccountsProgress');
  if (overviewAccountsProgress) {
    const accs = state.accounts || [];
    overviewAccountsProgress.innerHTML = accs
      .map((acc) => {
        const sent = acc.sentCount || 0;
        const isReady = acc.status === 'READY';
        return `
          <div class="d-flex align-items-center justify-content-between p-2 bg-white rounded-2 border">
            <div class="d-flex align-items-center gap-2">
              <span class="dot ${isReady ? 'dot-green' : 'dot-gray'}"></span>
              <strong class="small text-dark">${escapeHtml(acc.name)}</strong>
              ${acc.zaloProfileName ? `<span class="badge bg-light text-primary border" style="font-size:11px;">${escapeHtml(acc.zaloProfileName)}</span>` : ''}
            </div>
            <span class="badge bg-primary rounded-pill px-2 py-1">${sent} tin đã gửi</span>
          </div>
        `;
      })
      .join('');
  }

  // Vẽ hoặc cập nhật Sơ Đồ Tròn bằng Chart.js
  const canvas = document.getElementById('chartStatusPie');
  if (!canvas || typeof Chart === 'undefined') return;

  const chartData = [success, blocked, notReg, pending, invalidOrError];
  const chartColors = ['#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#ec4899'];

  if (state.chartInstance) {
    state.chartInstance.data.datasets[0].data = chartData;
    state.chartInstance.update();
  } else {
    state.chartInstance = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Thành công', 'Chặn người lạ', 'Chưa ĐK Zalo', 'Đang chờ', 'Lỗi / Sai số'],
        datasets: [
          {
            data: chartData,
            backgroundColor: chartColors,
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                const val = context.raw || 0;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${context.label}: ${val} (${pct}%)`;
              }
            }
          }
        },
        cutout: '68%'
      }
    });
  }
}

// ==================== QUẢN LÝ KHÁCH HÀNG ĐÃ PHẢN HỒI ====================

function upsertContactInState(incoming) {
  if (!incoming) return;
  const isFromZaloWeb = !incoming.phone || incoming.phone === 'Từ Zalo Web';
  const incName = String(incoming.name || incoming.zaloName || '')
    .toLowerCase()
    .trim();

  const idx = (state.contacts || []).findIndex((c) => {
    if (incoming.id && c.id === incoming.id) return true;
    if (!isFromZaloWeb && c.phone === incoming.phone) return true;
    if (isFromZaloWeb && (!c.phone || c.phone === 'Từ Zalo Web')) {
      const cName = String(c.name || c.zaloName || '')
        .toLowerCase()
        .trim();
      return (
        cName === incName &&
        (c.replyByAccountId || '') === (incoming.replyByAccountId || '')
      );
    }
    return false;
  });

  if (idx !== -1) {
    state.contacts[idx] = { ...state.contacts[idx], ...incoming };
  } else {
    state.contacts.unshift(incoming);
  }
}

function stripTextAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function getUniqueRepliedContacts() {
  const byKey = new Map();
  for (const c of state.contacts || []) {
    if (!c || (!c.hasReplied && !c.replyText)) continue;
    const isFromZaloWeb = !c.phone || c.phone === 'Từ Zalo Web';
    const normName = String(c.name || c.zaloName || '')
      .toLowerCase()
      .trim();
    const key = isFromZaloWeb
      ? `zw__${normName}__${c.replyByAccountId || c.replyByAccount || ''}`
      : `ph__${c.phone}`;

    if (!byKey.has(key)) {
      byKey.set(key, { ...c });
    } else {
      const prev = byKey.get(key);
      const prevMs = prev.replyAt ? new Date(prev.replyAt).getTime() : 0;
      const curMs = c.replyAt ? new Date(c.replyAt).getTime() : 0;
      byKey.set(key, curMs >= prevMs ? { ...prev, ...c } : { ...c, ...prev });
    }
  }

  // Gộp bản ghi "Từ Zalo Web" trùng tên với khách đã có SĐT thật
  const phoneItems = [];
  const zwKeysToRemove = [];
  for (const [k, val] of byKey.entries()) {
    if (k.startsWith('ph__')) phoneItems.push([k, val]);
  }
  for (const [k, zw] of byKey.entries()) {
    if (!k.startsWith('zw__')) continue;
    const zwClean = stripTextAccents(zw.name || zw.zaloName);
    if (!zwClean) continue;
    const match = phoneItems.find(([, ph]) => {
      const n1 = stripTextAccents(ph.name);
      const n2 = stripTextAccents(ph.zaloName);
      return (n1 && n1 === zwClean) || (n2 && n2 === zwClean);
    });
    if (match) {
      const [phKey, ph] = match;
      const phMs = ph.replyAt ? new Date(ph.replyAt).getTime() : 0;
      const zwMs = zw.replyAt ? new Date(zw.replyAt).getTime() : 0;
      if (zwMs > phMs) {
        byKey.set(phKey, {
          ...ph,
          hasReplied: true,
          replyText: zw.replyText || ph.replyText,
          replyAt: zw.replyAt || ph.replyAt,
          replyByAccount: zw.replyByAccount || ph.replyByAccount,
          replyByAccountId: zw.replyByAccountId || ph.replyByAccountId
        });
      }
      zwKeysToRemove.push(k);
    }
  }
  for (const k of zwKeysToRemove) {
    byKey.delete(k);
  }

  // Sắp xếp tin nhắn được phản hồi MỚI NHẤT LÊN ĐẦU (Realtime)
  return Array.from(byKey.values()).sort((a, b) => {
    const tA = a.replyAt ? new Date(a.replyAt).getTime() : 0;
    const tB = b.replyAt ? new Date(b.replyAt).getTime() : 0;
    if (tB !== tA) return tB - tA;
    const rA = typeof a.sidebarRank === 'number' ? a.sidebarRank : 9999;
    const rB = typeof b.sidebarRank === 'number' ? b.sidebarRank : 9999;
    if (rA !== rB) return rA - rB;
    const uA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const uB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return uB - uA;
  });
}

async function markRepliesSeenOnServer(contactId = null) {
  try {
    await fetch('/api/replies/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId })
    });
  } catch (err) {
    // ignore
  }
}

async function loadReplies() {
  try {
    const res = await fetch('/api/replies');
    const data = await res.json();
    if (data.ok) {
      state.replies = data.replies || [];
      state.replies.forEach((rep) => upsertContactInState(rep));
      renderReplies();
      updatePanelBadges();
    }
  } catch (err) {
    console.error('Lỗi tải danh sách phản hồi:', err);
  }
}

function renderReplies() {
  const allReplied = getUniqueRepliedContacts();
  if (badgeRepliesCount) {
    badgeRepliesCount.textContent = `${allReplied.length} rep`;
  }
  if (repliesCountHeaderBadge) {
    repliesCountHeaderBadge.textContent = `${allReplied.length} khách đã phản hồi`;
  }

  if (!repliesTableBody) return;

  // Cập nhật danh sách options trong select lọc nick nếu chưa có
  if (selRepliesFilterAccount && selRepliesFilterAccount.options.length <= 1) {
    (state.accounts || []).forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.name;
      opt.textContent = `Chỉ xem nick: ${acc.name}`;
      selRepliesFilterAccount.appendChild(opt);
    });
  }

  const q = (state.repliesSearchQuery || '').trim().toLowerCase();
  const accFilter = state.repliesFilterAccount || 'ALL';

  const filtered = allReplied.filter((c) => {
    if (accFilter !== 'ALL') {
      const recAcc = c.replyByAccount || c.sentByAccount || '';
      if (!recAcc.includes(accFilter)) return false;
    }
    if (q) {
      const hay = `${c.phone} ${c.rawPhone} ${c.name} ${c.zaloName} ${c.replyText} ${c.sentMessage}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    repliesTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-4 text-muted">
          ${allReplied.length === 0
            ? 'Chưa có phản hồi nào từ khách hàng. Bấm "Quét kiểm tra phản hồi mới" để quét tin nhắn thực tế từ Zalo Web.'
            : 'Không tìm thấy phản hồi phù hợp với điều kiện lọc.'}
        </td>
      </tr>
    `;
    return;
  }

  repliesTableBody.innerHTML = filtered
    .map((c, index) => {
      const zaloAccName = c.replyByAccount || c.sentByAccount || 'Tài khoản Zalo';
      const isDefaultAcc = zaloAccName.includes('#1') || zaloAccName.includes('Mặc định');
      const badgeClass = isDefaultAcc ? 'bg-primary' : 'bg-info text-dark';
      const replyMs = c.replyAt ? new Date(c.replyAt).getTime() : 0;
      const isVeryRecent = replyMs > 0 && Date.now() - replyMs < 20000;
      const replyTime = c.replyAt ? new Date(c.replyAt).toLocaleString('vi-VN') : 'Vừa xong';
      const sentTime = c.sentAt ? new Date(c.sentAt).toLocaleString('vi-VN') : '';
      const safeName = escapeHtml(c.name || c.zaloName || '').replace(/'/g, "\\'");

      return `
        <tr style="${isVeryRecent ? 'background-color: rgba(22, 163, 74, 0.06); transition: background-color 0.3s ease;' : ''}">
          <td class="text-muted small fw-semibold">${index + 1}</td>
          <td>
            <div class="fw-bold text-dark d-flex align-items-center gap-1 flex-wrap">
              <span>${escapeHtml(c.name || c.zaloName || 'Khách hàng')}</span>
              ${isVeryRecent ? '<span class="badge bg-danger" style="font-size:10px;">MỚI</span>' : ''}
            </div>
            ${c.zaloName && c.zaloName !== c.name ? `<small class="text-muted d-block">${escapeHtml(c.zaloName)}</small>` : ''}
          </td>
          <td>
            <span class="font-monospace fw-semibold text-primary">${escapeHtml(c.phone || c.rawPhone)}</span>
          </td>
          <td>
            <span class="badge ${badgeClass} border">${escapeHtml(zaloAccName)}</span>
          </td>
          <td class="small text-muted" style="max-width: 220px;">
            <div class="text-truncate" title="${escapeHtml(c.sentMessage || '')}">
              ${escapeHtml(c.sentMessage || 'Đã gửi tin nhắn')}
            </div>
            ${sentTime ? `<small class="text-muted" style="font-size:10.5px;">${sentTime}</small>` : ''}
          </td>
          <td>
            <div class="p-2 bg-success-subtle border border-success-subtle rounded-2 text-dark small">
              <div class="fw-semibold text-success mb-1">
                <i class="bi bi-chat-quote-fill me-1"></i>${escapeHtml(c.replyText || 'Đã nhận phản hồi')}
              </div>
              <small class="text-muted" style="font-size: 11px;">Lúc: ${replyTime}</small>
            </div>
          </td>
          <td class="text-center">
            <button class="btn btn-outline-primary btn-sm fw-semibold" onclick="openChatWithContact('${c.phone}', '${c.replyByAccountId || ''}', '${safeName}')" title="Mở cuộc trò chuyện trên Zalo Web">
              <i class="bi bi-chat-dots-fill"></i> Mở chat
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.openChatWithContact = async function (phone, accountId, contactName = '') {
  try {
    markRepliesSeenOnServer(phone !== 'Từ Zalo Web' ? phone : contactName);
    const res = await fetch('/api/browser/open-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, accountId, contactName })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      openQrModal();
    }
  } catch (err) {
    alert(`Không thể mở chat: ${err.message}`);
  }
};

// ==================== HỆ THỐNG ÂM THANH & THÔNG BÁO REALTIME ====================

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Nốt 1 (E5 - 659.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Nốt 2 (A5 - 880.00 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1);
    gain2.gain.setValueAtTime(0.18, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.4);
  } catch (err) {
    // quiet fallback
  }
}

function showReplyToast(customerName, replyText, accountName) {
  let toastContainer = document.getElementById('replyToastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'replyToastContainer';
    toastContainer.style.position = 'fixed';
    toastContainer.style.bottom = '14px';
    toastContainer.style.right = '14px';
    toastContainer.style.zIndex = '999999';
    toastContainer.style.display = 'flex';
    toastContainer.style.flexDirection = 'column';
    toastContainer.style.gap = '6px';
    toastContainer.style.pointerEvents = 'none';
    document.body.appendChild(toastContainer);
  }

  // Không chồng nhiều thông báo của cùng 1 khách hàng
  const safeKey = 'toast_cust_' + String(customerName + '_' + accountName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const existing = document.getElementById(safeKey);
  if (existing) existing.remove();

  const toastEl = document.createElement('div');
  toastEl.id = safeKey;
  toastEl.style.pointerEvents = 'auto';
  toastEl.style.cursor = 'pointer';
  toastEl.style.background = 'linear-gradient(135deg, #0f766e, #15803d)';
  toastEl.style.color = '#ffffff';
  toastEl.style.padding = '7px 12px';
  toastEl.style.borderRadius = '8px';
  toastEl.style.fontSize = '12.5px';
  toastEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.18)';
  toastEl.style.display = 'flex';
  toastEl.style.alignItems = 'center';
  toastEl.style.gap = '8px';
  toastEl.style.maxWidth = '340px';
  toastEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
  toastEl.title = 'Click để xem danh sách khách hàng phản hồi';

  toastEl.innerHTML = `
    <span style="font-size: 14px;">🔔</span>
    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
      <b>${escapeHtml(customerName)}</b> phản hồi tại <b>${escapeHtml(accountName || 'Zalo')}</b>
    </span>
  `;

  toastEl.addEventListener('click', () => {
    toastEl.remove();
    switchPanel('replies');
  });

  toastContainer.appendChild(toastEl);

  setTimeout(() => {
    if (toastEl && toastEl.parentNode) {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(6px)';
      setTimeout(() => {
        if (toastEl && toastEl.parentNode) toastEl.remove();
      }, 200);
    }
  }, 2000);
}

// ==================== CÀI ĐẶT PRESET TỐC ĐỘ GỬI ====================

const btnPresetTurbo = document.getElementById('btnPresetTurbo');
const btnPresetFast = document.getElementById('btnPresetFast');
const btnPresetSafe = document.getElementById('btnPresetSafe');
const badgeSpeedPresetName = document.getElementById('badgeSpeedPresetName');
const lblSpeedPresetHelp = document.getElementById('lblSpeedPresetHelp');

function updateSpeedPresetUI(mode) {
  if (btnPresetTurbo) btnPresetTurbo.classList.remove('active');
  if (btnPresetFast) btnPresetFast.classList.remove('active');
  if (btnPresetSafe) btnPresetSafe.classList.remove('active');

  if (mode === 'TURBO') {
    if (btnPresetTurbo) btnPresetTurbo.classList.add('active');
    if (badgeSpeedPresetName) {
      badgeSpeedPresetName.className = 'speed-status-pill preset-turbo';
      badgeSpeedPresetName.textContent = '⚡ Siêu Tốc';
    }
    if (lblSpeedPresetHelp) {
      lblSpeedPresetHelp.innerHTML = 'Bắn liên tục <b>0 – 1s</b>, không nghỉ chặng. Tối ưu khi gửi 5.000 SĐT đa luồng.';
    }
  } else if (mode === 'FAST') {
    if (btnPresetFast) btnPresetFast.classList.add('active');
    if (badgeSpeedPresetName) {
      badgeSpeedPresetName.className = 'speed-status-pill preset-fast';
      badgeSpeedPresetName.textContent = '🚀 Nhanh';
    }
    if (lblSpeedPresetHelp) {
      lblSpeedPresetHelp.innerHTML = 'Nghỉ <b>2 – 4s</b> mỗi tin, tạm nghỉ 15s sau mỗi 30 SĐT. Cân bằng tốc độ & an toàn.';
    }
  } else if (mode === 'SAFE') {
    if (btnPresetSafe) btnPresetSafe.classList.add('active');
    if (badgeSpeedPresetName) {
      badgeSpeedPresetName.className = 'speed-status-pill preset-safe';
      badgeSpeedPresetName.textContent = '🛡️ An Toàn';
    }
    if (lblSpeedPresetHelp) {
      lblSpeedPresetHelp.innerHTML = 'Nghỉ <b>12 – 25s</b> mỗi tin, tạm nghỉ 120s sau mỗi 15 SĐT. Phù hợp cho nick mới.';
    }
  }
}

function setSpeedPreset(mode) {
  updateSpeedPresetUI(mode);

  if (mode === 'TURBO') {
    if (numMinDelay) numMinDelay.value = 0;
    if (numMaxDelay) numMaxDelay.value = 1;
    if (numBatchSize) numBatchSize.value = 100;
    if (numBatchPause) numBatchPause.value = 0;
    if (chkFastPasteMode) chkFastPasteMode.checked = true;

    // Tự động chuyển sang chế độ Gửi Song Song nếu có >= 2 nick
    const optModeParallel = document.getElementById('optModeParallel');
    if (optModeParallel && (state.accounts || []).length >= 2) {
      optModeParallel.checked = true;
      const badgeCurrentSendMode = document.getElementById('badgeCurrentSendMode');
      if (badgeCurrentSendMode) {
        badgeCurrentSendMode.textContent = '⚡ Song song Đa luồng';
        badgeCurrentSendMode.className = 'badge bg-success px-2 py-1';
      }
    }
  } else if (mode === 'FAST') {
    if (numMinDelay) numMinDelay.value = 2;
    if (numMaxDelay) numMaxDelay.value = 4;
    if (numBatchSize) numBatchSize.value = 30;
    if (numBatchPause) numBatchPause.value = 15;
    if (chkFastPasteMode) chkFastPasteMode.checked = true;
  } else if (mode === 'SAFE') {
    if (numMinDelay) numMinDelay.value = 12;
    if (numMaxDelay) numMaxDelay.value = 25;
    if (numBatchSize) numBatchSize.value = 15;
    if (numBatchPause) numBatchPause.value = 120;
  }
}

if (btnPresetTurbo) btnPresetTurbo.addEventListener('click', () => setSpeedPreset('TURBO'));
if (btnPresetFast) btnPresetFast.addEventListener('click', () => setSpeedPreset('FAST'));
if (btnPresetSafe) btnPresetSafe.addEventListener('click', () => setSpeedPreset('SAFE'));

// ==================== QUẢN LÝ HÌNH ẢNH ĐÍNH KÈM ====================

function renderAttachedImages(images = []) {
  if (!attachedImagesContainer) return;
  attachedImagesContainer.innerHTML = images
    .map(
      (img, i) => `
        <div class="img-thumb-item shadow-sm">
          <img src="/api/images/${img.filename}" alt="${escapeHtml(img.originalName)}" />
          <button type="button" class="btn-remove-thumb" onclick="removeAttachedImage(${i})" title="Xóa ảnh này">×</button>
        </div>
      `
    )
    .join('');

  if (badgeImagesTotal) {
    badgeImagesTotal.textContent = `${images.length} ảnh`;
  }
}

async function uploadImageFiles(files) {
  const formData = new FormData();
  for (const f of files) {
    formData.append('images', f);
  }
  const res = await fetch('/api/images', {
    method: 'POST',
    body: formData
  });
  const data = await res.json();
  if (data.ok) {
    state.settings.attachedImages = data.images;
    renderAttachedImages(data.images);
  }
}

window.removeAttachedImage = async function (index) {
  const res = await fetch(`/api/images/${index}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    state.settings.attachedImages = data.images;
    renderAttachedImages(data.images);
  }
};

fileImageInput.addEventListener('change', async () => {
  if (fileImageInput.files && fileImageInput.files.length > 0) {
    await uploadImageFiles(Array.from(fileImageInput.files));
    fileImageInput.value = '';
  }
});

btnClearImages.addEventListener('click', async () => {
  const res = await fetch('/api/images', { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    state.settings.attachedImages = [];
    renderAttachedImages([]);
  }
});

// Drag & drop hoặc paste ảnh trực tiếp
txtTemplate.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imgFiles = [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imgFiles.push(file);
    }
  }
  if (imgFiles.length > 0) {
    e.preventDefault();
    await uploadImageFiles(imgFiles);
  }
});

function updateStartButtonLabel() {
  const activeAcc =
    (state.accounts || []).find((a) => a.id === state.activeAccountId) ||
    (state.accounts || [])[0];
  const isAutoRotate = chkAutoRotateAccounts ? chkAutoRotateAccounts.checked : true;
  if (isAutoRotate && (state.accounts || []).length > 1) {
    btnStartCampaign.innerHTML = `<i class="bi bi-play-fill fs-5"></i><span>Bắt đầu gửi (Tự động luân phiên)</span>`;
  } else if (activeAcc) {
    btnStartCampaign.innerHTML = `<i class="bi bi-play-fill fs-5"></i><span>Bắt đầu gửi (${escapeHtml(activeAcc.name)})</span>`;
  } else {
    btnStartCampaign.innerHTML = `<i class="bi bi-play-fill fs-5"></i><span>Bắt đầu gửi</span>`;
  }
}

// ==================== QUẢN LÝ TÀI KHOẢN ZALO ====================

function renderAccounts() {
  const accounts = state.accounts || [];
  const activeId = state.activeAccountId;

  accountsListContainer.innerHTML = accounts
    .map((acc) => {
      const isCurrent = acc.id === activeId;
      const isReady = acc.status === 'READY';
      const stBadge = isReady
        ? `<span class="badge bg-success-subtle text-success border border-success-subtle" style="font-size:11.5px;">🟢 Đã đăng nhập</span>`
        : `<span class="badge bg-secondary-subtle text-secondary border" style="font-size:11.5px;">⚪ Chưa đăng nhập</span>`;

      return `
        <div class="account-row ${isCurrent ? 'active' : ''}">
          <div class="d-flex align-items-center gap-3">
            <input
              type="radio"
              class="form-check-input mt-0"
              name="radActiveAccount"
              ${isCurrent ? 'checked' : ''}
              onchange="switchActiveAccount('${acc.id}', false)"
              style="width:19px; height:19px; cursor:pointer;"
            />
            <div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <strong class="text-dark">${escapeHtml(acc.name)}</strong>
                ${acc.zaloProfileName ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">${escapeHtml(acc.zaloProfileName)}</span>` : ''}
                ${stBadge}
              </div>
              <div class="small text-muted mt-1">
                ${isCurrent ? '<strong class="text-primary">🎯 Đang chọn làm tài khoản gửi chính</strong>' : '<span>Nhấn để chọn gửi bằng nick này</span>'} • Đã gửi: <strong>${acc.sentCount || 0}</strong> số
              </div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            ${
              isCurrent
                ? `<span class="btn btn-sm btn-success disabled py-1 px-3">✅ Đang chọn</span>`
                : `<button type="button" class="btn btn-outline-primary btn-sm py-1 px-3" onclick="switchActiveAccount('${acc.id}', false)">Chọn nick này</button>`
            }
            <button type="button" class="btn btn-primary btn-sm py-1 px-3" onclick="openAccountQr('${acc.id}')" title="Mở Zalo Web / Quét QR nick này">
              📱 Quét QR / Xem ngầm
            </button>
            ${
              accounts.length > 1
                ? `<button type="button" class="btn btn-outline-danger btn-sm py-1 px-2" onclick="deleteAccount('${acc.id}')" title="Xóa nick này">✖</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  const activeAcc = (accounts || []).find((a) => a.id === state.activeAccountId) || (accounts || [])[0];
  if (sidebarActiveAccName && activeAcc) {
    sidebarActiveAccName.textContent = activeAcc.name + (activeAcc.isDefault ? ' (Mặc định)' : '');
  }
  if (sidebarDot && activeAcc) {
    sidebarDot.className = 'dot ' + (activeAcc.status === 'READY' ? 'dot-green' : 'dot-gray');
  }
  if (badgeAccountsCount) {
    badgeAccountsCount.textContent = `${(accounts || []).length} nick`;
  }

  updateStartButtonLabel();
}

window.openAccountQr = async function (accountId) {
  state.activeAccountId = accountId;
  renderAccounts();
  openQrModal(); // Mở modal ngay lập tức 0ms!

  try {
    const res = await fetch('/api/browser/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId })
    });
    const data = await res.json();
    if (data.status) {
      state.status = data.status;
      if (data.status.accounts) state.accounts = data.status.accounts;
      if (data.status.activeAccountId) state.activeAccountId = data.status.activeAccountId;
      renderStatus(data.status);
      renderAccounts();
    }
  } catch (err) {
    // quiet
  }
};

window.switchActiveAccount = async function (accountId, openModal = false) {
  const res = await fetch('/api/accounts/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, launch: openModal })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  if (data.status) {
    state.status = data.status;
    if (data.status.accounts) state.accounts = data.status.accounts;
    if (data.status.activeAccountId) state.activeAccountId = data.status.activeAccountId;
    renderStatus(data.status);
    renderAccounts();
  }
  if (openModal) {
    openQrModal();
  }
};

window.deleteAccount = async function (accountId) {
  if (!confirm('Bạn có chắc muốn xóa tài khoản Zalo này khỏi danh sách?')) return;
  const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  state.accounts = data.accounts || [];
  renderAccounts();
};

btnAddAccount.addEventListener('click', async () => {
  const name = txtNewAccountName.value.trim();
  const res = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (data.ok) {
    txtNewAccountName.value = '';
    state.accounts = data.accounts;
    renderAccounts();
  }
});

btnLaunchAllAccounts.addEventListener('click', async () => {
  btnLaunchAllAccounts.disabled = true;
  btnLaunchAllAccounts.textContent = '⏳ Đang bật...';
  try {
    await fetch('/api/accounts/launch-all', { method: 'POST' });
  } finally {
    btnLaunchAllAccounts.disabled = false;
    btnLaunchAllAccounts.textContent = '⚡ Bật tất cả nick';
  }
});

if (chkAutoRotateAccounts) {
  chkAutoRotateAccounts.addEventListener('change', () => {
    updateStartButtonLabel();
    saveSettings(true);
  });
}

// Nút chọn nhanh lịch hẹn (+5p, +15p, +30p, +60p)
document.querySelectorAll('[data-schedule-min]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mins = Number(btn.dataset.scheduleMin) || 15;
    const target = new Date(Date.now() + mins * 60 * 1000);
    dtScheduleStartAt.value = toLocalDatetimeInputValue(target.toISOString());
    chkScheduleEnabled.checked = true;
    updateScheduleVisualState();
    await saveSettings(false);
  });
});

chkScheduleEnabled.addEventListener('change', () => {
  updateScheduleVisualState();
});

chkActiveHoursEnabled.addEventListener('change', () => {
  updateScheduleVisualState();
});

btnApplySchedule.addEventListener('click', async () => {
  updateScheduleVisualState();
  await saveSettings(false);
});

async function updatePreview() {
  try {
    const sample = state.contacts[0] || undefined;
    const res = await fetch('/api/preview-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: txtTemplate.value,
        contact: sample,
        useCustomMessageFirst: chkUseCustomFirst.checked
      })
    });
    const data = await res.json();
    if (data.ok) {
      previewBox.textContent = data.rendered || '(Trống)';
    }
  } catch {
    // ignore preview errors
  }
}

txtTemplate.addEventListener('input', updatePreview);
btnRegeneratePreview.addEventListener('click', updatePreview);

// Insert tags into template
document.querySelectorAll('.insert-tag').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tag = btn.dataset.tag;
    const start = txtTemplate.selectionStart;
    const end = txtTemplate.selectionEnd;
    const text = txtTemplate.value;
    txtTemplate.value = text.substring(0, start) + tag + text.substring(end);
    txtTemplate.focus();
    txtTemplate.selectionStart = txtTemplate.selectionEnd = start + tag.length;
    updatePreview();
  });
});

btnSaveSettings.addEventListener('click', async () => {
  await saveSettings(false);
});

// ==================== RENDER TRẠNG THÁI HỆ THỐNG ====================

function renderStatus(status) {
  const bState = status.browserState || 'CLOSED';
  const activeName = status.activeAccountName || 'Zalo Web';
  const viewingAcc =
    (status.accounts || state.accounts || []).find((a) => a.id === status.viewingAccountId) || null;
  const viewingName = viewingAcc ? viewingAcc.name : activeName;
  qrModalTitle.textContent = `📱 Đăng Nhập QR & Màn Hình Chạy Ngầm — ${viewingName}`;

  browserDot.className = 'dot';
  if (bState === 'READY') {
    browserDot.classList.add('dot-green');
    browserStatusText.textContent = `${activeName}: Đã đăng nhập (Chạy ngầm)`;
    if (btnCloseBrowser) btnCloseBrowser.classList.remove('hidden');
    qrModalStatusBar.classList.add('ready');
    qrModalStatusText.textContent =
      '🟢 ĐÃ ĐĂNG NHẬP ZALO THÀNH CÔNG! Bạn có thể bấm "✖ Đóng Form" ở góc phải để tắt form này đi.';
  } else if (bState === 'WAITING_LOGIN' || bState === 'OPENING') {
    browserDot.classList.add('dot-amber');
    browserStatusText.textContent =
      bState === 'OPENING' ? `${activeName}: Đang khởi động...` : `${activeName}: Chờ quét mã QR`;
    if (btnCloseBrowser) btnCloseBrowser.classList.remove('hidden');
    qrModalStatusBar.classList.remove('ready');
    qrModalStatusText.textContent =
      '🟡 Đang chờ quét mã QR trên màn hình bên dưới... (Có thể click chuột trực tiếp vào ảnh nếu cần)';
  } else {
    browserDot.classList.add('dot-gray');
    browserStatusText.textContent = `${activeName}: Đang đóng`;
    if (btnCloseBrowser) btnCloseBrowser.classList.add('hidden');
    closeQrModal();
  }

  const cState = status.campaignState || 'IDLE';
  campaignStateBadge.className = 'badge px-2 py-2 fw-bold';
  if (cState === 'RUNNING') {
    campaignStateBadge.className = 'badge bg-primary px-2 py-2 fw-bold';
    campaignStateBadge.textContent = 'ĐANG GỬI HÀNG LOẠT';
    btnStartCampaign.classList.add('hidden');
    btnPauseCampaign.classList.remove('hidden');
  } else if (cState === 'SCHEDULED') {
    campaignStateBadge.className = 'badge bg-warning text-dark px-2 py-2 fw-bold';
    campaignStateBadge.textContent = 'ĐANG HẸN GIỜ CHẠY';
    btnStartCampaign.classList.remove('hidden');
    btnPauseCampaign.classList.add('hidden');
  } else if (cState === 'PAUSED') {
    campaignStateBadge.className = 'badge bg-warning text-dark px-2 py-2 fw-bold';
    campaignStateBadge.textContent = 'ĐANG TẠM DỪNG';
    btnStartCampaign.classList.remove('hidden');
    btnPauseCampaign.classList.add('hidden');
  } else {
    campaignStateBadge.className = 'badge bg-secondary px-2 py-2 fw-bold';
    campaignStateBadge.textContent = 'SẴN SÀNG';
    btnStartCampaign.classList.remove('hidden');
    btnPauseCampaign.classList.add('hidden');
  }

  if (status.countdownSec && status.countdownSec > 0) {
    countdownBox.classList.remove('hidden');
    countdownValue.textContent = status.countdownSec;
  } else {
    countdownBox.classList.add('hidden');
  }

  if (status.scheduleCountdownSec && status.scheduleCountdownSec > 0) {
    scheduleCountdownBox.classList.remove('hidden');
    scheduleCountdownValue.textContent = status.scheduleCountdownSec;
  } else {
    scheduleCountdownBox.classList.add('hidden');
  }

  const s = status.stats || {};
  statTotal.textContent = s.total ?? 0;
  statSuccess.textContent = s.success ?? 0;
  statBlocked.textContent = s.blockedStranger ?? 0;
  statNotRegistered.textContent = s.notRegistered ?? 0;
  statPending.textContent = (s.pending ?? 0) + (s.processing ?? 0);

  tabCountAll.textContent = s.total ?? 0;
  tabCountBlocked.textContent = s.blockedStranger ?? 0;
  tabCountUnreg.textContent = s.notRegistered ?? 0;
  tabCountSuccess.textContent = s.success ?? 0;
  tabCountPending.textContent = (s.pending ?? 0) + (s.processing ?? 0);
  tabCountError.textContent = (s.invalidPhone ?? 0) + (s.error ?? 0);

  updateOverviewChart(s);
  updatePanelBadges();
}

function formatBadge(status) {
  switch (status) {
    case 'THANH_CONG':
      return '<span class="badge badge-THANH_CONG">✅ Gửi thành công</span>';
    case 'CHAN_NGUOI_LA':
      return '<span class="badge badge-CHAN_NGUOI_LA">🚫 Chặn người lạ</span>';
    case 'KHONG_DANG_KY':
      return '<span class="badge badge-KHONG_DANG_KY">❓ Chưa ĐK Zalo / Ẩn SĐT</span>';
    case 'PROCESSING':
      return '<span class="badge badge-PROCESSING">⚡ Đang tìm & gửi...</span>';
    case 'PENDING':
      return '<span class="badge badge-PENDING">⏳ Chờ xử lý</span>';
    case 'SAI_SO':
      return '<span class="badge badge-SAI_SO">⚠️ Sai định dạng SĐT</span>';
    default:
      return '<span class="badge badge-LOI">❌ Lỗi khác</span>';
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==================== ĐIỀU KHIỂN CHUYỂN PANEL ====================

function switchPanel(panelId) {
  state.currentPanel = panelId || 'overview';
  localStorage.setItem('tool_current_panel', state.currentPanel);

  if (mainContainer) {
    mainContainer.classList.remove(
      'panel-mode-overview',
      'panel-mode-accounts',
      'panel-mode-schedule',
      'panel-mode-import',
      'panel-mode-message',
      'panel-mode-table',
      'panel-mode-replies',
      'panel-mode-sync'
    );
    mainContainer.classList.add(`panel-mode-${state.currentPanel}`);
  }

  document.querySelectorAll('.sidebar-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === state.currentPanel);
  });

  updatePanelBadges();

  if (state.currentPanel === 'overview') {
    updateOverviewChart(state.status?.stats || {});
  } else if (state.currentPanel === 'table') {
    renderTable();
  } else if (state.currentPanel === 'replies') {
    renderReplies();
    markRepliesSeenOnServer();
  } else if (state.currentPanel === 'sync') {
    loadSyncInfo();
  }
}

function updatePanelBadges() {
  const badgeSyncPeers = document.getElementById('badgeSyncPeers');
  const lblSyncPeersCount = document.getElementById('lblSyncPeersCount');
  const peersCount = state.syncInfo?.peersCount || (state.syncInfo?.peers ? state.syncInfo.peers.length : 0);
  if (badgeSyncPeers) {
    badgeSyncPeers.textContent = `${peersCount} máy`;
  }
  if (lblSyncPeersCount) {
    lblSyncPeersCount.textContent = `P2P: ${peersCount} máy`;
  }
  if (badgeAccountsCount) {
    badgeAccountsCount.textContent = `${(state.accounts || []).length} nick`;
  }
  if (badgeScheduleState) {
    badgeScheduleState.textContent = state.settings?.scheduleEnabled ? '🟢 Đang bật' : 'Tắt';
  }
  if (badgeContactsTotal) {
    badgeContactsTotal.textContent = `${(state.contacts || []).length} số`;
  }
  if (badgeImagesTotal) {
    badgeImagesTotal.textContent = `${state.settings?.attachedImages?.length || 0} ảnh`;
  }
  if (badgeTablePending) {
    const pendingCount = (state.status?.stats?.pending ?? 0) + (state.status?.stats?.processing ?? 0);
    badgeTablePending.textContent = `${pendingCount} chờ`;
  }
  const repCount = getUniqueRepliedContacts().length;
  if (badgeRepliesCount) {
    badgeRepliesCount.textContent = `${repCount} rep`;
  }
  if (repliesCountHeaderBadge) {
    repliesCountHeaderBadge.textContent = `${repCount} khách đã phản hồi`;
  }
}

// ==================== BẢNG DANH SÁCH & PHÂN TRANG ====================

function renderTable() {
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = state.contacts.filter((c) => {
    if (state.filterStatus !== 'ALL') {
      if (state.filterStatus === 'PENDING') {
        if (c.status !== 'PENDING' && c.status !== 'PROCESSING') return false;
      } else if (state.filterStatus === 'SAI_SO') {
        if (c.status !== 'SAI_SO' && c.status !== 'LOI') return false;
      } else if (c.status !== state.filterStatus) {
        return false;
      }
    }

    if (q) {
      const hay = `${c.phone} ${c.rawPhone} ${c.name} ${c.zaloName} ${c.info} ${c.reason}`.toLowerCase();
      return hay.includes(q);
    }
    return true;
  });

  const totalFiltered = filtered.length;
  const rawSize = selPageSize ? selPageSize.value : '25';
  const isAll = rawSize === 'all';
  const pageSize = isAll ? totalFiltered || 1 : Math.max(1, parseInt(rawSize, 10) || 25);
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalFiltered / pageSize));

  state.pagination.totalPages = totalPages;
  if (state.pagination.currentPage > totalPages) {
    state.pagination.currentPage = totalPages;
  }
  if (state.pagination.currentPage < 1) {
    state.pagination.currentPage = 1;
  }

  const startIdx = isAll ? 0 : (state.pagination.currentPage - 1) * pageSize;
  const endIdx = isAll ? totalFiltered : Math.min(startIdx + pageSize, totalFiltered);
  const pageContacts = filtered.slice(startIdx, endIdx);

  if (pageInfo) {
    pageInfo.textContent = `Trang ${state.pagination.currentPage}/${totalPages} (${totalFiltered} dòng)`;
  }

  btnFirstPage.disabled = state.pagination.currentPage <= 1;
  btnPrevPage.disabled = state.pagination.currentPage <= 1;
  btnNextPage.disabled = state.pagination.currentPage >= totalPages;
  btnLastPage.disabled = state.pagination.currentPage >= totalPages;

  if (pageContacts.length === 0) {
    contactsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-muted">
          Chưa có số điện thoại nào phù hợp. Hãy nạp danh sách ở Mục 3.
        </td>
      </tr>
    `;
    return;
  }

  contactsTableBody.innerHTML = pageContacts
    .map((c, i) => {
      const index = startIdx + i + 1;
      const sentAccount = c.sentByAccount || (c.results && Object.values(c.results)[0]?.accountName) || '-';

      return `
        <tr>
          <td class="text-center">
            <input type="checkbox" class="form-check-input contact-chk" data-id="${c.id}">
          </td>
          <td class="text-muted small">${index}</td>
          <td>
            <span class="font-monospace fw-semibold text-primary">${escapeHtml(c.phone || c.rawPhone)}</span>
          </td>
          <td>${escapeHtml(c.name || '-')}</td>
          <td>
            <span class="fw-semibold text-dark">${escapeHtml(c.zaloName || '-')}</span>
          </td>
          <td>
            <span class="badge bg-light text-dark border">${escapeHtml(sentAccount)}</span>
          </td>
          <td>${formatBadge(c.status)}</td>
          <td class="small text-muted" style="max-width: 280px;">
            <div class="text-truncate" title="${escapeHtml(c.reason || '')}">${escapeHtml(c.reason || '-')}</div>
          </td>
          <td class="text-center">
            <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="deleteSingleContact('${c.id}')" title="Xóa số này">✖</button>
          </td>
        </tr>
      `;
    })
    .join('');

  if (chkSelectAll) {
    chkSelectAll.checked = false;
  }
}

window.deleteSingleContact = async function (id) {
  const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    state.contacts = state.contacts.filter((c) => c.id !== id);
    renderTable();
    updateOverviewChart(state.status?.stats || {});
    updatePanelBadges();
  }
};

// ==================== TABS & NAVIGATION LISTENERS ====================

// Điều khiển Tabs Dán nhanh / Upload Excel
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.remove('active');
      p.classList.add('d-none');
    });
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    if (target) {
      target.classList.add('active');
      target.classList.remove('d-none');
    }
  });
});

btnFillSampleText.addEventListener('click', () => {
  txtBulkContacts.value = [
    '0912345678 | Nguyễn Văn An | Đơn hàng #DH101 - Giao ngày 15/11',
    '84987654323 | Trần Thị Bình | Mã giảm giá VIP50',
    '0905112230 | Lê Hoàng Nam | Lịch hẹn tư vấn 14h00',
    '+84938112235 | Phạm Minh Tuấn | Lịch hẹn bảo dưỡng xe 09h30 sáng mai',
    '0977889904 | Hoàng Thu Trang | Kiểm tra SĐT tư vấn'
  ].join('\n');
});

btnImportText.addEventListener('click', async () => {
  const text = txtBulkContacts.value.trim();
  if (!text) {
    alert('Vui lòng nhập hoặc dán danh sách số điện thoại.');
    return;
  }

  const res = await fetch('/api/contacts/import-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      deduplicate: chkDeduplicateText.checked,
      replaceExisting: chkReplaceText.checked
    })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  txtBulkContacts.value = '';
  state.contacts = data.contacts;
  renderStatus({ ...state.status, stats: data.stats });
  renderTable();
  updateOverviewChart(data.stats);
  updatePanelBadges();
  alert(`Đã nạp thành công ${data.addedCount} số điện thoại vào danh sách!`);
  switchPanel('table');
});

btnUploadExcel.addEventListener('click', async () => {
  if (!fileExcelInput.files || !fileExcelInput.files[0]) {
    alert('Vui lòng chọn file Excel hoặc CSV trước.');
    return;
  }
  const formData = new FormData();
  formData.append('file', fileExcelInput.files[0]);
  formData.append('deduplicate', chkDeduplicateExcel.checked);
  formData.append('replaceExisting', chkReplaceExcel.checked);

  btnUploadExcel.disabled = true;
  btnUploadExcel.textContent = '⏳ Đang upload...';
  try {
    const res = await fetch('/api/contacts/import-excel', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    fileExcelInput.value = '';
    state.contacts = data.contacts;
    renderStatus({ ...state.status, stats: data.stats });
    renderTable();
    updateOverviewChart(data.stats);
    updatePanelBadges();
    alert(`Đã nạp thành công ${data.addedCount} số điện thoại từ file Excel!`);
    switchPanel('table');
  } finally {
    btnUploadExcel.disabled = false;
    btnUploadExcel.textContent = 'Upload & Nạp';
  }
});

// Điều khiển Tabs Lọc Trạng Thái Bảng SĐT
document.querySelectorAll('.filter-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.filterStatus = tab.dataset.status || 'ALL';
    state.pagination.currentPage = 1;
    renderTable();
  });
});

// Click vào các Stat Card ở trang Overview chuyển thẳng sang Bảng và lọc theo trạng thái đó
document.querySelectorAll('.stat-card').forEach((card) => {
  card.addEventListener('click', () => {
    const filter = card.dataset.filter || 'ALL';
    state.filterStatus = filter;
    state.pagination.currentPage = 1;
    document.querySelectorAll('.filter-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.status === filter);
    });
    switchPanel('table');
  });
});

txtSearchTable.addEventListener('input', () => {
  state.searchQuery = txtSearchTable.value;
  state.pagination.currentPage = 1;
  renderTable();
});

// Điều khiển Sidebar Navigation Menu
document.querySelectorAll('.sidebar-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchPanel(btn.dataset.panel);
  });
});

// Phân trang
if (selPageSize) {
  selPageSize.addEventListener('change', () => {
    state.pagination.currentPage = 1;
    renderTable();
  });
}
btnFirstPage.addEventListener('click', () => {
  state.pagination.currentPage = 1;
  renderTable();
});
btnPrevPage.addEventListener('click', () => {
  if (state.pagination.currentPage > 1) {
    state.pagination.currentPage--;
    renderTable();
  }
});
btnNextPage.addEventListener('click', () => {
  if (state.pagination.currentPage < state.pagination.totalPages) {
    state.pagination.currentPage++;
    renderTable();
  }
});
btnLastPage.addEventListener('click', () => {
  state.pagination.currentPage = state.pagination.totalPages;
  renderTable();
});

// Chọn tất cả / Thao tác hàng loạt
chkSelectAll.addEventListener('change', () => {
  document.querySelectorAll('.contact-chk').forEach((chk) => {
    chk.checked = chkSelectAll.checked;
  });
});

btnDeleteSelected.addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.contact-chk:checked')).map((c) => c.dataset.id);
  if (ids.length === 0) {
    alert('Vui lòng tích chọn ít nhất 1 số điện thoại để xóa.');
    return;
  }
  for (const id of ids) {
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  }
  state.contacts = state.contacts.filter((c) => !ids.includes(c.id));
  renderTable();
  updateOverviewChart(state.status?.stats || {});
  updatePanelBadges();
});

btnResetSelectedStatus.addEventListener('click', async () => {
  const ids = Array.from(document.querySelectorAll('.contact-chk:checked')).map((c) => c.dataset.id);
  if (ids.length === 0) {
    alert('Vui lòng tích chọn ít nhất 1 số điện thoại để đặt lại.');
    return;
  }
  for (const id of ids) {
    await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PENDING', reason: 'Đặt lại về Chờ xử lý' })
    });
  }
  state.contacts.forEach((c) => {
    if (ids.includes(c.id)) {
      c.status = 'PENDING';
      c.reason = 'Đặt lại về Chờ xử lý';
    }
  });
  renderTable();
  updateOverviewChart(state.status?.stats || {});
  updatePanelBadges();
});

btnClearAll.addEventListener('click', async () => {
  if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách số điện thoại?')) return;
  const res = await fetch('/api/contacts', { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    state.contacts = [];
    renderStatus({ ...state.status, stats: data.stats });
    renderTable();
    updateOverviewChart(data.stats);
    updatePanelBadges();
  }
});

// ==================== PANEL KHÁCH HÀNG PHẢN HỒI ====================

if (btnCheckReplies) {
  btnCheckReplies.addEventListener('click', async () => {
    btnCheckReplies.disabled = true;
    btnCheckReplies.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Đang quét...';
    try {
      const res = await fetch('/api/replies/check', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        alert(`Đã kiểm tra xong: Tìm thấy ${data.foundCount || 0} phản hồi mới từ Zalo Web.`);
        await loadReplies();
      } else {
        alert(data.error || 'Lỗi kiểm tra phản hồi.');
      }
    } catch (err) {
      alert(`Lỗi kiểm tra phản hồi: ${err.message}`);
    } finally {
      btnCheckReplies.disabled = false;
      btnCheckReplies.innerHTML = '<i class="bi bi-arrow-repeat"></i><span>Quét kiểm tra phản hồi mới</span>';
    }
  });
}

if (btnResetReplies) {
  btnResetReplies.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc chắn muốn đặt lại trạng thái phản hồi về trống?')) return;
    try {
      const res = await fetch('/api/replies/reset', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        for (const c of (state.contacts || [])) {
          c.hasReplied = false;
          delete c.replyText;
          delete c.replyAt;
          delete c.replyByAccount;
          delete c.replyByAccountId;
        }
        renderReplies();
        updateOverviewChart(state.status?.stats || {});
        updatePanelBadges();
      } else {
        alert(data.error || 'Lỗi khi đặt lại phản hồi.');
      }
    } catch (err) {
      alert(`Lỗi khi đặt lại phản hồi: ${err.message}`);
    }
  });
}

if (txtSearchReplies) {
  txtSearchReplies.addEventListener('input', () => {
    state.repliesSearchQuery = txtSearchReplies.value;
    renderReplies();
  });
}

if (selRepliesFilterAccount) {
  selRepliesFilterAccount.addEventListener('change', () => {
    state.repliesFilterAccount = selRepliesFilterAccount.value;
    renderReplies();
  });
}

// ==================== FORM QUÉT QR & POPUP LIVE SCREENSHOT ====================

let isFetchingLiveScreenshot = false;
const liveZaloImageSpinner = document.getElementById('liveZaloImageSpinner');

async function refreshLiveScreenshot() {
  if (qrModalOverlay.classList.contains('hidden')) return;
  if (isFetchingLiveScreenshot) return; // Tránh dồn ứ request khi mạng LAN chậm
  isFetchingLiveScreenshot = true;

  try {
    const res = await fetch(`/api/browser/screenshot?t=${Date.now()}`);
    const data = await res.json();
    if (data.ok && data.imageBase64) {
      if (liveZaloImage.src !== data.imageBase64) {
        liveZaloImage.src = data.imageBase64;
      }
      liveZaloImage.style.display = 'inline-block';
      if (liveZaloImageSpinner) liveZaloImageSpinner.style.display = 'none';

      // Cập nhật thanh trạng thái
      if (data.isLoggedIn) {
        if (qrModalStatusBar) {
          qrModalStatusBar.className = 'alert alert-success py-2 px-3 mb-2 small fw-semibold d-flex align-items-center justify-content-between';
        }
        if (qrModalStatusText) {
          qrModalStatusText.innerHTML = '🟢 <b>ĐÃ ĐĂNG NHẬP ZALO THÀNH CÔNG!</b> Bạn có thể bấm "✖ Đóng Form" bất cứ lúc nào.';
        }
      } else {
        if (qrModalStatusBar) {
          qrModalStatusBar.className = 'alert alert-warning py-2 px-3 mb-2 small fw-semibold d-flex align-items-center justify-content-between';
        }
        if (qrModalStatusText) {
          qrModalStatusText.innerHTML = '🟡 Đang chờ quét mã QR hoặc chọn tài khoản Zalo trên màn hình...';
        }
      }
    }
  } catch {
    // ignore screenshot network hiccup
  } finally {
    isFetchingLiveScreenshot = false;
  }
}

function openQrModal() {
  qrModalOverlay.classList.remove('hidden');
  if (liveZaloImage.src) {
    liveZaloImage.style.display = 'inline-block';
    if (liveZaloImageSpinner) liveZaloImageSpinner.style.display = 'none';
  } else {
    liveZaloImage.style.display = 'none';
    if (liveZaloImageSpinner) liveZaloImageSpinner.style.display = 'flex';
  }
  refreshLiveScreenshot();
  if (!liveScreenshotTimer) {
    liveScreenshotTimer = setInterval(refreshLiveScreenshot, 380); // Tốc độ siêu mượt 380ms/khung hình (~2.6 FPS)
  }
}

function closeQrModal() {
  qrModalOverlay.classList.add('hidden');
  if (liveScreenshotTimer) {
    clearInterval(liveScreenshotTimer);
    liveScreenshotTimer = null;
  }
}

btnCloseQrModal.addEventListener('click', closeQrModal);
qrModalOverlay.addEventListener('click', (e) => {
  if (e.target === qrModalOverlay) closeQrModal();
});

btnReloadZaloQr.addEventListener('click', async () => {
  btnReloadZaloQr.disabled = true;
  btnReloadZaloQr.textContent = '⏳ Đang tải lại...';
  try {
    const res = await fetch('/api/browser/reload', { method: 'POST' });
    const data = await res.json();
    if (data.imageBase64) {
      liveZaloImage.src = data.imageBase64;
    }
  } finally {
    btnReloadZaloQr.disabled = false;
    btnReloadZaloQr.textContent = '🔄 Tải lại / Lấy QR mới';
  }
});

liveZaloImage.addEventListener('click', async (e) => {
  const rect = liveZaloImage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const xRatio = (e.clientX - rect.left) / rect.width;
  const yRatio = (e.clientY - rect.top) / rect.height;
  try {
    const res = await fetch('/api/browser/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xRatio, yRatio })
    });
    const data = await res.json();
    if (data.imageBase64) {
      liveZaloImage.src = data.imageBase64;
    }
  } catch (err) {}
  // Làm mới khung hình phản hồi thao tác click sau 80ms
  setTimeout(refreshLiveScreenshot, 80);
});

if (btnOpenBrowser) {
  btnOpenBrowser.addEventListener('click', async () => {
    openQrModal(); // Mở ngay lập tức 0ms không chờ backend!
    try {
      const res = await fetch('/api/browser/open', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  });
}

if (btnCloseBrowser) {
  btnCloseBrowser.addEventListener('click', async () => {
    await fetch('/api/browser/close', { method: 'POST' });
  });
}

// ==================== PANEL 7: MASTER HUB & CROSS-WIFI IP SYNCHRONIZATION ====================

const btnTriggerSyncNow = document.getElementById('btnTriggerSyncNow');
const btnAddManualPeer = document.getElementById('btnAddManualPeer');
const txtManualPeerIp = document.getElementById('txtManualPeerIp');
const btnSyncLANHeader = document.getElementById('btnSyncLANHeader');
const lblSyncLocalHostname = document.getElementById('lblSyncLocalHostname');
const lblSyncPublicIp = document.getElementById('lblSyncPublicIp');
const lblSyncLocalIp = document.getElementById('lblSyncLocalIp');
const badgeLocalSyncStatus = document.getElementById('badgeLocalSyncStatus');
const selSyncNodeRole = document.getElementById('selSyncNodeRole');
const badgeMasterTargetHost = document.getElementById('badgeMasterTargetHost');
const lblPeersConnectedCount = document.getElementById('lblPeersConnectedCount');
const tblSyncPeersBody = document.getElementById('tblSyncPeersBody');

async function loadSyncInfo() {
  try {
    const res = await fetch('/api/sync/info');
    const data = await res.json();
    state.syncInfo = data;
    renderSyncUI(data);
    updatePanelBadges();
  } catch (err) {
    console.error('Lỗi tải thông tin đồng bộ P2P:', err);
  }
}

function renderSyncUI(info) {
  if (!info) return;
  if (lblSyncLocalHostname) lblSyncLocalHostname.textContent = info.hostname || '-';
  if (lblSyncPublicIp) lblSyncPublicIp.textContent = info.publicIp || info.masterIp || '-';
  if (lblSyncLocalIp) lblSyncLocalIp.textContent = `${info.localIp || info.localIP || '127.0.0.1'}:${info.port || 3000}`;

  const isMaster = !!info.isMasterHub;
  if (badgeLocalSyncStatus) {
    if (isMaster) {
      badgeLocalSyncStatus.className = 'badge bg-success-subtle text-success border border-success-subtle px-2 py-1 mt-1 d-inline-block';
      badgeLocalSyncStatus.innerHTML = '👑 TRẠM TRUNG CHUYỂN CHÍNH (Máy Chính)';
    } else {
      badgeLocalSyncStatus.className = 'badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 mt-1 d-inline-block';
      badgeLocalSyncStatus.innerHTML = '💻 MÁY TRẠM CON (Gửi về Máy Chính)';
    }
  }

  if (selSyncNodeRole) {
    selSyncNodeRole.value = info.role || (isMaster ? 'MASTER' : 'CLIENT');
  }

  if (badgeMasterTargetHost) {
    badgeMasterTargetHost.textContent = `Trạm Chính: ${info.masterHostname || 'LAPTOP-0SNHPCGD'}`;
  }

  if (txtManualPeerIp && document.activeElement !== txtManualPeerIp) {
    txtManualPeerIp.value = info.masterIp || '';
  }

  const peers = info.peers || [];
  if (lblPeersConnectedCount) lblPeersConnectedCount.textContent = `${peers.length} máy`;

  if (!tblSyncPeersBody) return;
  if (peers.length === 0) {
    tblSyncPeersBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-4 text-muted small">
          ${isMaster
            ? 'Đang đóng vai trò <strong>Trạm Trung Chuyển Chính</strong>. Khi các máy khác (cùng hoặc khác Wi-Fi) bấm <strong>"⚡ Đồng Bộ Ngay"</strong>, máy đó sẽ xuất hiện tại đây.'
            : `Máy này đã liên kết sẵn với Trạm Chính <strong>${escapeHtml(info.masterHostname || 'LAPTOP-0SNHPCGD')}</strong> (IP: <code>${escapeHtml(info.masterIp || '')}</code>). Hãy làm việc bình thường và bấm <strong>"⚡ Đồng Bộ Ngay"</strong> khi cần gộp dữ liệu với Máy Chính.`}
        </td>
      </tr>
    `;
    return;
  }

  tblSyncPeersBody.innerHTML = peers
    .map((p) => {
      const timeAgoSec = Math.max(0, Math.round((Date.now() - (p.lastSeen || Date.now())) / 1000));
      const timeStr = timeAgoSec < 10 ? 'Vừa xong' : timeAgoSec < 60 ? `${timeAgoSec}s trước` : `${Math.round(timeAgoSec / 60)} phút trước`;
      const roleBadge = p.isMaster
        ? '<span class="badge bg-warning-subtle text-dark border border-warning-subtle ms-1">👑 Máy Chính</span>'
        : '<span class="badge bg-light text-secondary border ms-1">Máy Con</span>';
      return `
        <tr>
          <td class="fw-semibold text-dark">
            <i class="bi bi-laptop me-1 text-primary"></i> ${escapeHtml(p.hostname || 'Máy trạm')} ${roleBadge}
          </td>
          <td>
            <code class="fw-bold text-primary">${escapeHtml(p.ip || '-')}:${escapeHtml(p.port || 3000)}</code>
          </td>
          <td>
            <span class="badge bg-success-subtle text-success border border-success-subtle">
              🟢 ${escapeHtml(p.transport || 'Đã đồng bộ')}
            </span>
          </td>
          <td class="small text-muted">${timeStr}</td>
          <td class="text-end">
            <button class="btn btn-outline-primary btn-sm py-0 px-2" onclick="syncWithSpecificPeer()">
              ⚡ Đồng bộ
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.syncWithSpecificPeer = async function () {
  if (btnTriggerSyncNow) {
    btnTriggerSyncNow.click();
  }
};

if (selSyncNodeRole) {
  selSyncNodeRole.addEventListener('change', async () => {
    const role = selSyncNodeRole.value;
    try {
      const res = await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (data.ok && data.info) {
        state.syncInfo = data.info;
        renderSyncUI(data.info);
        updatePanelBadges();
      }
    } catch (err) {
      alert(`Lỗi đổi vai trò máy: ${err.message}`);
    }
  });
}

if (btnTriggerSyncNow) {
  btnTriggerSyncNow.addEventListener('click', async () => {
    btnTriggerSyncNow.disabled = true;
    btnTriggerSyncNow.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Đang gửi & gộp bản đầy đủ...';
    try {
      const res = await fetch('/api/sync/trigger', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const sRes = await fetch('/api/state');
        const sData = await sRes.json();
        state.contacts = sData.contacts || [];
        state.settings = sData.settings || {};
        renderTable();
        renderReplies();
        updateOverviewChart(sData.status?.stats || {});
        updatePanelBadges();
        await loadSyncInfo();
        alert(data.message || `Đã hoàn tất đồng bộ! Tổng số dữ liệu sau khi sắp xếp: ${data.totalContacts || state.contacts.length} SĐT.`);
      } else {
        alert(data.error || data.message || 'Chưa kết nối được với Trạm Trung Chuyển Chính. Hãy đảm bảo Máy Chính đang mở Tool!');
      }
    } catch (err) {
      alert(`Lỗi khi đồng bộ: ${err.message}`);
    } finally {
      btnTriggerSyncNow.disabled = false;
      btnTriggerSyncNow.innerHTML = '<i class="bi bi-arrow-repeat"></i><span>⚡ Đồng Bộ Ngay</span>';
    }
  });
}

if (btnAddManualPeer) {
  btnAddManualPeer.addEventListener('click', async () => {
    const ip = (txtManualPeerIp ? txtManualPeerIp.value.trim() : '');
    if (!ip) {
      alert('Vui lòng nhập địa chỉ IP của Máy Chính (Trạm Trung Chuyển Chính).');
      return;
    }
    btnAddManualPeer.disabled = true;
    try {
      const res = await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterIp: ip })
      });
      const data = await res.json();
      if (data.ok) {
        if (data.info) {
          state.syncInfo = data.info;
          renderSyncUI(data.info);
          updatePanelBadges();
        }
        alert(`✅ Đã lưu và liên kết địa chỉ IP Trạm Trung Chuyển Chính: ${ip}\n\nBây giờ các máy có thể làm việc độc lập (dù khác mạng Wi-Fi). Khi cần gộp dữ liệu, chỉ cần bấm nút "⚡ Đồng Bộ Ngay"!`);
      } else {
        alert(data.error || 'Không thể lưu cấu hình IP Máy Chính.');
      }
    } catch (err) {
      alert(`Lỗi lưu IP: ${err.message}`);
    } finally {
      btnAddManualPeer.disabled = false;
    }
  });
}

if (btnSyncLANHeader) {
  btnSyncLANHeader.addEventListener('click', () => {
    switchPanel('sync');
  });
}

// ==================== BẮT ĐẦU / TẠM DỪNG GỬI ====================

btnStartCampaign.addEventListener('click', async () => {
  const settingsPayload = collectSettingsFromForm();
  await saveSettings(true);
  const res = await fetch('/api/campaign/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: state.activeAccountId,
      autoRotateAccounts: settingsPayload.autoRotateAccounts
    })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
  }
});

btnPauseCampaign.addEventListener('click', async () => {
  await fetch('/api/campaign/pause', { method: 'POST' });
});

// Run Init
initApp();
