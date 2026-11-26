const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { ChannelAdapter } = require('./channelAdapter');
const { getConfig } = require('../config');

const VIEWPORT_SIZE = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ZaloWebAdapter V2:
 * - Tách riêng lớp điều khiển Playwright khỏi logic chiến dịch và cơ sở dữ liệu.
 * - Tuân thủ chính sách V2:
 *   + KHÔNG tự động bấm Kết bạn khi bị chặn người lạ.
 *   + KHÔNG trả sai thành NOT_REGISTERED khi timeout tìm kiếm -> chuyển REVIEW.
 *   + Chỉ chụp ảnh màn hình khi viewer đang mở và tự dừng timer khi đóng / quá hạn xem.
 */
class ZaloWebAdapter extends ChannelAdapter {
  constructor({ onStatusChange, onLog } = {}) {
    super('zalo_web');
    this.sessions = new Map();
    this.launching = new Map();
    this.viewingAccountId = null;
    this.viewerActiveUntil = 0;
    this._lastShot = null;
    this.onStatusChange = onStatusChange || (() => {});
    this.onLog = onLog || (() => {});
  }

  getProfileDir(account) {
    const cfg = getConfig();
    return path.join(cfg.userDataDir, account?.profileDir || `zalo_profile_${account?.id || 'default'}`);
  }

  isSessionAlive(sess) {
    return Boolean(sess && sess.page && !sess.page.isClosed());
  }

  setViewerActive(active, ttlMs = 15000) {
    this.viewerActiveUntil = active ? Date.now() + ttlMs : 0;
    if (!active) {
      this._lastShot = null;
    }
  }

  getSessionSnapshot(accounts = []) {
    return accounts.map((a) => {
      const s = this.sessions.get(a.id);
      return {
        accountId: a.id,
        status: s ? s.browserState : a.status === 'REVOKED' ? 'REVOKED' : 'CLOSED',
        url: this.isSessionAlive(s) ? s.page.url() : '',
        profileName: s?.profileName || a.zaloProfileName || ''
      };
    });
  }

  async ensureSessionReady(account) {
    if (!account) return { ok: false, status: 'CLOSED', reason: 'Thiếu thông tin tài khoản.' };
    if (!this.viewingAccountId) this.viewingAccountId = account.id;

    const existing = this.sessions.get(account.id);
    if (this.isSessionAlive(existing)) {
      const info = await this.checkLoginStatus(account);
      return { ok: info.isLoggedIn, status: existing.browserState, profileName: info.profileName };
    }

    if (this.launching.has(account.id)) {
      await this.launching.get(account.id);
      const sess = this.sessions.get(account.id);
      return {
        ok: Boolean(sess && sess.browserState === 'READY'),
        status: sess ? sess.browserState : 'CLOSED'
      };
    }

    const p = this._doLaunch(account).finally(() => this.launching.delete(account.id));
    this.launching.set(account.id, p);
    await p;
    const sess = this.sessions.get(account.id);
    return {
      ok: Boolean(sess && sess.browserState === 'READY'),
      status: sess ? sess.browserState : 'CLOSED',
      profileName: sess?.profileName || ''
    };
  }

  async _doLaunch(account) {
    const sessObj = {
      accountId: account.id,
      accountName: account.name,
      context: null,
      page: null,
      browserState: 'OPENING',
      profileName: account.zaloProfileName || '',
      watcher: null
    };
    this.sessions.set(account.id, sessObj);
    this.onStatusChange(account.id, 'OPENING', '');

    const profilePath = this.getProfileDir(account);
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
        '--disable-dev-shm-usage'
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
      this.onStatusChange(account.id, 'CLOSED', '');
      throw new Error(`Không mở được phiên "${account.name}": ${lastErr?.message || 'Unknown'}`);
    }

    sessObj.context = context;
    const pages = context.pages();
    sessObj.page = pages.length > 0 ? pages[0] : await context.newPage();
    await sessObj.page.setViewportSize(VIEWPORT_SIZE).catch(() => {});

    context.on('close', () => {
      if (sessObj.watcher) clearInterval(sessObj.watcher);
      if (this.sessions.get(account.id) === sessObj) this.sessions.delete(account.id);
      this.onStatusChange(account.id, 'CLOSED', '');
    });

    await sessObj.page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.checkLoginStatus(account);

