const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const DEFAULT_ACCOUNTS = [
  {
    id: 'acc_default',
    name: 'Tài khoản Zalo #1 (Mặc định)',
    profileDir: 'zalo_profile',
    zaloProfileName: '',
    status: 'CLOSED',
    sentCount: 0,
    createdAt: new Date().toISOString()
  }
];

const DEFAULT_STATE = {
  settings: {
    template:
      '{Xin chào|Chào|Em chào} {ten},\nMình gửi bạn thông tin: {thong_tin}\nNếu cần hỗ trợ thêm bạn cứ phản hồi lại tin nhắn này nhé!',
    useCustomMessageFirst: true,
    fastPasteMode: true,
    // Tự động chuyển tài khoản: gửi xong tài khoản này tự động dùng tài khoản kế tiếp
    autoRotateAccounts: true,
    rotateEveryN: 15,
    attachedImages: [],
    minDelaySec: 12,
    maxDelaySec: 25,
    batchSize: 15,
    batchPauseSec: 120,
    usePhoneCache: false,
    autoAddFriendWhenBlocked: false,
    scheduleEnabled: false,
    scheduleStartAt: '',
    activeHoursEnabled: false,
    activeHourStart: '08:00',
    activeHourEnd: '21:30'
  },
  activeAccountId: 'acc_default',
  accounts: DEFAULT_ACCOUNTS,
  contacts: [],
  phoneCache: {},
  logs: []
};

