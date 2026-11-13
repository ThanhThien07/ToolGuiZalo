const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { chromium } = require('playwright');
const storage = require('./storage');
const { renderMessage } = require('./templateEngine');

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

    this.startScheduleWatcher();
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
      args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check', '--window-size=1280,840']
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
    try {
      await this.checkAccountLoginStatus(id);
      const buffer = await sess.page.screenshot({ type: 'jpeg', quality: 75 });
      return {
        accountId: id,
        imageBase64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        url: sess.page.url(),
        browserState: sess.browserState,
        width: VIEWPORT_SIZE.width,
        height: VIEWPORT_SIZE.height
      };
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
    await sess.page.waitForTimeout(350);
    await this.checkAccountLoginStatus(id);
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
    return updated;
  }

  /**
   * Trả 1 SĐT về hàng chờ khi tài khoản không xử lý được (chạm giới hạn, mất phiên...)
   */
  releaseContact(campaign, worker, contactId, reason) {
    campaign.inFlight.delete(`${contactId}|${worker.accountId}`);
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

  /**
   * Quét kiểm tra phản hồi từ khách trên các tài khoản Zalo Web
   */
  async checkReplies(targetAccountId = null) {
    const allAccounts = storage.getAccounts();
    const accountsToCheck = targetAccountId
      ? allAccounts.filter((a) => a.id === targetAccountId)
      : allAccounts.filter((a) => this.sessions.has(a.id) && this.sessions.get(a.id).isReady);

    let foundRepliesCount = 0;
    const contacts = storage.getContacts();

    for (const acc of accountsToCheck) {
      const sess = this.sessions.get(acc.id);
      if (!sess || !sess.page || sess.page.isClosed()) continue;

      try {
        const chats = await sess.page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.conv-item.conv-rel, [data-id^="conv-item-"]'));
          return items.map((el) => {
            const titleEl = el.querySelector('.conv-item-title__name, .conv-item-title, [class*="title__name"]');
            const bodyEl = el.querySelector('.conv-item-body__main, .conv-message, [class*="body__main"]');
            const badgeEl = el.querySelector('.unread-badge, .v2-badge, [class*="badge"], [class*="unread"]');
            const name = titleEl ? titleEl.innerText.replace(/\u00A0/g, ' ').trim() : '';
            const snippet = bodyEl ? bodyEl.innerText.replace(/\u00A0/g, ' ').trim() : '';
            const hasUnread = !!badgeEl && badgeEl.offsetParent !== null;
            const isFromMe = /^bạn\s*:/i.test(snippet) || /^you\s*:/i.test(snippet);
            return { name, snippet, isFromMe, hasUnread };
          });
        });

        for (const chat of chats) {
          if (!chat.name || !chat.snippet) continue;
          if (chat.snippet.toLowerCase() === 'chưa có tin nhắn') continue;
          // NẾU LÀ TIN NHẮN TỪ MÌNH GỬI ĐI THÌ TUYỆT ĐỐI KHÔNG PHẢI PHẢN HỒI!
          if (chat.isFromMe) continue;

          // Tìm contact tương ứng trong danh sách
          const normChatName = chat.name.toLowerCase();
          const matched = contacts.find((c) => {
            const normZaloName = (c.zaloName || '').toLowerCase().trim();
            const normContactName = (c.name || '').toLowerCase().trim();
            return (
              (normZaloName && normZaloName === normChatName) ||
              (normContactName && normContactName === normChatName)
            );
          });

          if (matched) {
            // Chỉ kiểm tra contact đã gửi tin thành công
            if (matched.status !== 'THANH_CONG') {
              continue;
            }

            // Kiểm tra xem tin nhắn có phải nội dung ta đã gửi đi không
            const sentSnippet = (matched.sentMessage || '').replace(/\s+/g, ' ').trim().slice(0, 30);
            if (sentSnippet && chat.snippet.includes(sentSnippet)) {
              continue;
            }

            storage.updateContact(matched.id, {
              hasReplied: true,
              replyText: chat.snippet,
              replyAt: new Date().toISOString(),
              replyByAccount: acc.name,
              replyByAccountId: acc.id
            });
            foundRepliesCount++;
          }
        }
      } catch (err) {
        this.log('warning', `Kiểm tra phản hồi trên "${acc.name}" gặp lỗi: ${err.message}`);
      }
    }

    const replies = storage.getContacts().filter((c) => c.hasReplied && c.replyText);
    return {
      ok: true,
      foundCount: foundRepliesCount,
      replies
    };
  }

  /**
   * Đặt lại trạng thái phản hồi cho toàn bộ danh sách
   */
  resetReplies() {
    for (const c of storage.getContacts()) {
      c.hasReplied = false;
      delete c.replyText;
      delete c.replyAt;
      delete c.replyByAccount;
      delete c.replyByAccountId;
    }
    storage.save();
    return true;
  }

  /**
   * Đánh dấu hoặc cập nhật phản hồi của 1 liên hệ (hỗ trợ kiểm thử và quản lý thủ công)
   */
  markReply(contactId, options = {}) {
    const contact = storage.getContact(contactId);
    if (!contact) throw new Error('Không tìm thấy liên hệ.');
    const activeAcc = storage.getActiveAccount();
    const updated = storage.updateContact(contactId, {
      hasReplied: true,
      replyText: options.replyText || 'Chào bạn, mình cần hỗ trợ thêm thông tin này nhé!',
      replyAt: new Date().toISOString(),
      replyByAccount: options.accountName || (activeAcc ? activeAcc.name : 'Tài khoản Zalo #1'),
      replyByAccountId: options.accountId || (activeAcc ? activeAcc.id : 'acc_default')
    });
    this.emitContact(updated);
    return updated;
  }

  /**
   * Mở trực tiếp cuộc trò chuyện của khách hàng trên Zalo Web để người dùng trả lời
   */
  async openChat(accountId, phone) {
    const acc = storage.getAccount(accountId) || storage.getActiveAccount();
    if (!acc) throw new Error('Không tìm thấy tài khoản Zalo.');
    await this.ensureAccountReady(acc.id);
    const sess = this.sessions.get(acc.id);
    if (!sess || !sess.page || sess.page.isClosed()) {
      throw new Error('Phiên Zalo chưa sẵn sàng.');
    }
    this.viewingAccountId = acc.id;
    storage.setActiveAccount(acc.id);

    const page = sess.page;
    try {
      const searchInput = page.locator('#contact-search-input, [data-id="contact-search-input"], input[placeholder*="Tìm kiếm"]').first();
      if ((await searchInput.count()) > 0) {
        await searchInput.click();
        await searchInput.fill(phone);
        await page.waitForTimeout(600);
        const firstResult = page.locator('.conv-item, [data-id^="conv-item-"], .search-item').first();
        if ((await firstResult.count()) > 0) {
          await firstResult.click();
        } else {
          await page.keyboard.press('Enter');
        }
      }
    } catch (err) {
      this.log('warning', `Không thể tự mở cuộc trò chuyện với ${phone}: ${err.message}`);
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
    const autoRotate = settings.autoRotateAccounts !== false;

    const allAccounts = storage.getAccounts();
    const activeAcc = storage.getActiveAccount();
    let candidates = [];

    if (autoRotate && allAccounts.length > 1) {
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

    if (autoRotate && candidates.length > 1) {
      for (let i = 1; i < candidates.length; i++) {
        const acc = candidates[i];
        const check = await this.ensureAccountReady(acc.id, 4000);
        if (check.ok) {
          participants.push({ id: acc.id, name: acc.name });
        } else {
          this.log('info', `📱 [Luân phiên] "${acc.name}" chưa quét QR – sẽ bỏ qua hoặc nhắc khi tới lượt.`);
        }
      }
    }

    const { runnableCount, autoReset } = storage.prepareContactsForCampaign({ wasPaused });
    if (autoReset) {
      this.emit('contacts_replaced', storage.getContacts());
      this.log('info', `🔄 Đã tự động đặt lại ${runnableCount} SĐT về trạng thái Chờ xử lý để bắt đầu gửi.`);
    }

    const campaign = {
      id: Date.now(),
      autoRotate: autoRotate && participants.length > 1,
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

    const modeText =
      campaign.autoRotate
        ? `Tự động chuyển lần lượt ${participants.length} tài khoản (${participants.map((p) => p.name).join(' ➔ ')})`
        : `1 tài khoản ("${participants[0].name}")`;

    this.log(
      'info',
      `🚀 Bắt đầu gửi ${runnableCount} SĐT • ${modeText}${
        settings.attachedImages?.length ? ` • Kèm ${settings.attachedImages.length} ảnh` : ''
      }.`
    );

    campaign.promise = this.runSequentialCampaign(campaign);
    return this.getStatus();
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
    worker.state = state;
    worker.countdownSec = seconds;
    this.scheduleStatusBroadcast();
    while (worker.countdownSec > 0 && this.isCampaignActive(campaign)) {
      await sleep(1000);
      worker.countdownSec = Math.max(0, worker.countdownSec - 1);
      this.scheduleStatusBroadcast();
    }
    worker.countdownSec = 0;
    if (worker.state === state) worker.state = 'RUNNING';
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
        this.scheduleStatusBroadcast();
        return 'DONE';
      }

      worker.state = 'RUNNING';
      worker.currentPhone = contact.phone;
      worker.note = '';
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
      if (worker.processedInBatch >= batchSize) {
        worker.processedInBatch = 0;
        const pauseSec = Math.max(3, Number(settings.batchPauseSec) || 120);
        this.log('info', `[${worker.accountName}] Đủ ${batchSize} số – nghỉ giữa chặng ${pauseSec} giây.`);
        await this.workerSleep(campaign, worker, pauseSec);
      } else {
        const minSec = Math.max(1, Number(settings.minDelaySec) || 12);
        const maxSec = Math.max(minSec, Number(settings.maxDelaySec) || 25);
        const sec = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
        await this.workerSleep(campaign, worker, sec);
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

      await page.waitForTimeout(160);
      await page.keyboard.press('Enter');

      await page.waitForTimeout(1100);

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