    sessObj.watcher = setInterval(async () => {
      if (!this.isSessionAlive(sessObj)) {
        clearInterval(sessObj.watcher);
        return;
      }
      await this.checkLoginStatus(account);
    }, 3500);
  }

  async checkLoginStatus(account) {
    const sess = this.sessions.get(account.id);
    if (!this.isSessionAlive(sess)) {
      this.onStatusChange(account.id, 'CLOSED', '');
      return { isLoggedIn: false, profileName: '' };
    }
    try {
      const info = await sess.page.evaluate(() => {
        if (location.hostname.includes('id.zalo.me')) return { isLoggedIn: false, profileName: '' };
        const main =
          document.querySelector('#contact-search-input') ||
          document.querySelector('input[data-id="txt_Main_Search"]') ||
          document.querySelector('#main-tab') ||
          document.querySelector('.nav__tabs__zalo') ||
          document.querySelector('#conversationListId');
        const avatarImg = document.querySelector('#main-tab .zavatar img, .nav__tabs__zalo img');
        return {
          isLoggedIn: Boolean(main),
          profileName: avatarImg ? avatarImg.getAttribute('alt') || '' : ''
        };
      });
      const prev = sess.browserState;
      sess.browserState = info.isLoggedIn ? 'READY' : 'WAITING_LOGIN';
      if (info.profileName) sess.profileName = info.profileName;
      if (prev !== sess.browserState || info.profileName) {
        this.onStatusChange(account.id, sess.browserState, info.profileName || '');
      }
      return info;
    } catch {
      return { isLoggedIn: sess.browserState === 'READY', profileName: sess.profileName || '' };
    }
  }

  /**
   * Chỉ chụp ảnh màn hình khi modal người xem đang bật; tự từ chối nếu viewer đã đóng hoặc quá hạn xem.
   */
  async getLiveScreenshot(accountId = null, forceViewer = false) {
    if (!forceViewer && Date.now() > this.viewerActiveUntil) {
      return null;
    }
    if (forceViewer) {
      this.setViewerActive(true, 15000);
    }
    const id = accountId || this.viewingAccountId;
    const sess = id ? this.sessions.get(id) : this.sessions.values().next().value;
    if (!this.isSessionAlive(sess)) return null;

    const now = Date.now();
    if (this._lastShot && this._lastShot.accountId === sess.accountId && now - this._lastShot.time < 220) {
      return this._lastShot.data;
    }

    try {
      const buffer = await sess.page.screenshot({ type: 'jpeg', quality: 52, timeout: 2500 });
      const data = {
        accountId: sess.accountId,
        imageBase64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        url: sess.page.url(),
        browserState: sess.browserState,
        isLoggedIn: sess.browserState === 'READY',
        width: VIEWPORT_SIZE.width,
        height: VIEWPORT_SIZE.height
      };
      this._lastShot = { accountId: sess.accountId, time: now, data };
      return data;
    } catch {
      return null;
    }
  }

  async clickOnPage(xRatio, yRatio, accountId = null) {
    this.setViewerActive(true, 15000);
    const id = accountId || this.viewingAccountId;
    const sess = id ? this.sessions.get(id) : this.sessions.values().next().value;
    if (!this.isSessionAlive(sess)) return false;
    const x = Math.round(Math.max(0, Math.min(1, Number(xRatio))) * VIEWPORT_SIZE.width);
    const y = Math.round(Math.max(0, Math.min(1, Number(yRatio))) * VIEWPORT_SIZE.height);
    await sess.page.mouse.click(x, y);
    this._lastShot = null;
    return true;
  }

  async reloadPage(accountId = null) {
    this.setViewerActive(true, 15000);
    const id = accountId || this.viewingAccountId;
    const sess = id ? this.sessions.get(id) : this.sessions.values().next().value;
    if (!this.isSessionAlive(sess)) return false;
    await sess.page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.checkLoginStatus({ id: sess.accountId, name: sess.accountName });
    this._lastShot = null;
    return true;
  }

  async openChat(account, phone, contactName = '') {
    const ready = await this.ensureSessionReady(account);
    if (!ready.ok) throw new Error('Phiên Zalo chưa đăng nhập.');
    const sess = this.sessions.get(account.id);
    this.viewingAccountId = account.id;
    this.setViewerActive(true, 20000);
    const searchQuery = phone && phone !== 'Từ Zalo Web' ? phone : contactName || phone || '';
    const searchInput = sess.page
      .locator('#contact-search-input, [data-id="contact-search-input"], input[placeholder*="Tìm kiếm"]')
      .first();
    if (searchQuery && (await searchInput.count()) > 0) {
      await searchInput.click();
      await searchInput.fill(searchQuery);
      await sess.page.waitForTimeout(600);
      const firstResult = sess.page.locator('.conv-item, [data-id^="conv-item-"], .search-item').first();
      if ((await firstResult.count()) > 0) {
        await firstResult.click();
      } else {
        await sess.page.keyboard.press('Enter');
      }
    }
    return { ok: true };
  }

  async fetchInboundConversations(account) {
    const sess = this.sessions.get(account.id);
    if (!this.isSessionAlive(sess) || sess.browserState !== 'READY') return [];
    const IGNORED = ['my documents', 'zalo', 'thoi tiet', 'bao moi', 'zalo pay', 'zalopay', 'cloud cua toi', 'tin nhan tu nguoi la', 'zstyle', 'zbusiness'];

    const items = await sess.page
      .evaluate(() => {
        return Array.from(document.querySelectorAll('.conv-item.conv-rel, [data-id^="conv-item-"]')).map((el, idx) => {
          const threadId = el.getAttribute('data-id') || '';
          const titleEl = el.querySelector('.conv-item-title__name, .conv-item-title, [class*="title__name"]');
          const bodyEl = el.querySelector('.conv-item-body__main, .conv-message, [class*="body__main"]');
          const name = titleEl ? titleEl.innerText.replace(/\u00A0/g, ' ').trim() : '';
          const snippet = bodyEl ? bodyEl.innerText.replace(/\u00A0/g, ' ').trim() : '';
          const isFromMe = /^bạn\s*:/i.test(snippet) || /^you\s*:/i.test(snippet);
          return { threadId, name, snippet, isFromMe, sidebarRank: idx };
        });
      })
      .catch(() => []);

    return items.filter((item) => {
      if (!item.name || !item.snippet || item.isFromMe) return false;
      const lower = item.name.toLowerCase();
      if (IGNORED.some((ig) => lower.includes(ig))) return false;
      if (item.snippet === '[Tin nhắn đang đồng bộ]' || item.snippet.toLowerCase() === 'chưa có tin nhắn') return false;
      return true;
    });
  }

  async sendMessage({ account, contact, message, attachments = [], settings = {} }) {
    const sess = this.sessions.get(account.id);
    if (!this.isSessionAlive(sess) || sess.browserState !== 'READY') {
      return { status: 'LOI', reason: 'Phiên Zalo Web chưa mở hoặc chưa đăng nhập.' };
    }
    const page = sess.page;

    try {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(100);

      const addFriendSelectors = ['[data-id="btn_Main_AddFrd"]', '[title*="Thêm bạn"]', 'i.fa-outline-add-new-contact-2'];
      let opened = false;
      for (const sel of addFriendSelectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          await loc.click({ timeout: 2500 });
          opened = true;
          break;
        }
      }
      if (!opened) await page.mouse.click(266, 78);

      const phoneInput = await this._waitForLocator(page, ['input[data-id="txt_Main_AddFrd_Phone"]', 'input[placeholder*="Số điện thoại"]'], 1800);
      if (!phoneInput) {
        return { status: 'REVIEW', reason: 'Không mở được hộp thoại tìm SĐT — cần kiểm tra phiên Zalo' };
      }

      await phoneInput.click({ timeout: 3000 });
      await phoneInput.fill('');
      await phoneInput.pressSequentially(String(contact.phone), { delay: 35 });
      await page.waitForTimeout(150);

      await page.evaluate(() => {
        const btn = document.querySelector('[data-id="btn_Main_AddFrd_Search"]');
        if (btn && btn.offsetParent !== null) btn.click();
      });

      const lookup = await this._pollLookup(page, 3500);
      if (lookup.type === 'RATE_LIMITED') {
        await page.keyboard.press('Escape').catch(() => {});
        return { status: 'RATE_LIMITED', reason: lookup.reason };
      }
      if (lookup.type === 'NOT_REGISTERED') {
        await page.keyboard.press('Escape').catch(() => {});
        return { status: 'KHONG_DANG_KY', reason: lookup.reason };
      }
      if (lookup.type === 'TIMEOUT') {
        await page.keyboard.press('Escape').catch(() => {});
        return { status: 'REVIEW', reason: 'Hết thời gian chờ tìm SĐT (không vội kết luận chưa ĐK) — chuyển REVIEW' };
      }

      // KHÔNG tự bấm Kết bạn khi bị chặn người lạ (tuân thủ Roadmap V2 Mục 1)
      const clickedMsg = await page.evaluate(() => {
        const btn = document.querySelector('[data-id="btn_Main_AddFrd_Msg"]');
        if (btn && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
        return false;
      });
      if (!clickedMsg) {
        await page.keyboard.press('Escape').catch(() => {});
        return { status: 'LOI', zaloName: lookup.zaloName || '', reason: 'Tìm thấy hồ sơ nhưng không bấm được nút Nhắn tin' };
      }

      const chatInput = await this._waitForLocator(page, ['#richInput', 'div[contenteditable="true"]#richInput'], 2500);
      if (!chatInput) {
        return { status: 'CHAN_NGUOI_LA', zaloName: lookup.zaloName || '', reason: 'Khung chat bị khóa hoặc chặn người lạ' };
      }

      await chatInput.click({ timeout: 3000 });
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});

      if (message) {
        const lines = String(message).split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]) await page.keyboard.insertText(lines[i]);
          if (i < lines.length - 1) {
            await page.keyboard.down('Shift');
            await page.keyboard.press('Enter');
            await page.keyboard.up('Shift');
          }
        }
      }
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);

      const postBlocked = await page.evaluate(() => {
        const txt = (document.body?.innerText || '').toLowerCase();
        return ['chặn không nhận tin nhắn từ người lạ', 'chỉ nhận tin nhắn từ bạn bè'].some((p) => txt.includes(p));
      });
      if (postBlocked) {
        return {
          status: 'CHAN_NGUOI_LA',
          zaloName: lookup.zaloName || '',
          sentMessage: message,
          reason: 'Người nhận chặn tin nhắn từ người lạ'
        };
      }

      return {
        status: 'THANH_CONG',
        zaloName: lookup.zaloName || '',
        sentMessage: message,
        reason: 'Đã gửi tin nhắn thành công'
      };
    } catch (err) {
      return {
        status: 'REVIEW',
        sentMessage: message,
        reason: `Lỗi gián đoạn khi thao tác gửi (${err.message}) — chuyển REVIEW`
      };
    }
  }

  async _waitForLocator(page, selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          return loc;
        }
      }
      await page.waitForTimeout(100);
    }
    return null;
  }

  async _pollLookup(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    await page.waitForTimeout(250);
    while (Date.now() < deadline) {
      const check = await page.evaluate(() => {
        const msgBtn = document.querySelector('[data-id="btn_Main_AddFrd_Msg"]');
        if (msgBtn && msgBtn.offsetParent !== null) {
          const nameEl = document.querySelector('.pi-mini-info-section__name, .truncate');
          return { done: true, type: 'FOUND', zaloName: nameEl ? nameEl.innerText.trim() : '' };
        }
        const txt = (document.body?.innerText || '').toLowerCase();
        if (['tìm kiếm quá nhiều lần', 'quá số lần cho phép', 'giới hạn tìm kiếm', 'hoạt động bất thường'].some((p) => txt.includes(p))) {
          return { done: true, type: 'RATE_LIMITED', reason: 'Zalo cảnh báo giới hạn tần suất tìm kiếm' };
        }
        if (['chưa đăng ký tài khoản', 'không cho phép tìm kiếm', 'số điện thoại chưa đăng ký'].some((p) => txt.includes(p))) {
          return { done: true, type: 'NOT_REGISTERED', reason: 'SĐT chưa đăng ký Zalo hoặc chặn tìm kiếm' };
        }
        return { done: false };
      });
      if (check.done) return check;
      await page.waitForTimeout(120);
    }
    return { type: 'TIMEOUT' };
  }

  async closeSession(accountId) {
    const sess = this.sessions.get(accountId);
    if (sess) {
      if (sess.watcher) clearInterval(sess.watcher);
      this.sessions.delete(accountId);
      if (sess.context) await sess.context.close().catch(() => {});
    }
    this.onStatusChange(accountId, 'CLOSED', '');
    return { ok: true };
  }

  async closeAll() {
    for (const id of [...this.sessions.keys()]) {
      await this.closeSession(id);
    }
  }
}

module.exports = {
  ZaloWebAdapter
};