class Storage {
  constructor() {
    this.ensureDir();
    this.state = this.load();
  }

  ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const accounts =
          Array.isArray(parsed.accounts) && parsed.accounts.length > 0
            ? parsed.accounts
            : DEFAULT_ACCOUNTS;
        const mergedSettings = { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) };
        if (mergedSettings.sendMode === 'MULTI_PARALLEL') {
          mergedSettings.sendMode = 'MULTI_BROADCAST';
        }
        return {
          settings: mergedSettings,
          activeAccountId: parsed.activeAccountId || accounts[0].id,
          accounts,
          contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
          phoneCache: parsed.phoneCache || {},
          logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-300) : []
        };
      }
    } catch (err) {
      console.error('Lỗi đọc database.json, khởi tạo mặc định:', err.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  save() {
    try {
      this.ensureDir();
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('Lỗi lưu database.json:', err.message);
    }
  }

  addLog(level, message, meta = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta
    };
    this.state.logs.push(entry);
    if (this.state.logs.length > 300) {
      this.state.logs = this.state.logs.slice(-300);
    }
    this.save();
    return entry;
  }

  getSettings() {
    return this.state.settings;
  }

  updateSettings(partial) {
    const next = {
      ...this.state.settings,
      ...partial
    };
    if (next.sendMode === 'MULTI_PARALLEL') {
      next.sendMode = 'MULTI_BROADCAST';
    }
    this.state.settings = next;
    this.save();
    return this.state.settings;
  }

  getAccounts() {
    return this.state.accounts;
  }

  getAccount(accountId) {
    if (!accountId) return null;
    return this.state.accounts.find((a) => a.id === accountId) || null;
  }

  getActiveAccount() {
    return (
      this.state.accounts.find((a) => a.id === this.state.activeAccountId) ||
      this.state.accounts[0]
    );
  }

  setActiveAccount(accountId) {
    const found = this.state.accounts.find((a) => a.id === accountId);
    if (!found) return null;
    this.state.activeAccountId = found.id;
    this.save();
    return found;
  }

  addAccount(name) {
    const id = `acc_${Date.now().toString(36)}`;
    const profileDir = `zalo_profile_${id}`;
    const newAcc = {
      id,
      name: String(name || `Tài khoản Zalo #${this.state.accounts.length + 1}`).trim(),
      profileDir,
      zaloProfileName: '',
      status: 'CLOSED',
      sentCount: 0,
      createdAt: new Date().toISOString()
    };
    this.state.accounts.push(newAcc);
    this.save();
    return newAcc;
  }

  updateAccount(accountId, patch) {
    const idx = this.state.accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) return null;
    this.state.accounts[idx] = {
      ...this.state.accounts[idx],
      ...patch
    };
    this.save();
    return this.state.accounts[idx];
  }

  incrementAccountSent(accountId) {
    const idx = this.state.accounts.findIndex((a) => a.id === accountId);
    if (idx !== -1) {
      this.state.accounts[idx].sentCount = (this.state.accounts[idx].sentCount || 0) + 1;
      this.save();
    }
  }

  deleteAccount(accountId) {
    if (this.state.accounts.length <= 1) {
      throw new Error('Phải giữ lại ít nhất 1 tài khoản Zalo.');
    }
    this.state.accounts = this.state.accounts.filter((a) => a.id !== accountId);
    if (this.state.activeAccountId === accountId) {
      this.state.activeAccountId = this.state.accounts[0].id;
    }
    this.save();
    return this.state.accounts;
  }

  getContacts() {
    return this.state.contacts;
  }

  getContact(id) {
    if (!id) return null;
    return this.state.contacts.find((c) => c.id === id) || null;
  }

  setContacts(contacts) {
    this.state.contacts = contacts;
    this.save();
  }

  /**
   * Nạp danh sách SĐT thông minh:
   * - Nếu SĐT đã tồn tại trong danh sách (ví dụ vừa gửi xong ở TK1, nay dán lại để gửi ở TK2),
   *   hệ thống tự động ĐẶT LẠI trạng thái của SĐT đó về PENDING và xóa kết quả cũ (`results = {}`)
   *   để tài khoản mới hoặc chiến dịch mới gửi lại ngay lập tức!
   */
  appendContacts(newContacts, deduplicate = true) {
    let addedOrResetCount = 0;

    if (!deduplicate) {
      const cleaned = newContacts.map((c) => ({ ...c, results: {} }));
      this.state.contacts.push(...cleaned);
      addedOrResetCount = cleaned.length;
    } else {
      const seenInBatch = new Set();
      for (const incoming of newContacts) {
        const key = incoming.phone || incoming.rawPhone;
        if (key && seenInBatch.has(key)) continue;
        if (key) seenInBatch.add(key);

        const existingIdx = this.state.contacts.findIndex(
          (c) => c.phone && c.phone === incoming.phone
        );

        if (existingIdx !== -1) {
          const existing = this.state.contacts[existingIdx];
          if (existing.status !== 'SAI_SO') {
            this.state.contacts[existingIdx] = {
              ...existing,
              name: incoming.name || existing.name,
              info: incoming.info || existing.info,
              customMessage: incoming.customMessage || existing.customMessage,
              note: incoming.note || existing.note,
              status: 'PENDING',
              results: {},
              sentByAccount: '',
              sentMessage: '',
              reason: 'Đang chờ xử lý (Đã nạp lại)',
              updatedAt: new Date().toISOString()
            };
            addedOrResetCount++;
          }
        } else {
          this.state.contacts.push({ ...incoming, results: {} });
          addedOrResetCount++;
        }
      }
    }

    this.save();
    return { contacts: this.state.contacts, addedOrResetCount };
  }

  updateContact(id, patch) {
    const idx = this.state.contacts.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    this.state.contacts[idx] = {
      ...this.state.contacts[idx],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    const updated = this.state.contacts[idx];

    if (
      updated.phone &&
      !String(updated.reason || '').includes('[Chạy thử]') &&
      ['THANH_CONG', 'CHAN_NGUOI_LA', 'KHONG_DANG_KY'].includes(updated.status)
    ) {
      this.state.phoneCache[updated.phone] = {
        status: updated.status,
        zaloName: updated.zaloName || '',
        reason: updated.reason || '',
        lastCheckedAt: updated.updatedAt
      };
    }

    this.save();
    return updated;
  }

  clearPhoneCache() {
    this.state.phoneCache = {};
    this.save();
    return this.state.phoneCache;
  }

  releaseStuckContacts() {
    let changed = false;
    for (const c of this.state.contacts) {
      if (c.status === 'PROCESSING') {
        c.status = 'PENDING';
        c.reason = 'Đang chờ xử lý';
        c.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  resetContactsStatus(filterStatus = 'ALL') {
    for (const c of this.state.contacts) {
      if (c.status !== 'SAI_SO' && (filterStatus === 'ALL' || c.status === filterStatus)) {
        c.status = 'PENDING';
        c.results = {};
        c.sentByAccount = '';
        c.reason = 'Đang chờ xử lý';
        c.sentMessage = '';
        c.updatedAt = new Date().toISOString();
      }
    }
    this.save();
    return this.state.contacts;
  }

  /**
   * Chuẩn bị danh sách SĐT trước khi bắt đầu chiến dịch:
   * 1. Nếu đang tạm dừng (wasPaused = true) và còn SĐT đang PENDING -> chạy tiếp các SĐT đang PENDING.
   * 2. Nếu có SĐT đang PENDING -> tiếp tục xử lý các SĐT PENDING đó.
   * 3. Nếu không còn SĐT nào PENDING (đã gửi hết từ lần trước) -> Tự động đặt lại toàn bộ SĐT hợp lệ về PENDING để gửi lượt mới!
   */
  prepareContactsForCampaign({ wasPaused } = {}) {
    this.releaseStuckContacts();
    const validContacts = this.state.contacts.filter((c) => c.status !== 'SAI_SO');
    if (validContacts.length === 0) {
      return { runnableCount: 0, autoReset: false };
    }

    if (wasPaused) {
      const remaining = validContacts.filter((c) => c.status === 'PENDING').length;
      if (remaining > 0) {
        return { runnableCount: remaining, autoReset: false };
      }
    }

    const pendingList = validContacts.filter((c) => c.status === 'PENDING');
    if (pendingList.length > 0) {
      return { runnableCount: pendingList.length, autoReset: false };
    }

    // Nếu không còn SĐT nào PENDING -> Tự động Reset toàn bộ SĐT hợp lệ về PENDING
    this.resetContactsStatus('ALL');
    return { runnableCount: validContacts.length, autoReset: true };
  }

  clearContacts() {
    this.state.contacts = [];
    this.save();
  }

  clearCache() {
    this.state.phoneCache = {};
    this.save();
  }

  getStats() {
    const contacts = this.state.contacts;
    const stats = {
      total: contacts.length,
      pending: 0,
      processing: 0,
      success: 0,
      blockedStranger: 0,
      notRegistered: 0,
      invalidPhone: 0,
      error: 0,
      cacheCount: Object.keys(this.state.phoneCache || {}).length
    };

    for (const c of contacts) {
      switch (c.status) {
        case 'PENDING':
          stats.pending++;
          break;
        case 'PROCESSING':
          stats.processing++;
          break;
        case 'THANH_CONG':
          stats.success++;
          break;
        case 'CHAN_NGUOI_LA':
          stats.blockedStranger++;
          break;
        case 'KHONG_DANG_KY':
          stats.notRegistered++;
          break;
        case 'SAI_SO':
          stats.invalidPhone++;
          break;
        default:
          stats.error++;
          break;
      }
    }

    return stats;
  }
}

module.exports = new Storage();
