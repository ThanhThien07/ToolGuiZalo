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
    // Chế độ điều phối tác vụ (Task Orchestrator): ROUND_ROBIN (Luân phiên) | PARALLEL (Song song đa luồng) | SINGLE (1 tài khoản)
    sendMode: 'ROUND_ROBIN',
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
        const rawContacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
        const contacts = this.deduplicateContacts(rawContacts).map((c) => {
          if (c.hasReplied || c.replyText) {
            return {
              ...c,
              replyNotified: true,
              replySeen: c.replySeen !== undefined ? c.replySeen : true,
              knownReplySnippets: Array.isArray(c.knownReplySnippets)
                ? c.knownReplySnippets
                : c.replyText
                ? [c.replyText]
                : []
            };
          }
          return c;
        });
        return {
          settings: mergedSettings,
          activeAccountId: parsed.activeAccountId || accounts[0].id,
          accounts,
          contacts,
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
      this.state.lastUpdated = new Date().toISOString();
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('Lỗi lưu database.json:', err.message);
    }
  }

  getLastUpdated() {
    return this.state.lastUpdated || new Date(0).toISOString();
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
    this.state.settingsUpdatedAt = new Date().toISOString();
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

  deduplicateContacts(contacts) {
    if (!Array.isArray(contacts)) return [];
    const byKey = new Map();
    for (const c of contacts) {
      if (!c) continue;
      const isFromZaloWeb = !c.phone || c.phone === 'Từ Zalo Web';
      const normName = String(c.name || c.zaloName || '')
        .toLowerCase()
        .trim();
      const key = isFromZaloWeb
        ? `zaloweb__${normName}__${c.replyByAccountId || c.replyByAccount || ''}`
        : `phone__${c.phone}`;

      if (!byKey.has(key)) {
        // Check if same ID already exists
        let existingKey = null;
        for (const [k, val] of byKey.entries()) {
          if (val.id && val.id === c.id) {
            existingKey = k;
            break;
          }
        }
        if (existingKey) {
          const prev = byKey.get(existingKey);
          const prevTime = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
          const curTime = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
          const snippets = Array.from(
            new Set([
              ...(prev.knownReplySnippets || []),
              ...(c.knownReplySnippets || []),
              prev.replyText,
              c.replyText
            ].filter(Boolean))
          );
          byKey.set(
            existingKey,
            curTime >= prevTime
              ? { ...prev, ...c, knownReplySnippets: snippets }
              : { ...c, ...prev, knownReplySnippets: snippets }
          );
        } else {
          const snippets = Array.from(
            new Set([...(c.knownReplySnippets || []), c.replyText].filter(Boolean))
          );
          byKey.set(key, { ...c, knownReplySnippets: snippets });
        }
      } else {
        const prev = byKey.get(key);
        const prevTime = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
        const curTime = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
        const snippets = Array.from(
          new Set([
            ...(prev.knownReplySnippets || []),
            ...(c.knownReplySnippets || []),
            prev.replyText,
            c.replyText
          ].filter(Boolean))
        );
        byKey.set(
          key,
          curTime >= prevTime
            ? { ...prev, ...c, id: prev.id, knownReplySnippets: snippets }
            : { ...c, ...prev, id: prev.id, knownReplySnippets: snippets }
        );
      }
    }
    return Array.from(byKey.values());
  }

  addContact(contactData) {
    const isFromZaloWeb = !contactData.phone || contactData.phone === 'Từ Zalo Web';
    const normName = String(contactData.name || contactData.zaloName || '')
      .toLowerCase()
      .trim();

    const existingIdx = this.state.contacts.findIndex((c) => {
      if (contactData.id && c.id === contactData.id) return true;
      if (!isFromZaloWeb && c.phone === contactData.phone) return true;
      if (isFromZaloWeb && (!c.phone || c.phone === 'Từ Zalo Web')) {
        const cName = String(c.name || c.zaloName || '')
          .toLowerCase()
          .trim();
        return (
          cName === normName &&
          (c.replyByAccountId || '') === (contactData.replyByAccountId || '')
        );
      }
      return false;
    });

    if (existingIdx !== -1) {
      return this.updateContact(this.state.contacts[existingIdx].id, contactData);
    }

    const contact = {
      id: contactData.id || `ct_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: contactData.name || '',
      phone: contactData.phone || '',
      rawPhone: contactData.rawPhone || contactData.phone || '',
      info: contactData.info || '',
      customMessage: contactData.customMessage || '',
      note: contactData.note || '',
      status: contactData.status || 'PENDING',
      zaloName: contactData.zaloName || '',
      sentMessage: contactData.sentMessage || '',
      results: contactData.results || {},
      hasReplied: Boolean(contactData.hasReplied),
      replyText: contactData.replyText || '',
      replyAt: contactData.replyAt || new Date().toISOString(),
      replyByAccount: contactData.replyByAccount || '',
      replyByAccountId: contactData.replyByAccountId || '',
      replyNotified: Boolean(contactData.replyNotified),
      replySeen: Boolean(contactData.replySeen),
      knownReplySnippets: Array.isArray(contactData.knownReplySnippets)
        ? contactData.knownReplySnippets
        : contactData.replyText
        ? [contactData.replyText]
        : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.state.contacts.push(contact);
    this.save();
    return contact;
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
      updated.phone !== 'Từ Zalo Web' &&
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

  /**
   * Hợp nhất dữ liệu thông minh giữa các máy trong mạng LAN (Multi-Node LWW Merge)
   * Luôn lấy bản cập nhật mới nhất theo thời gian (Last-Write-Wins), không bị ghi đè mất dữ liệu.
   */
  mergeRemoteData(remoteState) {
    if (!remoteState) return { changed: false, updatedContactsCount: 0, newContactsCount: 0 };
    let changed = false;
    let updatedContactsCount = 0;
    let newContactsCount = 0;

    // 1. Đồng bộ Cấu hình (Settings) theo thời điểm mới nhất
    const remoteSettingsTime = remoteState.settingsUpdatedAt ? new Date(remoteState.settingsUpdatedAt).getTime() : 0;
    const localSettingsTime = this.state.settingsUpdatedAt ? new Date(this.state.settingsUpdatedAt).getTime() : 0;
    if (remoteSettingsTime > localSettingsTime && remoteState.settings) {
      this.state.settings = { ...this.state.settings, ...remoteState.settings };
      this.state.settingsUpdatedAt = remoteState.settingsUpdatedAt;
      changed = true;
    }

    // 2. Đồng bộ Danh sách người nhận (Contacts)
    if (Array.isArray(remoteState.contacts) && remoteState.contacts.length > 0) {
      for (const remC of remoteState.contacts) {
        if (!remC.phone && !remC.id) continue;
        const normPhone = remC.phone || remC.rawPhone;
        const isRealPhone = normPhone && normPhone !== 'Từ Zalo Web';
        const remNormName = String(remC.name || remC.zaloName || '')
          .toLowerCase()
          .trim();

        const localIdx = this.state.contacts.findIndex((c) => {
          if (remC.id && c.id === remC.id) return true;
          if (isRealPhone && c.phone === normPhone) return true;
          if (!isRealPhone && (!c.phone || c.phone === 'Từ Zalo Web')) {
            const locNormName = String(c.name || c.zaloName || '')
              .toLowerCase()
              .trim();
            return (
              locNormName === remNormName &&
              (c.replyByAccountId || '') === (remC.replyByAccountId || '')
            );
          }
          return false;
        });

        if (localIdx !== -1) {
          const locC = this.state.contacts[localIdx];
          const remTime = remC.updatedAt ? new Date(remC.updatedAt).getTime() : 0;
          const locTime = locC.updatedAt ? new Date(locC.updatedAt).getTime() : 0;

          // Nếu bản từ máy kia mới hơn bản trên máy này
          if (remTime > locTime) {
            const mergedResults = { ...(locC.results || {}), ...(remC.results || {}) };
            this.state.contacts[localIdx] = {
              ...locC,
              ...remC,
              results: mergedResults,
              updatedAt: remC.updatedAt || new Date().toISOString()
            };
            updatedContactsCount++;
            changed = true;
          } else {
            // Ngay cả khi bản local mới hơn, nếu máy kia có kết quả gửi của nick mới, gộp vào!
            if (remC.results && Object.keys(remC.results).length > 0) {
              const prevResultsKeys = Object.keys(locC.results || {});
              const newResults = { ...(remC.results || {}), ...(locC.results || {}) };
              if (Object.keys(newResults).length > prevResultsKeys.length) {
                locC.results = newResults;
                changed = true;
              }
            }
            // Nếu máy kia có phản hồi mới từ khách hàng mà máy này chưa có
            if (remC.hasReplied && !locC.hasReplied) {
              locC.hasReplied = true;
              locC.replyText = remC.replyText;
              locC.replyAt = remC.replyAt;
              locC.replyByAccount = remC.replyByAccount;
              locC.replyByAccountId = remC.replyByAccountId;
              changed = true;
            }
          }
        } else {
          // Contact mới hoàn toàn từ máy khác -> thêm vào máy này!
          this.state.contacts.push({
            ...remC,
            results: remC.results || {}
          });
          newContactsCount++;
          changed = true;
        }
      }
    }

    if (changed) {
      this.state.lastUpdated = new Date().toISOString();
      this.save();
    }

    return {
      changed,
      updatedContactsCount,
      newContactsCount,
      totalContacts: this.state.contacts.length
    };
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
