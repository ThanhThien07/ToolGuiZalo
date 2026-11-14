const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { chromium } = require('playwright');
const storage = require('./storage');
const { renderMessage } = require('./templateEngine');
const taskEngine = require('./taskEngine');

const BASE_USER_DATA_DIR = path.join(__dirname, '..', 'user_data');
const VIEWPORT_SIZE = { width: 1280, height: 800 };

// Thứ tự ưu tiên khi gộp kết quả của nhiều tài khoản cho cùng 1 SĐT
const STATUS_PRIORITY = { THANH_CONG: 4, CHAN_NGUOI_LA: 3, KHONG_DANG_KY: 2, LOI: 1 };

const STATUS_LABELS = {
  THANH_CONG: 'Gửi thành công',
  CHAN_NGUOI_LA: 'Chặn người lạ',
  KHONG_DANG_KY: 'Chưa ĐK Zalo / Chặn tìm kiếm',
  LOI: 'Lỗi',
  SAI_SO: 'Sai định dạng SĐT'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripDiacritics(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

class ZaloBot extends EventEmitter {
  constructor() {
    super();
    /**
     * Nhiều phiên Zalo chạy ngầm cùng lúc:
     * accountId -> { accountId, context, page, browserState, watcher }
     */
    this.sessions = new Map();
    this.launching = new Map(); // accountId -> Promise (chống mở trùng 1 tài khoản)
    this.viewingAccountId = storage.getActiveAccount().id;

    this.campaignState = 'IDLE'; // 'IDLE' | 'RUNNING' | 'PAUSED' | 'SCHEDULED'
    this.campaign = null; // Thông tin lần chạy hiện tại (xem startCampaign)
    this.scheduleCountdownSec = 0;
    this._statusTimer = null;
    this._replyWatcher = null;
    this._isCheckingReplies = false;

    this.startScheduleWatcher();
    this.startReplyWatcher(1500);
    taskEngine.on('change', () => this.scheduleStatusBroadcast());
    // Tự động khôi phục chạy ngầm các tài khoản đã có thư mục lưu phiên đăng nhập
    setTimeout(() => {
      this.autoRestoreSavedSessions().catch(() => {});
    }, 1000);
  }

  async autoRestoreSavedSessions() {
    const accounts = storage.getAccounts();
    for (const acc of accounts) {
      const profilePath = this.getProfileDirForAccount(acc);
      if (fs.existsSync(profilePath)) {
        this.launchBrowser(acc.id, { makeActive: false }).catch(() => {});
      }
    }
  }

  // ===================== Trạng thái & log =====================

  getProfileDirForAccount(account) {
    return path.join(BASE_USER_DATA_DIR, account?.profileDir || 'zalo_profile');
  }

  getSession(accountId) {
    return this.sessions.get(accountId) || null;
  }

  isSessionAlive(sess) {
    return Boolean(sess && sess.page && !sess.page.isClosed());
  }

  getStatus() {
    const activeAcc = storage.getActiveAccount();
    const activeSess = this.getSession(activeAcc?.id);
    const workers = this.campaign ? [...this.campaign.workers.values()] : [];
    const workerByAcc = new Map(workers.map((w) => [w.accountId, w]));

    const accounts = storage.getAccounts().map((a) => {
      const s = this.sessions.get(a.id);
      const w = workerByAcc.get(a.id);
      return {
        ...a,
        status: s ? s.browserState : 'CLOSED',
        worker: w
          ? {
              state: w.state,
              processed: w.processed,
              success: w.success,
              currentPhone: w.currentPhone,
              countdownSec: w.countdownSec,
              note: w.note
            }
          : null
      };
    });

    const runningWorkers = workers.filter((w) => ['RUNNING', 'RESTING', 'WAITING_HOURS'].includes(w.state));

    return {
      browserState: activeSess ? activeSess.browserState : 'CLOSED',
      campaignState: this.campaignState,
      activeAccountId: activeAcc ? activeAcc.id : 'acc_default',
      activeAccountName: activeAcc ? activeAcc.name : 'Tài khoản mặc định',
      viewingAccountId: this.viewingAccountId,
      readyAccountsCount: accounts.filter((a) => a.status === 'READY').length,
      activeWorkers: runningWorkers.length,
      orchestrator: taskEngine.getSummary(),
      campaign: this.campaign
        ? {
            accountMode: this.campaign.accountMode,
            distribution: this.campaign.distribution,
            speedMode: this.campaign.speedMode,
            accountNames: this.campaign.participants.map((p) => p.name)
          }
        : null,
      accounts,
      // Đồng hồ nghỉ hiển thị ở banner = lâu nhất trong các luồng đang nghỉ
      countdownSec: runningWorkers.reduce((m, w) => Math.max(m, w.countdownSec || 0), 0),
      scheduleCountdownSec: this.scheduleCountdownSec,
      currentUrl: this.isSessionAlive(activeSess) ? activeSess.page.url() : '',
      stats: storage.getStats()
    };
  }

  broadcastStatus() {
    this.emit('status', this.getStatus());
  }

  /**
   * Gộp nhiều lần cập nhật trạng thái liên tiếp (nhiều luồng đếm ngược cùng lúc) thành 1 lần gửi
   */
  scheduleStatusBroadcast() {
    if (this._statusTimer) return;
    this._statusTimer = setTimeout(() => {
      this._statusTimer = null;
      this.broadcastStatus();
    }, 250);
  }

  log(level, message, meta = {}) {
    const entry = storage.addLog(level, message, meta);
    this.emit('log', entry);
    this.broadcastStatus();
  }

  emitContact(contact) {
    if (contact) this.emit('contact_updated', contact);
  }

  // ===================== Lịch hẹn & khung giờ =====================

  startScheduleWatcher() {
    if (this._scheduleTimer) clearInterval(this._scheduleTimer);
    this._scheduleTimer = setInterval(async () => {
      const settings = storage.getSettings();
      if (!settings.scheduleEnabled || !settings.scheduleStartAt) {
        if (this.scheduleCountdownSec !== 0 || this.campaignState === 'SCHEDULED') {
          this.scheduleCountdownSec = 0;
          if (this.campaignState === 'SCHEDULED') this.campaignState = 'IDLE';
          this.broadcastStatus();
        }
        return;
      }

      const targetMs = new Date(settings.scheduleStartAt).getTime();
      if (Number.isNaN(targetMs)) return;

      const diffSec = Math.max(0, Math.round((targetMs - Date.now()) / 1000));
      this.scheduleCountdownSec = diffSec;

      if (diffSec > 0) {
        if (this.campaignState === 'IDLE') this.campaignState = 'SCHEDULED';
        this.broadcastStatus();
        return;
      }

      storage.updateSettings({ scheduleEnabled: false });
      this.scheduleCountdownSec = 0;
      if (this.campaignState === 'SCHEDULED') this.campaignState = 'IDLE';

      if (this.campaignState !== 'RUNNING') {
        this.log('info', '⏰ Đã tới giờ hẹn! Hệ thống tự động bắt đầu gửi tin...');
        try {
          await this.startCampaign();
        } catch (err) {
          this.log('error', `Không thể tự chạy theo lịch hẹn: ${err.message}`);
          this.broadcastStatus();
        }
      }
    }, 1500);
  }

  isWithinActiveHours(settings) {
    if (!settings.activeHoursEnabled) return true;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const parseHm = (str, def) => {
      const [h, m] = String(str || def).split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const start = parseHm(settings.activeHourStart, '08:00');
    const end = parseHm(settings.activeHourEnd, '21:30');
    return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
  }

  // ===================== Quản lý phiên trình duyệt =====================

  /**
   * Mở phiên chạy ngầm cho 1 tài khoản. KHÔNG đóng các tài khoản khác.
   * @param {string} targetAccountId
   * @param {{ makeActive?: boolean, setViewing?: boolean }} options
   */
  async launchBrowser(targetAccountId, { makeActive = false, setViewing = true } = {}) {
    const account = storage.getAccount(targetAccountId) || storage.getActiveAccount();

    if (makeActive) {
      storage.setActiveAccount(account.id);
    }
    if (setViewing || makeActive) {
      this.viewingAccountId = account.id;
    }

    const existing = this.sessions.get(account.id);
    if (this.isSessionAlive(existing)) {
      await this.checkAccountLoginStatus(account.id);
      return this.getStatus();
    }

    // Nếu tài khoản này đang được mở bởi 1 yêu cầu khác -> chờ yêu cầu đó, không mở thêm
    if (this.launching.has(account.id)) {
      await this.launching.get(account.id);
      return this.getStatus();
    }

    const launchPromise = this._doLaunch(account).finally(() => {
      this.launching.delete(account.id);
    });
    this.launching.set(account.id, launchPromise);
    await launchPromise;
    return this.getStatus();
  }

  async _doLaunch(account) {
    const sessionObj = {
      accountId: account.id,
      context: null,
      page: null,
      browserState: 'OPENING',
      watcher: null
    };
    this.sessions.set(account.id, sessionObj);
    this.broadcastStatus();
    this.log('info', `Đang mở phiên chạy ngầm cho "${account.name}"...`);

    const profilePath = this.getProfileDirForAccount(account);
    if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });

    const baseOptions = {
      headless: true,
      viewport: VIEWPORT_SIZE,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--window-size=1280,840',
        '--disable-dev-shm-usage',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-ipc-flooding-protection'
      ]
    };

    let context = null;
    let lastErr = null;
    for (const channel of ['chrome', 'msedge', undefined]) {
      try {
        context = await chromium.launchPersistentContext(
          profilePath,
          channel ? { ...baseOptions, channel } : baseOptions
        );
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!context) {
      this.sessions.delete(account.id);
      this.broadcastStatus();
      const hint =
        lastErr && /user data directory is already in use|ProcessSingleton/i.test(lastErr.message)
          ? ' (Thư mục phiên đang bị 1 cửa sổ Chrome khác dùng – hãy tắt cửa sổ đó)'
          : '';
      throw new Error(`Không mở được "${account.name}": ${lastErr ? lastErr.message : 'Unknown'}${hint}`);
    }

    sessionObj.context = context;
    const pages = context.pages();
    sessionObj.page = pages.length > 0 ? pages[0] : await context.newPage();
    await sessionObj.page.setViewportSize(VIEWPORT_SIZE).catch(() => {});

    context.on('close', () => {
      if (sessionObj.watcher) clearInterval(sessionObj.watcher);
      if (this.sessions.get(account.id) === sessionObj) this.sessions.delete(account.id);
      storage.updateAccount(account.id, { status: 'CLOSED' });
      this.broadcastStatus();
    });

    await sessionObj.page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Chờ Zalo hiển thị xong (giao diện chat hoặc màn hình QR) rồi mới kết luận trạng thái đăng nhập
    await sessionObj.page
      .waitForFunction(
        () => {
          if (location.hostname.includes('id.zalo.me')) return true;
          if (
            document.querySelector(
              '#contact-search-input, input[data-id="txt_Main_Search"], #main-tab, .nav__tabs__zalo, #conversationListId'
            )
          ) {
            return true;
          }
          const t = document.body ? document.body.innerText : '';
          return /mã QR|Đăng nhập|QR code/i.test(t);
        },
        null,
        { timeout: 12000 }
      )
      .catch(() => {});

    await this.checkAccountLoginStatus(account.id);

    sessionObj.watcher = setInterval(async () => {
      if (!this.isSessionAlive(sessionObj)) {
        clearInterval(sessionObj.watcher);
        return;
      }
      await this.checkAccountLoginStatus(account.id);
    }, 2500);
  }

  async launchAllAccounts() {
    const accounts = storage.getAccounts();
    const results = await Promise.allSettled(
      accounts.map((acc) => this.launchBrowser(acc.id, { makeActive: false }))
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') this.log('warning', r.reason?.message || `Không mở được "${accounts[i].name}"`);
    });
    return this.getStatus();
  }

  async switchAccount(accountId) {
    const target = storage.setActiveAccount(accountId);
    if (!target) throw new Error('Không tìm thấy tài khoản Zalo.');
    this.viewingAccountId = target.id;
    await this.launchBrowser(target.id, { makeActive: true });
    return this.getStatus();
  }

  async checkAccountLoginStatus(accountId) {
    const id = accountId || storage.getActiveAccount().id;
    const sess = this.sessions.get(id);
    const acc = storage.getAccount(id);

    if (!this.isSessionAlive(sess)) {
      if (acc) storage.updateAccount(id, { status: 'CLOSED' });
      return false;
    }

    try {
      const info = await sess.page.evaluate(() => {
        if (location.hostname.includes('id.zalo.me')) return { isLoggedIn: false, profileName: '' };
        const main =
          document.querySelector('#contact-search-input') ||
          document.querySelector('input[data-id="txt_Main_Search"]') ||
          document.querySelector('#main-tab') ||
          document.querySelector('.nav__tabs__zalo') ||
          document.querySelector('#conversationListId') ||
          document.querySelector('[data-id="div_Main_TabMsg"]');
        const avatarImg = document.querySelector('#main-tab .zavatar img, .nav__tabs__zalo img');
        return {
          isLoggedIn: Boolean(main),
          profileName: avatarImg ? avatarImg.getAttribute('alt') || '' : ''
        };
      });

      const prev = sess.browserState;
      sess.browserState = info.isLoggedIn ? 'READY' : 'WAITING_LOGIN';
      if (acc) {
        storage.updateAccount(id, {
          status: sess.browserState,
          ...(info.profileName ? { zaloProfileName: info.profileName } : {})
        });
      }

      if (prev !== sess.browserState) {
        if (info.isLoggedIn) {
          this.log('success', `✅ "${acc?.name || 'Zalo'}" đã đăng nhập (đang chạy ngầm, sẵn sàng gửi).`);
        } else {
          this.log('info', `📱 "${acc?.name || 'Zalo'}" chưa đăng nhập – cần quét mã QR.`);
        }
      }
      return info.isLoggedIn;
    } catch {
      return sess.browserState === 'READY';
    }
  }

  /**
   * Đảm bảo tài khoản đã mở & đăng nhập. Chờ tối đa timeoutMs để Zalo tải xong.
   */
  async ensureAccountReady(accountId, timeoutMs = 15000) {
    try {
      await this.launchBrowser(accountId, { makeActive: false });
    } catch (err) {
      return { ok: false, reason: err.message };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.checkAccountLoginStatus(accountId)) return { ok: true };
      const sess = this.sessions.get(accountId);
      if (!this.isSessionAlive(sess)) return { ok: false, reason: 'Phiên trình duyệt đã đóng' };
      await sleep(800);
    }
    return { ok: false, reason: 'Chưa đăng nhập (cần quét mã QR)' };
  }

  async getLiveScreenshot(accountId) {
    const id = accountId || this.viewingAccountId || storage.getActiveAccount().id;
    const sess = this.sessions.get(id);
    if (!this.isSessionAlive(sess)) return null;

    // Cache micro-frame (120ms) để khi poll nhanh không bị nghẽn CPU
    const now = Date.now();
    if (this._lastShot && this._lastShot.accountId === id && now - this._lastShot.time < 120) {
      return this._lastShot.data;
    }

    try {
      // Chụp siêu tốc với quality 55 và timeout ngắn 2000ms
      const buffer = await sess.page.screenshot({
        type: 'jpeg',
        quality: 55,
        timeout: 2000
      });
      const data = {
        accountId: id,
        imageBase64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        url: sess.page.url(),
        browserState: sess.browserState,
        width: VIEWPORT_SIZE.width,
        height: VIEWPORT_SIZE.height
      };
      this._lastShot = { accountId: id, time: now, data };
      return data;
    } catch {
      return null;
    }
  }

  async clickOnPage(xRatio, yRatio, accountId) {
    const id = accountId || this.viewingAccountId || storage.getActiveAccount().id;
    const sess = this.sessions.get(id);
    if (!this.isSessionAlive(sess)) return false;
    const x = Math.round(Math.max(0, Math.min(1, Number(xRatio))) * VIEWPORT_SIZE.width);
    const y = Math.round(Math.max(0, Math.min(1, Number(yRatio))) * VIEWPORT_SIZE.height);
    await sess.page.mouse.click(x, y);
    this._lastShot = null; // Xóa cache frame cũ để frame mới nhất cập nhật ngay
    return true;
  }

  async reloadZaloPage(accountId) {
    const id = accountId || this.viewingAccountId || storage.getActiveAccount().id;
    const sess = this.sessions.get(id);
    if (!this.isSessionAlive(sess)) return false;
    await sess.page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.checkAccountLoginStatus(id);
    return true;
  }

  async closeBrowser(accountId) {
    const id = accountId || storage.getActiveAccount().id;
    const sess = this.sessions.get(id);
    if (sess) {
      if (sess.watcher) clearInterval(sess.watcher);
      this.sessions.delete(id);
      if (sess.context) await sess.context.close().catch(() => {});
    }
    storage.updateAccount(id, { status: 'CLOSED' });
    this.broadcastStatus();
  }

  async closeAllBrowsers() {
    this.pauseCampaign();
    for (const id of [...this.sessions.keys()]) {
      await this.closeBrowser(id);
    }
  }

  isAccountBusy(accountId) {
    if (!this.campaign || this.campaignState !== 'RUNNING') return false;
    const w = this.campaign.workers.get(accountId);
    return Boolean(w && ['RUNNING', 'RESTING', 'WAITING_HOURS'].includes(w.state));
  }

  // ===================== Hàng chờ & ghi nhận kết quả =====================

  /**
   * Lấy SĐT tiếp theo cho 1 luồng (đồng bộ -> nhiều luồng chạy song song không bao giờ lấy trùng):
   * - MULTI_SPLIT: Chia đều SĐT theo chỉ số luồng (idx % totalWorkers === workerIndex) để ngay cả khi chỉ có 2 SĐT
   *   và 2 tài khoản, TK1 lấy ngay SĐT #1 và TK2 lấy ngay SĐT #2 chạy song song CÙNG LÚC (không bao giờ dồn hết cho TK xếp trước).
   * - MULTI_BROADCAST: Xoay vòng điểm bắt đầu (startIdx = workerIndex % N) và ưu tiên SĐT chưa có luồng nào đang giữ,
   *   giúp TK1 bắn SĐT #1 trong khi TK2 bắn SĐT #2 cùng lúc, sau đó đổi chéo.
   * - SINGLE: Lấy tuần tự từ trên xuống.
   */
  claimNextContact(campaign, worker) {
    const accId = worker.accountId;
    const validContacts = storage.getContacts().filter((c) => c.status !== 'SAI_SO');
    if (validContacts.length === 0) return null;

    const picked = validContacts.find(
      (c) =>
        c.status === 'PENDING' &&
        !this.hasInFlight(campaign, c.id)
    );

    if (!picked) return null;

    campaign.inFlight.add(`${picked.id}|${accId}`);
    const updated = storage.updateContact(picked.id, {
      status: 'PROCESSING',
      reason: `Đang xử lý bởi ${worker.accountName}...`
    });
    this.emitContact(updated);
    return updated;
  }

  describeInFlight(campaign, contactId) {
    const names = [];
    for (const key of campaign.inFlight) {
      const [cid, accId] = key.split('|');
      if (cid === contactId) {
        const p = campaign.participants.find((x) => x.id === accId);
        if (p) names.push(p.name);
      }
    }
    return names.join(', ') || 'Zalo';
  }

  hasInFlight(campaign, contactId) {
    for (const key of campaign.inFlight) {
      if (key.startsWith(`${contactId}|`)) return true;
    }
    return false;
  }

  /**
   * Gộp kết quả của các tài khoản thành trạng thái cuối cho 1 SĐT
   */
  buildAggregate(contact) {
    const entries = Object.entries(contact.results || {});
    if (!entries.length) return null;

    let best = entries[0][1];
    for (const [, r] of entries) {
      if ((STATUS_PRIORITY[r.status] || 0) > (STATUS_PRIORITY[best.status] || 0)) best = r;
    }
    const successNames = entries.filter(([, r]) => r.status === 'THANH_CONG').map(([, r]) => r.accountName);
    const summary =
      entries.length === 1
        ? `[${best.accountName}] ${best.reason}`
        : entries.map(([, r]) => `${r.accountName}: ${STATUS_LABELS[r.status] || r.status}`).join(' • ');

    return {
      status: best.status,
      zaloName: best.zaloName || contact.zaloName || '',
      sentByAccount: successNames.length ? successNames.join(', ') : best.accountName,
      sentMessage: best.sentMessage || '',
      reason: summary
    };
  }

  /**
   * Ghi nhận kết quả của 1 tài khoản cho 1 SĐT rồi cập nhật trạng thái chung
   */
  recordResult(campaign, worker, contactId, result) {
    const contact = storage.getContact(contactId);
    campaign.inFlight.delete(`${contactId}|${worker.accountId}`);
    if (!contact) return null;

    const entry = {
      accountName: worker.accountName,
      accountId: worker.accountId,
      status: result.status,
      reason: result.reason || '',
      zaloName: result.zaloName || '',
      sentMessage: result.sentMessage || '',
      at: new Date().toISOString()
    };
    const results = { ...(contact.results || {}), [worker.accountId]: entry };
    contact.results = results;

    let patch;
    const allDone =
      campaign.distribution !== 'BROADCAST' || campaign.participants.every((p) => results[p.id]);

    if (allDone) {
      patch = this.buildAggregate(contact);
    } else {
      const doneNames = Object.values(results).map((r) => `${r.accountName}: ${STATUS_LABELS[r.status] || r.status}`);
      patch = {
        status: this.hasInFlight(campaign, contactId) ? 'PROCESSING' : 'PENDING',
        zaloName: entry.zaloName || contact.zaloName || '',
        reason: `Đã xử lý ${Object.keys(results).length}/${campaign.participants.length} tài khoản (${doneNames.join(' • ')})`
      };
    }

    if (result.status === 'THANH_CONG') {
      patch.sentByAccount = worker.accountName;
      patch.sentByAccountId = worker.accountId;
      patch.sentAt = entry.at;
    }

    const updated = storage.updateContact(contactId, { results, ...patch });
    this.emitContact(updated);

    // Đồng bộ vào Task Engine
    const task = taskEngine.queue.find((t) => t.contactId === contactId);
    if (task) {
      if (result.status === 'THANH_CONG') {
        taskEngine.completeTask(task.id, result);
      } else {
        taskEngine.failTask(task.id, result.reason || result.status, false);
      }
    }
    return updated;
  }

  /**
   * Trả 1 SĐT về hàng chờ khi tài khoản không xử lý được (chạm giới hạn, mất phiên...)
   */
  releaseContact(campaign, worker, contactId, reason) {
    campaign.inFlight.delete(`${contactId}|${worker.accountId}`);
    taskEngine.reclaimWorkerTasks(worker.accountId, reason);
    const contact = storage.getContact(contactId);
    if (!contact) return;
    const updated = storage.updateContact(contactId, {
      status: this.hasInFlight(campaign, contactId) ? 'PROCESSING' : 'PENDING',
      reason: `[${worker.accountName}] ${reason} – chờ gửi lại`
    });
    this.emitContact(updated);
  }

  /**
   * Chốt các SĐT đang chờ mà mọi tài khoản tham gia đều đã xử lý rồi (từ lần chạy trước)
   */
  finalizeSatisfiedContacts(participantIds) {
    for (const c of storage.getContacts()) {
      if (c.status !== 'PENDING' || !c.results) continue;
      const keys = Object.keys(c.results);
      if (keys.length && participantIds.every((id) => c.results[id])) {
        this.emitContact(storage.updateContact(c.id, this.buildAggregate(c)));
      }
    }
  }

  // ===================== Quản lý phản hồi từ khách hàng =====================

  startReplyWatcher(intervalMs = 1500) {
    if (this._replyWatcher) return;
    this._replyWatcher = setInterval(async () => {
      if (this._isCheckingReplies) return;
      try {
        await this.checkReplies();
      } catch (err) {
        // ngầm không log ồn ào
      }
    }, intervalMs);
  }

  stopReplyWatcher() {
    if (this._replyWatcher) {
      clearInterval(this._replyWatcher);
      this._replyWatcher = null;
    }
  }

  /**
   * Quét kiểm tra phản hồi từ khách trên các tài khoản Zalo Web (Realtime & Sắp xếp mới nhất lên đầu)
   */
  async checkReplies(targetAccountId = null) {
    if (this._isCheckingReplies) {
      return { ok: true, foundCount: 0, replies: storage.getRepliedContactsSorted() };
    }
    this._isCheckingReplies = true;

    try {
      const allAccounts = storage.getAccounts();
      const accountsToCheck = allAccounts.filter((a) => {
        if (targetAccountId && a.id !== targetAccountId) return false;
        const sess = this.sessions.get(a.id);
        return this.isSessionAlive(sess) && sess.browserState === 'READY';
      });

      let foundRepliesCount = 0;
      const newReplies = [];

      const IGNORED_NAMES = [
        'my documents',
        'zalo',
        'thoi tiet',
        'bao moi',
        'zalo pay',
        'zalopay',
        'cloud cua toi',
        'tin nhan tu nguoi la',
        'zstyle',
        'zbusiness'
      ];

      for (const acc of accountsToCheck) {
        const sess = this.sessions.get(acc.id);
        if (!this.isSessionAlive(sess)) continue;

        try {
          const chats = await sess.page.evaluate(() => {
            const items = Array.from(
              document.querySelectorAll('.conv-item.conv-rel, [data-id^="conv-item-"]')
            );
            return items.map((el, idx) => {
              const titleEl = el.querySelector(
                '.conv-item-title__name, .conv-item-title, [class*="title__name"]'
              );
              const bodyEl = el.querySelector(
                '.conv-item-body__main, .conv-message, [class*="body__main"]'
              );
              const badgeEl = el.querySelector(
                '.unread-badge, .v2-badge, [class*="badge"], [class*="unread"]'
              );
              const rawName = titleEl ? titleEl.innerText : '';
              const rawBody = bodyEl ? bodyEl.innerText : '';
              const name = rawName.replace(/\u00A0/g, ' ').trim();
              const snippet = rawBody.replace(/\u00A0/g, ' ').trim();
              const hasUnread = !!badgeEl && badgeEl.offsetParent !== null;
              const isFromMe = /^bạn\s*:/i.test(snippet) || /^you\s*:/i.test(snippet);
              return { name, snippet, isFromMe, hasUnread, sidebarRank: idx };
            });
          });

          // Đọc luôn cuộc hội thoại đang mở trực tiếp (nếu có tin nhắn từ khách hàng)
          const openChatData = await sess.page
            .evaluate(() => {
              const headerEl =
                document.querySelector('header .header-title') ||
                document.querySelector('[data-id="div_Main_Header"] .truncate') ||
                document.querySelector('.thread-chat-title');
              if (!headerEl) return null;
              const openName = (headerEl.innerText || '').replace(/\u00A0/g, ' ').trim();
              if (!openName) return null;

              const msgs = Array.from(
                document.querySelectorAll(
                  '.chat-message, .msg-view, [data-id^="msg-"], .bubble-item'
                )
              );
              if (msgs.length === 0) return null;

              // Lọc các tin nhắn gửi từ phía đối phương (không phải từ mình)
              const customerMsgs = msgs.filter((el) => {
                const isMe =
                  el.classList.contains('me') ||
                  el.querySelector('.me') !== null ||
                  el.getAttribute('data-is-me') === 'true';
                return !isMe;
              });

              if (customerMsgs.length === 0) return null;
              const lastCustMsg = customerMsgs[customerMsgs.length - 1];
              let text = (lastCustMsg.innerText || '')
                .replace(/\u00A0/g, ' ')
                .replace(/\n?\b\d{1,2}:\d{2}\b(\s*(AM|PM|SA|CH))?\s*$/i, '')
                .trim();
              if (!text) {
                const hasMedia = lastCustMsg.querySelector(
                  'img, canvas, [class*="sticker"], [class*="photo"], [class*="image"]'
                );
                if (hasMedia) text = 'Sticker';
              }
              return {
                name: openName,
                snippet: text,
                isFromMe: false,
                hasUnread: false,
                customerMsgCount: customerMsgs.length
              };
            })
            .catch(() => null);

          // Gom nhóm theo tên khách hàng trên từng tài khoản để tránh trùng lặp giữa sidebar và cửa sổ chat đang mở
          const chatMap = new Map();
          for (const chat of chats) {
            if (!chat.name || !chat.snippet) continue;
            if (chat.isFromMe) continue;
            const normName = chat.name.toLowerCase().trim();
            const cleanName = stripDiacritics(normName);
            if (!cleanName) continue;
            if (!chatMap.has(cleanName)) {
              chatMap.set(cleanName, {
                name: chat.name,
                normChatName: normName,
                cleanChatName: cleanName,
                primarySnippet: chat.snippet,
                sidebarSnippet: chat.snippet,
                hasUnread: Boolean(chat.hasUnread),
                sidebarRank: typeof chat.sidebarRank === 'number' ? chat.sidebarRank : 999,
                customerMsgCount: 0,
                allSnippets: [chat.snippet]
              });
            } else {
              chatMap.get(cleanName).allSnippets.push(chat.snippet);
            }
          }

          if (openChatData && openChatData.name && openChatData.snippet && !openChatData.isFromMe) {
            const normOpen = openChatData.name.toLowerCase().trim();
            const cleanOpen = stripDiacritics(normOpen);
            if (cleanOpen) {
              if (chatMap.has(cleanOpen)) {
                const entry = chatMap.get(cleanOpen);
                entry.allSnippets.push(openChatData.snippet);
                entry.customerMsgCount = openChatData.customerMsgCount || 0;
              } else {
                chatMap.set(cleanOpen, {
                  name: openChatData.name,
                  normChatName: normOpen,
                  cleanChatName: cleanOpen,
                  primarySnippet: openChatData.snippet,
                  sidebarSnippet: '',
                  hasUnread: false,
                  sidebarRank: 0,
                  customerMsgCount: openChatData.customerMsgCount || 0,
                  allSnippets: [openChatData.snippet]
                });
              }
            }
          }

          for (const chatEntry of chatMap.values()) {
            const {
              name: chatName,
              normChatName,
              cleanChatName,
              primarySnippet,
              sidebarSnippet,
              hasUnread,
              sidebarRank,
              customerMsgCount
            } = chatEntry;
            const allSnippets = Array.from(new Set(chatEntry.allSnippets.filter(Boolean)));
            if (!chatName || !primarySnippet) continue;
            if (primarySnippet.toLowerCase() === 'chưa có tin nhắn') continue;

            if (
              IGNORED_NAMES.some((ig) => cleanChatName.includes(ig)) ||
              primarySnippet.includes('Đăng nhập Zalo trên máy tính') ||
              primarySnippet.includes('[Không có tin nhắn gần đây]') ||
              primarySnippet.includes('[Tin nhắn đang đồng bộ]') ||
              primarySnippet.includes('Chưa có trong danh bạ') ||
              primarySnippet.toLowerCase() === 'chưa có tin nhắn'
            ) {
              continue;
            }

            // Ưu tiên tìm contact có SĐT thật trước, sau đó mới tới contact "Từ Zalo Web"
            const currentAllContacts = storage.getContacts().slice().sort((a, b) => {
              const aZw = !a.phone || a.phone === 'Từ Zalo Web' ? 1 : 0;
              const bZw = !b.phone || b.phone === 'Từ Zalo Web' ? 1 : 0;
              return aZw - bZw;
            });

            const matched = currentAllContacts.find((c) => {
              const normZaloName = (c.zaloName || '').toLowerCase().trim();
              const normContactName = (c.name || '').toLowerCase().trim();
              const cleanZaloName = stripDiacritics(normZaloName);
              const cleanContactName = stripDiacritics(normContactName);

              return (
                (normZaloName && normZaloName === normChatName) ||
                (normContactName && normContactName === normChatName) ||
                (cleanZaloName && cleanZaloName === cleanChatName) ||
                (cleanContactName && cleanContactName === cleanChatName) ||
                (c.phone && c.phone !== 'Từ Zalo Web' && normChatName.includes(c.phone))
              );
            });

            if (matched) {
              // Kiểm tra xem tin nhắn có phải nội dung ta đã gửi đi không
              const sentSnippet = (matched.sentMessage || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 30);
              if (sentSnippet && primarySnippet.includes(sentSnippet)) {
                continue;
              }

              const knownSnippets = Array.isArray(matched.knownReplySnippets)
                ? matched.knownReplySnippets
                : matched.replyText
                ? [matched.replyText]
                : [];
              const isSameStartupState =
                matched.hasReplied &&
                knownSnippets.length === 1 &&
                allSnippets.includes(knownSnippets[0]);

              // Phát hiện tin nhắn mới theo thời gian thực (kể cả khi khách gửi lại nội dung cũ hoặc Sticker mới):
              const hasSidebarChanged = Boolean(
                sidebarSnippet &&
                  matched.lastSidebarSnippet &&
                  sidebarSnippet !== matched.lastSidebarSnippet
              );
              const hasOpenCountIncreased = Boolean(
                customerMsgCount > 0 &&
                  matched.lastCustomerMsgCount > 0 &&
                  customerMsgCount > matched.lastCustomerMsgCount
              );
              const hasNewUnread = Boolean(hasUnread && matched.lastUnreadState === false);

              const isBrandNewSnippet =
                !matched.hasReplied ||
                (!isSameStartupState &&
                  primarySnippet !== matched.replyText &&
                  !knownSnippets.includes(primarySnippet)) ||
                hasSidebarChanged ||
                hasOpenCountIncreased ||
                hasNewUnread;

              const mergedSnippets = Array.from(new Set([...knownSnippets, ...allSnippets]));

              if (!isBrandNewSnippet) {
                // Cập nhật baseline theo dõi ngầm để lần quét kế tiếp (1.5s sau) bắt nhạy mọi thay đổi mới
                matched.lastSidebarSnippet = sidebarSnippet || matched.lastSidebarSnippet || matched.replyText;
                if (customerMsgCount > 0) matched.lastCustomerMsgCount = customerMsgCount;
                matched.lastUnreadState = Boolean(hasUnread);
                matched.sidebarRank = sidebarRank;
                if (mergedSnippets.length > knownSnippets.length) {
                  storage.updateContact(matched.id, {
                    knownReplySnippets: mergedSnippets,
                    sidebarRank
                  });
                }
                continue;
              }

              // Chỉ thông báo 1 lần duy nhất; chỉ thông báo lại nếu người dùng đã xem (replySeen = true) và có tin nhắn mới
              const shouldNotify =
                !matched.hasReplied || !matched.replyNotified || matched.replySeen === true;

              const updated = storage.updateContact(matched.id, {
                hasReplied: true,
                replyText: primarySnippet,
                replyAt: new Date(Date.now() - (sidebarRank || 0) * 5).toISOString(),
                replyByAccount: acc.name,
                replyByAccountId: acc.id,
                knownReplySnippets: mergedSnippets,
                replyNotified: true,
                replySeen: shouldNotify ? false : Boolean(matched.replySeen),
                sidebarRank: 0,
                lastSidebarSnippet: sidebarSnippet || primarySnippet,
                lastCustomerMsgCount: customerMsgCount || matched.lastCustomerMsgCount || 0,
                lastUnreadState: Boolean(hasUnread)
              });
              foundRepliesCount++;
              newReplies.push({
                contact: updated,
                replyText: primarySnippet,
                accountName: acc.name
              });
              this.emitContact(updated);
              if (shouldNotify) {
                this.emit('reply_received', {
                  contact: updated,
                  replyText: primarySnippet,
                  accountName: acc.name,
                  replyAt: updated.replyAt
                });
                this.log(
                  'success',
                  `🎉 Phản hồi mới từ "${chatName}" trên [${acc.name}]: "${primarySnippet}"`
                );
              }
            } else {
              // Tự động tạo một liên hệ trong danh bạ để khách hàng hiển thị ngay trên bảng (giữ đúng thứ tự trên xuống của Zalo Web)
              const autoCreated = storage.addContact({
                name: chatName,
                zaloName: chatName,
                phone: 'Từ Zalo Web',
                status: 'THANH_CONG',
                sentMessage: '(Đã gửi trên Zalo Web)',
                hasReplied: true,
                replyText: primarySnippet,
                replyAt: new Date(Date.now() - (sidebarRank || 0) * 1000).toISOString(),
                replyByAccount: acc.name,
                replyByAccountId: acc.id,
                replyNotified: true,
                replySeen: false,
                knownReplySnippets: allSnippets,
                sidebarRank: sidebarRank || 0,
                lastSidebarSnippet: sidebarSnippet || primarySnippet,
                lastCustomerMsgCount: customerMsgCount || 0,
                lastUnreadState: Boolean(hasUnread),
                note: 'Khách phản hồi trực tiếp trên Zalo Web'
              });
              foundRepliesCount++;
              newReplies.push({
                contact: autoCreated,
                replyText: primarySnippet,
                accountName: acc.name
              });
              this.emitContact(autoCreated);
              this.emit('reply_received', {
                contact: autoCreated,
                replyText: primarySnippet,
                accountName: acc.name,
                replyAt: autoCreated.replyAt
              });
              this.log(
                'success',
                `🎉 Khách hàng "${chatName}" vừa nhắn lại trên [${acc.name}]: "${primarySnippet}"`
              );
            }
          }
        } catch (err) {
          // Bỏ qua lỗi tạm thời khi trang đang refresh
        }
      }

      const sortedReplies = storage.getRepliedContactsSorted();
      if (newReplies.length > 0) {
        this.emit('replies_updated', sortedReplies);
      }

      return {
        ok: true,
        foundCount: foundRepliesCount,
        replies: sortedReplies
      };
    } finally {
      this._isCheckingReplies = false;
    }
  }

  /**
   * Đặt lại trạng thái phản hồi cho toàn bộ danh sách
   */
  resetReplies() {
    for (const c of storage.getContacts()) {
      const prevSnippets = Array.isArray(c.knownReplySnippets)
        ? c.knownReplySnippets
        : c.replyText
        ? [c.replyText]
        : [];
      c.hasReplied = false;
      c.replyNotified = false;
      c.replySeen = true;
      c.knownReplySnippets = prevSnippets;
      delete c.replyText;
      delete c.replyAt;
      delete c.replyByAccount;
      delete c.replyByAccountId;
    }
    storage.save();
    return true;
  }

  /**
   * Đánh dấu đã xem phản hồi (để chỉ thông báo lại khi khách nhắn tin mới sau khi đã xem)
   */
  markRepliesSeen(contactId = null) {
    let changed = false;
    for (const c of storage.getContacts()) {
      if (contactId && c.id !== contactId && c.phone !== contactId && c.name !== contactId) {
        continue;
      }
      if (c.hasReplied || c.replyText) {
        if (!c.replySeen || !c.replyNotified) {
          c.replySeen = true;
          c.replyNotified = true;
          if (!Array.isArray(c.knownReplySnippets)) {
            c.knownReplySnippets = c.replyText ? [c.replyText] : [];
          } else if (c.replyText && !c.knownReplySnippets.includes(c.replyText)) {
            c.knownReplySnippets.push(c.replyText);
          }
          changed = true;
        }
      }
    }
    if (changed) {
      storage.save();
    }
    return true;
  }

  /**
   * Đánh dấu hoặc cập nhật phản hồi của 1 liên hệ (hỗ trợ kiểm thử và quản lý thủ công)
   */
  markReply(contactId, options = {}) {
    const contact = storage.getContact(contactId);
    if (!contact) throw new Error('Không tìm thấy liên hệ.');
    const activeAcc = storage.getActiveAccount();
    const replyText = options.replyText || 'Chào bạn, mình cần hỗ trợ thêm thông tin này nhé!';
    const updated = storage.updateContact(contactId, {
      hasReplied: true,
      replyText,
      replyAt: new Date().toISOString(),
      replyByAccount: options.accountName || (activeAcc ? activeAcc.name : 'Tài khoản Zalo #1'),
      replyByAccountId: options.accountId || (activeAcc ? activeAcc.id : 'acc_default'),
      replyNotified: true,
      replySeen: false,
      knownReplySnippets: Array.from(
        new Set([...(contact.knownReplySnippets || []), replyText])
      )
    });
    this.emitContact(updated);
    this.emit('reply_received', {
      contact: updated,
      replyText: updated.replyText,
      accountName: updated.replyByAccount,
      replyAt: updated.replyAt
    });
    return updated;
  }

  /**
   * Mở trực tiếp cuộc trò chuyện của khách hàng trên Zalo Web để người dùng trả lời
   */
  async openChat(accountId, phone, contactName = '') {
    this.markRepliesSeen(phone || contactName);
    const acc = storage.getAccount(accountId) || storage.getActiveAccount();
    if (!acc) throw new Error('Không tìm thấy tài khoản Zalo.');
    await this.ensureAccountReady(acc.id);
    const sess = this.sessions.get(acc.id);
    if (!sess || !sess.page || sess.page.isClosed()) {
      throw new Error('Phiên Zalo chưa sẵn sàng.');
    }
    this.viewingAccountId = acc.id;
    storage.setActiveAccount(acc.id);

    const searchQuery =
      phone && phone !== 'Từ Zalo Web' ? phone : contactName || phone || '';

    const page = sess.page;
    try {
      const searchInput = page.locator('#contact-search-input, [data-id="contact-search-input"], input[placeholder*="Tìm kiếm"]').first();
      if (searchQuery && (await searchInput.count()) > 0) {
        await searchInput.click();
        await searchInput.fill(searchQuery);
        await page.waitForTimeout(600);
        const firstResult = page.locator('.conv-item, [data-id^="conv-item-"], .search-item').first();
        if ((await firstResult.count()) > 0) {
          await firstResult.click();
        } else {
          await page.keyboard.press('Enter');
        }
      }
    } catch (err) {
      this.log('warning', `Không thể tự mở cuộc trò chuyện với ${searchQuery}: ${err.message}`);
    }
    return this.getStatus();
  }

  // ===================== Chiến dịch =====================

  /**
   * Bắt đầu gửi tin:
   * - Nếu autoRotateAccounts bật: Tự động chuyển tài khoản tuần tự (gửi xong tk này tự dùng tk kế tiếp để gửi)
   * - Nếu tắt: Dùng tài khoản đang chọn gửi.
   */
  async startCampaign(options = {}) {
    if (this.campaignState === 'RUNNING') return this.getStatus();

    const wasPaused = this.campaignState === 'PAUSED';

    if (options && options.accountId) {
      storage.setActiveAccount(options.accountId);
      this.viewingAccountId = options.accountId;
    }
    if (options && typeof options.autoRotateAccounts === 'boolean') {
      storage.updateSettings({ autoRotateAccounts: options.autoRotateAccounts });
    }

    if (this.campaign && this.campaign.promise && !this.campaign.finished) {
      const finished = await Promise.race([
        this.campaign.promise.then(() => true),
        sleep(10000).then(() => false)
      ]);
      if (!finished) {
        throw new Error('Tiến trình gửi trước đang hoàn tất số cuối cùng. Vui lòng thử lại sau vài giây.');
      }
    }

    const validContacts = storage.getContacts().filter((c) => c.status !== 'SAI_SO');
    if (validContacts.length === 0) {
      throw new Error(
        'Danh sách chưa có số điện thoại hợp lệ nào. Vui lòng nạp danh sách SĐT ở mục 3 trước khi bắt đầu.'
      );
    }

    const settings = storage.getSettings();
    const sendMode = options.sendMode || settings.sendMode || (settings.autoRotateAccounts ? 'ROUND_ROBIN' : 'SINGLE');
    const autoRotate = sendMode === 'ROUND_ROBIN' || (sendMode !== 'SINGLE' && settings.autoRotateAccounts !== false);

    const allAccounts = storage.getAccounts();
    const activeAcc = storage.getActiveAccount();
    let candidates = [];

    if ((sendMode === 'PARALLEL' || autoRotate) && allAccounts.length > 1) {
      candidates = [activeAcc, ...allAccounts.filter((a) => a.id !== activeAcc.id)];
    } else {
      candidates = [activeAcc];
    }

    const readyCheck = await this.ensureAccountReady(candidates[0].id);
    if (!readyCheck.ok) {
      throw new Error(
        `Tài khoản "${candidates[0].name}" chưa sẵn sàng: ${readyCheck.reason}. Hãy bấm "📱 Quét QR / Xem ngầm" để đăng nhập.`
      );
    }
    const participants = [{ id: candidates[0].id, name: candidates[0].name }];

    if ((sendMode === 'PARALLEL' || autoRotate) && candidates.length > 1) {
      for (let i = 1; i < candidates.length; i++) {
        const acc = candidates[i];
        const check = await this.ensureAccountReady(acc.id, 4000);
        if (check.ok) {
          participants.push({ id: acc.id, name: acc.name });
        } else {
          this.log('info', `📱 [Worker] "${acc.name}" chưa quét QR – sẽ bỏ qua hoặc nhắc khi tới lượt.`);
        }
      }
    }

    const { runnableCount, autoReset } = storage.prepareContactsForCampaign({ wasPaused });
    if (autoReset) {
      this.emit('contacts_replaced', storage.getContacts());
      this.log('info', `🔄 Đã tự động đặt lại ${runnableCount} SĐT về trạng thái Chờ xử lý để bắt đầu gửi.`);
    }

    // Khởi tạo Task Orchestrator & Worker Pool
    taskEngine.initQueue(validContacts, {
      mode: sendMode,
      rotateEveryN: Number(settings.rotateEveryN) || 15
    });
    taskEngine.registerWorkers(participants);

    const campaign = {
      id: Date.now(),
      autoRotate: autoRotate && participants.length > 1,
      sendMode,
      speedMode: 'BURST',
      participants,
      inFlight: new Set(),
      workers: new Map(),
      finished: false,
      promise: null
    };

    participants.forEach((p, idx) => {
      campaign.workers.set(p.id, {
        accountId: p.id,
        accountName: p.name,
        workerIndex: idx,
        state: 'RUNNING',
        processed: 0,
        success: 0,
        processedInBatch: 0,
        countdownSec: 0,
        currentPhone: '',
        note: ''
      });
    });

    this.campaign = campaign;
    this.campaignState = 'RUNNING';

    let modeText = '';
    if (sendMode === 'PARALLEL' && participants.length > 1) {
      modeText = `⚡ Đa luồng song song cùng lúc ${participants.length} tài khoản (${participants.map((p) => p.name).join(' & ')})`;
    } else if (campaign.autoRotate) {
      modeText = `🔄 Luân phiên chuyển lần lượt ${participants.length} tài khoản (${participants.map((p) => p.name).join(' ➔ ')})`;
    } else {
      modeText = `1 tài khoản ("${participants[0].name}")`;
    }

    this.log(
      'info',
      `🚀 Bắt đầu gửi ${runnableCount} SĐT • ${modeText}${
        settings.attachedImages?.length ? ` • Kèm ${settings.attachedImages.length} ảnh` : ''
      }.`
    );

    if (sendMode === 'PARALLEL' && participants.length > 1) {
      campaign.promise = this.runParallelCampaign(campaign);
    } else {
      campaign.promise = this.runSequentialCampaign(campaign);
    }
    return this.getStatus();
  }

  /**
   * Chế độ Đa Luồng Song Song (Concurrent Worker Pool)
   * Tất cả các tài khoản Zalo cùng bốc việc từ Task Queue và gửi đồng thời độc lập.
   */
  async runParallelCampaign(campaign) {
    const participants = campaign.participants;
    this.log(
      'info',
      `⚡ [Worker Pool Song Song] Đang kích hoạt đồng thời ${participants.length} Worker độc lập...`
    );

    const workerPromises = participants.map(async (acc) => {
      let worker = campaign.workers.get(acc.id);
      if (!worker) {
        worker = {
          accountId: acc.id,
          accountName: acc.name,
          state: 'RUNNING',
          processed: 0,
          success: 0,
          processedInBatch: 0,
          countdownSec: 0,
          currentPhone: '',
          note: ''
        };
        campaign.workers.set(acc.id, worker);
      }

      const ready = await this.ensureAccountReady(acc.id);
      if (!ready.ok) {
        worker.state = 'STOPPED_ERROR';
        worker.note = ready.reason;
        taskEngine.updateWorkerStatus(acc.id, 'ERROR', ready.reason);
        this.log('warning', `⚠️ Worker "${acc.name}" chưa sẵn sàng (${ready.reason}), tạm bỏ qua.`);
        return;
      }

      taskEngine.updateWorkerStatus(acc.id, 'RUNNING', 'Đang nhận việc từ hàng đợi Task Queue...');
      this.log('info', `🚀 Worker "${acc.name}" đã bắt đầu nhận việc từ hàng đợi.`);
      return this.runWorker(campaign, worker, 0);
    });

    try {
      await Promise.allSettled(workerPromises);
    } catch (err) {
      this.log('error', `Chiến dịch đa luồng song song gặp lỗi: ${err.message}`);
    } finally {
      this.finishCampaign(campaign);
    }
  }

  async runSequentialCampaign(campaign) {
    const participants = campaign.participants;
    let participantIdx = 0;
    const rotateEveryN = Math.max(1, Number(storage.getSettings().rotateEveryN) || 15);

    try {
      while (this.isCampaignActive(campaign)) {
        const remaining = storage.getContacts().filter((c) => c.status === 'PENDING').length;
        if (remaining === 0) {
          break;
        }

        const currentAcc = participants[participantIdx % participants.length];
        let worker = campaign.workers.get(currentAcc.id);
        if (!worker) {
          worker = {
            accountId: currentAcc.id,
            accountName: currentAcc.name,
            state: 'RUNNING',
            processed: 0,
            success: 0,
            processedInBatch: 0,
            countdownSec: 0,
            currentPhone: '',
            note: ''
          };
          campaign.workers.set(currentAcc.id, worker);
        }

        storage.setActiveAccount(currentAcc.id);
        this.viewingAccountId = currentAcc.id;
        this.broadcastStatus();

        const ready = await this.ensureAccountReady(currentAcc.id);
        if (!ready.ok) {
          this.log('warning', `⚠️ "${currentAcc.name}" chưa sẵn sàng (${ready.reason}). Chuyển sang tài khoản kế tiếp...`);
          if (participants.length > 1) {
            participantIdx++;
            if (participantIdx >= participants.length * 2) {
              throw new Error('Tất cả các tài khoản Zalo đều chưa sẵn sàng.');
            }
            await sleep(1500);
            continue;
          } else {
            throw new Error(`Tài khoản "${currentAcc.name}" chưa sẵn sàng.`);
          }
        }

        const outcome = await this.runWorker(
          campaign,
          worker,
          campaign.autoRotate && participants.length > 1 ? rotateEveryN : 0
        );

        if (!this.isCampaignActive(campaign)) break;

        const remainingAfter = storage.getContacts().filter((c) => c.status === 'PENDING').length;
        if (remainingAfter === 0) {
          break;
        }

        if (campaign.autoRotate && participants.length > 1) {
          participantIdx++;
          const nextAcc = participants[participantIdx % participants.length];
          this.log(
            'info',
            `🔄 [Tự động chuyển tài khoản] Đã hoàn tất lượt gửi bằng "${currentAcc.name}". Chuyển sang "${nextAcc.name}" để tiếp tục gửi...`
          );
          await sleep(2000);
        } else {
          if (outcome === 'DONE' || outcome === 'STOPPED_LIMIT' || outcome === 'STOPPED_ERROR') {
            break;
          }
        }
      }
    } catch (err) {
      this.log('error', `Chiến dịch gửi gặp lỗi: ${err.message}`);
    } finally {
      this.finishCampaign(campaign);
    }
  }

  finishCampaign(campaign) {
    campaign.finished = true;
    taskEngine.checkCompletion();

    // Trả các số còn kẹt về hàng chờ
    for (const key of [...campaign.inFlight]) {
      const [cid] = key.split('|');
      campaign.inFlight.delete(key);
      const c = storage.getContact(cid);
      if (c && c.status === 'PROCESSING') {
        this.emitContact(storage.updateContact(cid, { status: 'PENDING' }));
      }
    }
    for (const c of storage.getContacts()) {
      if (c.status === 'PROCESSING') this.emitContact(storage.updateContact(c.id, { status: 'PENDING' }));
    }

    const workers = [...campaign.workers.values()];
    const totalSent = workers.reduce((s, w) => s + w.processed, 0);
    const totalOk = workers.reduce((s, w) => s + w.success, 0);
    const remaining = storage.getContacts().filter((c) => c.status === 'PENDING').length;

    if (this.campaign !== campaign) return;

    if (this.campaignState === 'PAUSED') {
      this.log('warning', `⏸ Đã dừng. Đã xử lý ${totalSent} lượt (${totalOk} thành công), còn ${remaining} số chờ gửi.`);
    } else if (remaining === 0) {
      this.campaignState = 'IDLE';
      this.log('success', `🎉 Hoàn tất! Đã xử lý ${totalSent} lượt, ${totalOk} lượt gửi thành công.`);
    } else {
      this.campaignState = 'PAUSED';
      const stopped = workers.filter((w) => w.state.startsWith('STOPPED')).map((w) => `${w.accountName} (${w.note})`);
      this.log(
        'warning',
        `⚠️ Tạm dừng: còn ${remaining} số chưa gửi xong${stopped.length ? ` vì ${stopped.join('; ')}` : ''}. Bấm "Bắt đầu" để gửi tiếp.`
      );
    }
    this.broadcastStatus();
  }

  pauseCampaign() {
    taskEngine.pause();
    if (this.campaignState === 'RUNNING' || this.campaignState === 'SCHEDULED') {
      const wasRunning = this.campaignState === 'RUNNING';
      this.campaignState = 'PAUSED';
      if (wasRunning) {
        this.log('warning', '⏸ Đang dừng – các luồng sẽ dừng sau khi xong số đang gửi dở...');
      } else {
        this.broadcastStatus();
      }
    }
    return this.getStatus();
  }

  isCampaignActive(campaign) {
    return this.campaign === campaign && this.campaignState === 'RUNNING';
  }

  async workerSleep(campaign, worker, seconds, state = 'RESTING') {
    if (seconds <= 0) return;
    worker.state = state;
    worker.countdownSec = seconds;
    taskEngine.setWorkerCountdown(worker.accountId, seconds, `Đang nghỉ giãn cách ${seconds}s`);
    this.scheduleStatusBroadcast();
    while (worker.countdownSec > 0 && this.isCampaignActive(campaign)) {
      await sleep(1000);
      worker.countdownSec = Math.max(0, worker.countdownSec - 1);
      taskEngine.setWorkerCountdown(worker.accountId, worker.countdownSec, `Đang nghỉ giãn cách ${worker.countdownSec}s`);
      this.scheduleStatusBroadcast();
    }
    worker.countdownSec = 0;
    if (worker.state === state) worker.state = 'RUNNING';
    taskEngine.updateWorkerStatus(worker.accountId, worker.state, '');
    this.scheduleStatusBroadcast();
  }

  /**
   * Luồng gửi của 1 tài khoản. Nhiều luồng chạy song song an toàn vì:
   *  - Mỗi luồng dùng Page riêng của tài khoản đó.
   *  - Việc lấy SĐT là đồng bộ (không có await giữa lúc tìm và lúc đánh dấu PROCESSING).
   *  - Bộ đếm nghỉ / chặng nằm trên từng luồng, không dùng chung.
   */
  async runWorker(campaign, worker, limitN = 0) {
    let sentThisTurn = 0;
    while (this.isCampaignActive(campaign)) {
      if (limitN > 0 && sentThisTurn >= limitN) {
        worker.note = `Đã xong lượt gửi (${limitN} số)`;
        this.scheduleStatusBroadcast();
        return 'TURN_DONE';
      }

      const settings = storage.getSettings();

      if (!this.isWithinActiveHours(settings)) {
        worker.note = `Ngoài khung giờ ${settings.activeHourStart}-${settings.activeHourEnd}`;
        await this.workerSleep(campaign, worker, 60, 'WAITING_HOURS');
        continue;
      }

      const contact = this.claimNextContact(campaign, worker);
      if (!contact) {
        worker.state = 'DONE';
        worker.currentPhone = '';
        worker.note = 'Đã hết số cần gửi';
        taskEngine.updateWorkerStatus(worker.accountId, 'IDLE', 'Đã hết số cần gửi');
        this.scheduleStatusBroadcast();
        return 'DONE';
      }

      worker.state = 'RUNNING';
      worker.currentPhone = contact.phone;
      worker.note = `Đang gửi SĐT: ${contact.phone}`;
      taskEngine.updateWorkerStatus(worker.accountId, 'RUNNING', `Đang gửi SĐT: ${contact.phone}`);
      this.scheduleStatusBroadcast();

      const messageToSend = renderMessage(settings.template, contact, {
        useCustomMessageFirst: settings.useCustomMessageFirst
      });

      let result;
      const cached = storage.state.phoneCache[contact.phone];

      try {
        if (settings.usePhoneCache && cached && cached.status === 'KHONG_DANG_KY') {
          result = {
            status: 'KHONG_DANG_KY',
            zaloName: '',
            sentMessage: '',
            reason: `${cached.reason || 'Chưa đăng ký Zalo'} (từ Cache – không tốn lượt tìm)`,
            fromCache: true
          };
        } else {
          const sess = this.sessions.get(worker.accountId);
          if (!this.isSessionAlive(sess) || sess.browserState !== 'READY') {
            this.releaseContact(campaign, worker, contact.id, 'Phiên Zalo đã đóng hoặc bị đăng xuất');
            worker.state = 'STOPPED_ERROR';
            worker.note = 'Phiên Zalo đã đóng / đăng xuất';
            this.log('error', `[${worker.accountName}] Phiên Zalo đã đóng hoặc bị đăng xuất.`);
            return 'STOPPED_ERROR';
          }
          result = await this.processContactOnPage(sess.page, contact, messageToSend, settings);
        }
      } catch (err) {
        this.releaseContact(campaign, worker, contact.id, err.message);
        worker.state = 'STOPPED_ERROR';
        worker.note = err.message;
        this.log('error', `[${worker.accountName}] ${err.message}.`);
        return 'STOPPED_ERROR';
      }

      if (result.status === 'RATE_LIMITED') {
        this.releaseContact(campaign, worker, contact.id, result.reason);
        worker.state = 'STOPPED_LIMIT';
        worker.note = 'Chạm giới hạn tìm kiếm';
        this.log(
          'warning',
          `🛡️ [${worker.accountName}] ${result.reason}. Đã dừng tài khoản này để bảo vệ nick.`
        );
        return 'STOPPED_LIMIT';
      }

      worker.processed++;
      worker.processedInBatch++;
      sentThisTurn++;
      if (result.status === 'THANH_CONG') {
        worker.success++;
        storage.incrementAccountSent(worker.accountId);
      }

      const updated = this.recordResult(campaign, worker, contact.id, result);

      const level =
        result.status === 'THANH_CONG'
          ? 'success'
          : result.status === 'LOI'
          ? 'error'
          : 'warning';
      this.log(
        level,
        `[${worker.accountName}] ➔ ${contact.phone} (${updated?.zaloName || contact.name || 'Không tên'}): ${
          STATUS_LABELS[result.status] || result.status
        } — ${result.reason}`
      );

      worker.currentPhone = '';
      if (!this.isCampaignActive(campaign)) return 'PAUSED';

      // Nghỉ giữa các lượt
      if (result.fromCache) {
        await sleep(150);
        continue;
      }
      if (campaign.speedMode === 'BURST') {
        await sleep(300);
        continue;
      }

      const batchSize = Math.max(1, Number(settings.batchSize) || 15);
      const batchPauseSec =
        settings.batchPauseSec !== undefined && settings.batchPauseSec !== ''
          ? Math.max(0, Number(settings.batchPauseSec))
          : 120;

      if (batchPauseSec > 0 && worker.processedInBatch >= batchSize) {
        worker.processedInBatch = 0;
        this.log('info', `[${worker.accountName}] Đủ ${batchSize} số – nghỉ giữa chặng ${batchPauseSec} giây.`);
        await this.workerSleep(campaign, worker, batchPauseSec);
      } else {
        const minSec =
          settings.minDelaySec !== undefined && settings.minDelaySec !== ''
            ? Math.max(0, Number(settings.minDelaySec))
            : 12;
        const maxSec =
          settings.maxDelaySec !== undefined && settings.maxDelaySec !== ''
            ? Math.max(minSec, Number(settings.maxDelaySec))
            : Math.max(minSec, 25);
        const sec =
          minSec === maxSec
            ? minSec
            : Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
        if (sec > 0) {
          await this.workerSleep(campaign, worker, sec);
        } else {
          await sleep(100);
        }
      }
    }
  }

  formatStatusLabel(status) {
    return STATUS_LABELS[status] || 'Lỗi';
  }

  /**
   * Thực thi tìm kiếm SĐT & gửi tin nhắn + hình ảnh siêu tốc trên 1 Page cụ thể (an toàn cho chạy đa luồng song song)
   */
  async processContactOnPage(page, contact, messageToSend, settings) {
    if (!page || page.isClosed()) {
      throw new Error('Phiên Zalo Web đã bị đóng.');
    }

    const useFastPaste = settings.fastPasteMode !== false;

    try {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(80);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(90);

      await page
        .evaluate(() => {
          const closeSearchBtn = Array.from(document.querySelectorAll('div, span, button')).find(
            (el) =>
              el.innerText &&
              el.innerText.trim() === 'Đóng' &&
              el.getBoundingClientRect().top < 120 &&
              el.getBoundingClientRect().left < 420
          );
          if (closeSearchBtn) closeSearchBtn.click();
        })
        .catch(() => {});

      const addFriendSelectors = [
        '[data-id="btn_Main_AddFrd"]',
        '[title*="Thêm bạn"]',
        'i.fa-outline-add-new-contact-2',
        '[id="btn_Main_AddFrd"]'
      ];

      let openedModal = false;
      for (const sel of addFriendSelectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          await loc.click({ timeout: 2000 });
          openedModal = true;
          break;
        }
      }

      if (!openedModal) {
        await page.mouse.click(266, 78);
      }

      let activePhoneInput = await this.waitForPhoneInput(page, 1400);
      if (!activePhoneInput) {
        await page.mouse.click(266, 78);
        activePhoneInput = await this.waitForPhoneInput(page, 1400);
        if (!activePhoneInput) {
          return {
            status: 'RATE_LIMITED',
            reason: 'Không mở được hộp thoại "Thêm bạn" trên Zalo Web'
          };
        }
      }

      await activePhoneInput.click({ timeout: 3000 });
      await activePhoneInput.fill('');
      if (useFastPaste) {
        await activePhoneInput.fill(contact.phone);
      } else {
        await activePhoneInput.pressSequentially(contact.phone, { delay: 40 });
      }
      await page.waitForTimeout(100);

      const searchBtnClicked = await page.evaluate(() => {
        const btnById = document.querySelector('[data-id="btn_Main_AddFrd_Search"]');
        if (btnById && btnById.offsetParent !== null) {
          btnById.click();
          return true;
        }
        const candidates = Array.from(document.querySelectorAll('div, button, span')).filter(
          (el) =>
            el.innerText &&
            el.innerText.trim() === 'Tìm kiếm' &&
            el.offsetParent !== null &&
            el.getBoundingClientRect().top > 250
        );
        if (candidates.length > 0) {
          candidates[candidates.length - 1].click();
          return true;
        }
        return false;
      });

      if (!searchBtnClicked) {
        await page.keyboard.press('Enter').catch(() => {});
      }

      const lookupResult = await this.pollPhoneLookupResult(page, 3000);

      if (lookupResult.type === 'RATE_LIMITED') {
        await page.keyboard.press('Escape').catch(() => {});
        return {
          status: 'RATE_LIMITED',
          reason: lookupResult.reason
        };
      }

      if (lookupResult.type === 'NOT_REGISTERED') {
        await page.keyboard.press('Escape').catch(() => {});
        return {
          status: 'KHONG_DANG_KY',
          zaloName: '',
          sentMessage: '',
          reason: lookupResult.reason
        };
      }

      if (settings.autoAddFriendWhenBlocked) {
        await page
          .evaluate(() => {
            const addBtn = Array.from(document.querySelectorAll('div, button, span')).find(
              (el) =>
                el.innerText &&
                el.innerText.trim() === 'Kết bạn' &&
                el.offsetParent !== null &&
                el.getBoundingClientRect().left > 300 &&
                el.getBoundingClientRect().top > 350
            );
            if (addBtn) addBtn.click();
          })
          .catch(() => {});
      }

      const clickedMsgBtn = await page.evaluate(() => {
        const byId = document.querySelector('[data-id="btn_Main_AddFrd_Msg"]');
        if (byId && byId.offsetParent !== null) {
          byId.click();
          return true;
        }
        const candidates = Array.from(document.querySelectorAll('div, button, span')).filter(
          (el) =>
            el.innerText &&
            el.innerText.trim() === 'Nhắn tin' &&
            el.offsetParent !== null &&
            el.getBoundingClientRect().left > 300
        );
        if (candidates.length > 0) {
          candidates[candidates.length - 1].click();
          return true;
        }
        return false;
      });

      if (!clickedMsgBtn) {
        await page.keyboard.press('Escape').catch(() => {});
        return {
          status: 'LOI',
          zaloName: lookupResult.zaloName || '',
          sentMessage: '',
          reason: 'Tìm thấy tài khoản nhưng không bấm được nút Nhắn tin'
        };
      }

      const chatInput = await this.waitForChatInput(page, 2000);

      const chatPreCheck = await page.evaluate(() => {
        const headerEl =
          document.querySelector('header .header-title') ||
          document.querySelector('[data-id="div_Main_Header"] .truncate') ||
          document.querySelector('.thread-chat-title');
        const headerName = headerEl ? headerEl.innerText.trim() : '';

        const chatText = document.body ? document.body.innerText.toLowerCase() : '';
        const blockedPhrases = [
          'chặn không nhận tin nhắn từ người lạ',
          'bạn chưa thể gửi tin nhắn cho người này',
          'không nhận tin nhắn từ người lạ',
          'chỉ nhận tin nhắn từ bạn bè'
        ];
        const isBlocked = blockedPhrases.some((p) => chatText.includes(p));
        return { headerName, isBlocked };
      });

      const resolvedZaloName = chatPreCheck.headerName || lookupResult.zaloName || '';

      if (!chatInput) {
        if (chatPreCheck.isBlocked) {
          return {
            status: 'CHAN_NGUOI_LA',
            zaloName: resolvedZaloName,
            sentMessage: '',
            reason: 'Người dùng chặn không nhận tin nhắn từ người lạ (khung chat bị khóa)'
          };
        }
        return {
          status: 'LOI',
          zaloName: resolvedZaloName,
          sentMessage: '',
          reason: 'Không tìm thấy ô nhập tin nhắn trong hội thoại'
        };
      }

      await chatInput.click({ timeout: 3000 });
      await page.waitForTimeout(60);
      // Xóa sạch nội dung nháp còn sót lại trong ô chat (nếu có) trước khi chèn tin nhắn mới
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(40);

      const attachedImages = Array.isArray(settings.attachedImages) ? settings.attachedImages : [];
      let attachedImgCount = 0;

      if (attachedImages.length > 0) {
        attachedImgCount = await this.pasteImagesIntoChat(page, attachedImages);
        if (attachedImgCount > 0) {
          await page.waitForTimeout(400);
        }
      }

      if (messageToSend) {
        await this.typeMultilineFast(page, messageToSend);
      }

      const isTurbo =
        settings.minDelaySec === 0 ||
        settings.minDelaySec === '0' ||
        Number(settings.minDelaySec) <= 1;

      await page.waitForTimeout(isTurbo ? 50 : 160);
      await page.keyboard.press('Enter');

      await page.waitForTimeout(isTurbo ? 300 : 1100);

      const postSendCheck = await page.evaluate(() => {
        const text = document.body ? document.body.innerText.toLowerCase() : '';
        const blockedPhrases = [
          'chặn không nhận tin nhắn từ người lạ',
          'bạn chưa thể gửi tin nhắn cho người này vì người này chặn không nhận tin nhắn từ người lạ',
          'không nhận tin nhắn từ người lạ',
          'chỉ nhận tin nhắn từ bạn bè'
        ];
        for (const phrase of blockedPhrases) {
          if (text.includes(phrase)) {
            return {
              blocked: true,
              reason:
                'Bạn chưa thể gửi tin nhắn cho người này vì người này chặn không nhận tin nhắn từ người lạ'
            };
          }
        }
        return { blocked: false };
      });

      const summarySent =
        attachedImgCount > 0
          ? `[Kèm ${attachedImgCount} ảnh] ${messageToSend}`
          : messageToSend;

      if (postSendCheck.blocked) {
        return {
          status: 'CHAN_NGUOI_LA',
          zaloName: resolvedZaloName,
          sentMessage: summarySent,
          reason: postSendCheck.reason
        };
      }

      return {
        status: 'THANH_CONG',
        zaloName: resolvedZaloName,
        sentMessage: summarySent,
        reason:
          attachedImgCount > 0
            ? `Đã gửi thành công tin nhắn kèm ${attachedImgCount} ảnh`
            : 'Đã gửi tin nhắn thành công'
      };
    } catch (err) {
      return {
        status: 'LOI',
        zaloName: '',
        sentMessage: '',
        reason: `Lỗi thao tác trình duyệt: ${err.message}`
      };
    }
  }

  async waitForPhoneInput(page, timeoutMs = 1400) {
    const selectors = [
      'input[data-id="txt_Main_AddFrd_Phone"]',
      'input[placeholder*="Số điện thoại"]',
      'input[placeholder*="Phone number"]'
    ];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          return loc;
        }
      }
      await page.waitForTimeout(90);
    }
    return null;
  }

  async waitForChatInput(page, timeoutMs = 2000) {
    const selectors = [
      '#richInput',
      'div[contenteditable="true"]#richInput',
      'div[contenteditable="true"][data-id*="inp_Chat"]',
      '#input_line_0',
      'div[contenteditable="true"]'
    ];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          return loc;
        }
      }
      await page.waitForTimeout(90);
    }
    return null;
  }

  async pollPhoneLookupResult(page, timeoutMs = 3200) {
    const deadline = Date.now() + timeoutMs;
    await page.waitForTimeout(250);

    while (Date.now() < deadline) {
      const check = await page.evaluate(() => {
        // 1. Ưu tiên kiểm tra nút "Nhắn tin" trong popup Thông tin tài khoản trước tiên
        const msgBtn =
          document.querySelector('[data-id="btn_Main_AddFrd_Msg"]') ||
          Array.from(document.querySelectorAll('div, button, span')).find(
            (el) =>
              el.innerText &&
              el.innerText.trim() === 'Nhắn tin' &&
              el.offsetParent !== null &&
              el.getBoundingClientRect().left > 300
          );

        if (msgBtn && msgBtn.offsetParent !== null) {
          let detectedName = '';
          const nameCandidates = Array.from(
            document.querySelectorAll('.pi-mini-info-section__name, .truncate, h4, h3, div')
          ).filter((el) => {
            const rect = el.getBoundingClientRect();
            return (
              el.offsetParent !== null &&
              rect.left > 350 &&
              rect.right < 900 &&
              rect.top > 300 &&
              rect.top < 460 &&
              el.children.length === 0 &&
              el.innerText &&
              el.innerText.trim().length > 1 &&
              !['Kết bạn', 'Nhắn tin', 'Thông tin cá nhân'].includes(el.innerText.trim())
            );
          });
          if (nameCandidates.length > 0) {
            detectedName = nameCandidates[0].innerText.trim();
          }

          return {
            done: true,
            type: 'FOUND_PROFILE',
            zaloName: detectedName
          };
        }

        // 2. Chỉ lấy text từ các thông báo / modal (loại trừ vùng tin nhắn hội thoại cũ để tránh nhận nhầm)
        const modalOrToastEls = Array.from(
          document.querySelectorAll('.zl-modal, .z-noti, .toast, [role="dialog"], .modal-content, body > div')
        ).filter((el) => !el.querySelector('#conversationListId') && !el.querySelector('#richInput'));
        const overlayText = (
          modalOrToastEls.length > 0
            ? modalOrToastEls.map((el) => el.innerText || '').join('\n')
            : document.body?.innerText || ''
        ).toLowerCase();

        const rateLimitPatterns = [
          'tìm kiếm quá nhiều lần',
          'quá số lần cho phép',
          'vui lòng thử lại sau',
          'giới hạn tìm kiếm',
          'hoạt động bất thường'
        ];
        for (const pat of rateLimitPatterns) {
          if (overlayText.includes(pat)) {
            return {
              done: true,
              type: 'RATE_LIMITED',
              reason: `Zalo thông báo giới hạn tìm kiếm: "${pat}"`
            };
          }
        }

        const notRegisteredPatterns = [
          'chưa đăng ký tài khoản',
          'không cho phép tìm kiếm',
          'số điện thoại chưa đăng ký',
          'số điện thoại không hợp lệ'
        ];
        for (const pat of notRegisteredPatterns) {
          if (overlayText.includes(pat)) {
            return {
              done: true,
              type: 'NOT_REGISTERED',
              reason: 'Số điện thoại chưa đăng ký tài khoản Zalo hoặc chặn tìm kiếm bằng SĐT'
            };
          }
        }

        return { done: false };
      });

      if (check.done) {
        return check;
      }
      await page.waitForTimeout(100);
    }

    return {
      type: 'NOT_REGISTERED',
      reason: 'Số điện thoại chưa đăng ký tài khoản Zalo hoặc chặn tìm kiếm bằng SĐT'
    };
  }

  async pasteTextIntoChat(page, text) {
    try {
      return await page.evaluate((msg) => {
        const target =
          document.querySelector('#richInput') ||
          document.querySelector('div[contenteditable="true"]');
        if (!target) return false;
        target.focus();

        const dt = new DataTransfer();
        dt.setData('text/plain', msg);
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        target.dispatchEvent(pasteEvent);

        return Boolean(target.innerText && target.innerText.trim().length > 0);
      }, text);
    } catch {
      return false;
    }
  }

  async typeMultilineFast(page, messageToSend) {
    const lines = messageToSend.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) {
        await page.keyboard.insertText(lines[i]);
      }
      if (i < lines.length - 1) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(20);
      }
    }
  }

  async pasteImagesIntoChat(page, attachedImages) {
    let count = 0;
    for (const img of attachedImages) {
      try {
        if (!img.filePath || !fs.existsSync(img.filePath)) continue;
        const buffer = fs.readFileSync(img.filePath);
        const base64Data = buffer.toString('base64');
        const mimeType = img.mimeType || 'image/png';
        const fileName = img.name || 'image.png';

        const ok = await page.evaluate(
          ({ b64, mime, name }) => {
            const target =
              document.querySelector('#richInput') ||
              document.querySelector('div[contenteditable="true"]');
            if (!target) return false;
            target.focus();

            const byteChars = atob(b64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteNumbers[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const file = new File([byteArray], name, { type: mime });

            const dt = new DataTransfer();
            dt.items.add(file);

            const pasteEvent = new ClipboardEvent('paste', {
              clipboardData: dt,
              bubbles: true,
              cancelable: true
            });
            target.dispatchEvent(pasteEvent);
            return true;
          },
          { b64: base64Data, mime: mimeType, name: fileName }
        );

        if (ok) {
          count++;
          await page.waitForTimeout(280);
        }
      } catch {
        // ignore single image paste error
      }
    }
    return count;
  }
}

module.exports = new ZaloBot();
