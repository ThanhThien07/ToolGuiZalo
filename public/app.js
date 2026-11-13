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
    const idx = state.contacts.findIndex((c) => c.id === updated.id);
    if (idx !== -1) {
      state.contacts[idx] = updated;
    } else {
      state.contacts.push(updated);
    }
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

  if (chkAutoRotateAccounts) {
    chkAutoRotateAccounts.checked = s.autoRotateAccounts !== false;
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
  const isAutoRotate = chkAutoRotateAccounts ? chkAutoRotateAccounts.checked : true;

  return {
    template: txtTemplate.value,
    autoRotateAccounts: isAutoRotate,
    sendMode: isAutoRotate ? 'ROUND_ROBIN' : 'SINGLE_BURST',
    minDelaySec: Math.max(1, Number(numMinDelay.value) || 12),
    maxDelaySec: Math.max(1, Number(numMaxDelay.value) || 25),
    batchSize: Math.max(1, Number(numBatchSize.value) || 15),
    batchPauseSec: Math.max(3, Number(numBatchPause.value) || 120),
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

async function loadReplies() {
  try {
    const res = await fetch('/api/replies');
    const data = await res.json();
    if (data.ok) {
      state.replies = data.replies || [];
      renderReplies();
      updatePanelBadges();
    }
  } catch (err) {
    console.error('Lỗi tải danh sách phản hồi:', err);
  }
}

function renderReplies() {
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

  const allReplied = (state.contacts || []).filter((c) => c.hasReplied || c.replyText);
  if (badgeRepliesCount) {
    badgeRepliesCount.textContent = `${allReplied.length} rep`;
  }
  if (repliesCountHeaderBadge) {
    repliesCountHeaderBadge.textContent = `${allReplied.length} khách đã phản hồi`;
  }

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
      const replyTime = c.replyAt ? new Date(c.replyAt).toLocaleString('vi-VN') : 'Vừa xong';
      const sentTime = c.sentAt ? new Date(c.sentAt).toLocaleString('vi-VN') : '';

      return `
        <tr>
          <td class="text-muted small">${index + 1}</td>
          <td>
            <div class="fw-bold text-dark">${escapeHtml(c.name || c.zaloName || 'Khách hàng')}</div>
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
            <button class="btn btn-outline-primary btn-sm fw-semibold" onclick="openChatWithContact('${c.phone}', '${c.replyByAccountId || ''}')" title="Mở cuộc trò chuyện trên Zalo Web">
              <i class="bi bi-chat-dots-fill"></i> Mở chat
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

window.openChatWithContact = async function (phone, accountId) {
  try {
    const res = await fetch('/api/browser/open-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, accountId })
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
  const res = await fetch('/api/browser/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId })
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
  openQrModal();
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
      'panel-mode-replies'
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
  }
}

function updatePanelBadges() {
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
  if (badgeRepliesCount) {
    const repCount = (state.contacts || []).filter((c) => c.hasReplied || c.replyText).length;
    badgeRepliesCount.textContent = `${repCount} rep`;
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

async function refreshLiveScreenshot() {
  if (qrModalOverlay.classList.contains('hidden')) return;
  try {
    const res = await fetch('/api/browser/screenshot');
    const data = await res.json();
    if (data.ok && data.imageBase64) {
      liveZaloImage.src = data.imageBase64;
    }
  } catch {
    // ignore screenshot network hiccup
  }
}

function openQrModal() {
  qrModalOverlay.classList.remove('hidden');
  refreshLiveScreenshot();
  if (!liveScreenshotTimer) {
    liveScreenshotTimer = setInterval(refreshLiveScreenshot, 1100);
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
  const res = await fetch('/api/browser/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xRatio, yRatio })
  });
  const data = await res.json();
  if (data.imageBase64) {
    liveZaloImage.src = data.imageBase64;
  }
});

if (btnOpenBrowser) {
  btnOpenBrowser.addEventListener('click', async () => {
    btnOpenBrowser.disabled = true;
    try {
      const res = await fetch('/api/browser/open', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        openQrModal();
      }
    } catch (err) {
      alert(`Lỗi mở Zalo Web: ${err.message}`);
    } finally {
      btnOpenBrowser.disabled = false;
    }
  });
}

if (btnCloseBrowser) {
  btnCloseBrowser.addEventListener('click', async () => {
    await fetch('/api/browser/close', { method: 'POST' });
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
