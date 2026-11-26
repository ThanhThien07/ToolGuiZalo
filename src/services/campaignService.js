const EventEmitter = require('events');
const campaignRepo = require('../db/repositories/campaignRepo');
const taskRepo = require('../db/repositories/taskRepo');
const contactRepo = require('../db/repositories/contactRepo');
const consentRepo = require('../db/repositories/consentRepo');
const { accountRepo, settingsRepo } = require('../db/repositories/accountRepo');
const { writeAudit } = require('../db/repositories/common');
const { renderMessage } = require('../templateEngine');
const { ZaloOfficialAdapter } = require('../adapters/zaloOfficialAdapter');
const { MockSandboxAdapter } = require('../adapters/mockSandboxAdapter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Dịch vụ Chiến dịch & Điều phối Tác vụ Bền vững (Roadmap Mục 1, 8):
 * - Tạo chiến dịch có phê duyệt & lịch sử độc lập (`campaigns`, `campaign_contacts`).
 * - Chỉ liên hệ các SĐT đã `OPTED_IN` (khi `requireOptInConsent` bật) và LUÔN chặn `OPTED_OUT`.
 * - Giao dịch nhận việc an toàn (`taskRepo.claimNextTask`), heartbeat định kỳ.
 * - Khi gặp `RATE_LIMITED`: DỪNG ngay chiến dịch (KHÔNG nhảy sang nick khác để né giới hạn nền tảng).
 * - Khi kết quả thao tác ngoài không rõ: chuyển trạng thái `REVIEW` (KHÔNG tự gửi lại).
 */
class CampaignService extends EventEmitter {
  constructor() {
    super();
    this.activeRunners = new Map(); // campaignId -> { cancelled: boolean }
    this.mockAdapter = new MockSandboxAdapter();
    this.oaAdapter = new ZaloOfficialAdapter();
    this.webSender = null; // Gắn từ ZaloBot / AgentManager
    this.scheduleTimer = null;
  }

  setWebSender(fn) {
    this.webSender = fn;
  }

  getAdapter(channel) {
    if (channel === 'mock_sandbox') return this.mockAdapter;
    if (channel === 'zalo_oa') return this.oaAdapter;
    if (this.webSender) {
      return {
        ensureSessionReady: (acc) => this.webSender.ensureSessionReady(acc),
        sendMessage: (payload) => this.webSender.sendMessage(payload)
      };
    }
    throw new Error('Kênh web_assisted chưa sẵn sàng.');
  }

  createCampaign({
    name,
    channel = 'web_assisted',
    accountId = null,
    templateId = null,
    templateBody = null,
    scheduledAt = null,
    contactIds = null,
    requireOptInConsent = undefined,
    createdBy = null,
    autoApprove = false
  }) {
    const settings = settingsRepo.getAppSettings();
    const activeAcc = accountId ? accountRepo.getById(accountId) : accountRepo.getActive();
    if (!activeAcc) throw new Error('Không tìm thấy tài khoản gửi.');

    const resolvedChannel =
      channel === 'auto'
        ? this.oaAdapter.isConfigured()
          ? 'zalo_oa'
          : settings.channelMode || 'web_assisted'
        : channel;

    const resolvedBody = templateBody ?? settings.template ?? '';
    const enforceConsent = requireOptInConsent !== undefined ? Boolean(requireOptInConsent) : settings.requireOptInConsent !== false;

    const campaign = campaignRepo.create({
      name: name || `Chiến dịch ${new Date().toLocaleString('vi-VN')}`,
      channel: resolvedChannel,
      accountId: activeAcc.id,
      templateId,
      templateBody: resolvedBody,
      settingsSnapshot: { ...settings, requireOptInConsent: enforceConsent },
      scheduledAt,
      createdBy,
      status: autoApprove ? 'APPROVED' : 'DRAFT'
    });

    const allContacts = contactRepo.getAll().filter((c) => {
      if (contactIds && Array.isArray(contactIds) && contactIds.length > 0) {
        return contactIds.includes(c.id);
      }
      return c.status !== 'SAI_SO' && c.status !== 'OPTED_OUT' && c.phone !== 'Từ Zalo Web';
    });

    const ccEntries = [];
    const taskEntries = [];

    for (const c of allContacts) {
      const consentCheck = consentRepo.canMessagePhone(c.phone, { requireOptIn: enforceConsent });
      const renderedMessage = renderMessage(resolvedBody, c, {
        useCustomMessageFirst: settings.useCustomMessageFirst !== false
      });

      if (!consentCheck.allowed) {
        ccEntries.push({
          contactId: c.id,
          phone: c.phone,
          renderedMessage,
          status: 'SKIPPED_OPT_OUT',
          reason: consentCheck.reason,
          accountId: activeAcc.id
        });
      } else {
        const ccId = `cc_${campaign.id.slice(0, 12)}_${c.id.slice(0, 12)}`;
        ccEntries.push({
          id: ccId,
          contactId: c.id,
          phone: c.phone,
          renderedMessage,
          status: 'PENDING',
          reason: 'Sẵn sàng gửi',
          accountId: activeAcc.id
        });
        taskEntries.push({
          campaignContactId: ccId,
          contactId: c.id,
          phone: c.phone,
          accountId: activeAcc.id,
          renderedMessage,
          idempotencyKey: `${campaign.id}:${c.id}:attempt1`
        });
      }
    }

    campaignRepo.addContacts(campaign.id, ccEntries);
    const queuedCount = taskRepo.enqueueCampaignTasks(campaign.id, taskEntries);

    return {
      campaign: campaignRepo.getById(campaign.id),
      queuedTasks: queuedCount,
      skippedByConsent: ccEntries.length - taskEntries.length
    };
  }

  approveCampaign(campaignId, { userId = null, actor = 'admin' } = {}) {
    return campaignRepo.updateStatus(campaignId, 'APPROVED', { approvedBy: userId, actor });
  }

  async runCampaign(campaignId, { actor = 'operator', waitForCompletion = false } = {}) {
    const campaign = campaignRepo.getById(campaignId);
    if (!campaign) throw new Error('Không tìm thấy chiến dịch.');
    if (!['APPROVED', 'DRAFT', 'PAUSED', 'SCHEDULED'].includes(campaign.status)) {
      return campaign;
    }
    if (this.activeRunners.has(campaignId)) {
      return campaign;
    }

    const account = accountRepo.getById(campaign.accountId) || accountRepo.getActive();
    const adapter = this.getAdapter(campaign.channel);
    const ready = await adapter.ensureSessionReady(account);
    if (!ready.ok) {
      throw new Error(ready.reason || `Tài khoản "${account.name}" chưa sẵn sàng.`);
    }

    campaignRepo.updateStatus(campaignId, 'RUNNING', { actor });
    const runnerState = { cancelled: false };
    this.activeRunners.set(campaignId, runnerState);

    const execPromise = this._runLoop(campaignId, account, adapter, runnerState).finally(() => {
      this.activeRunners.delete(campaignId);
    });

    if (waitForCompletion) {
      await execPromise;
    } else {
      execPromise.catch(() => {});
    }

    return campaignRepo.getById(campaignId);
  }

  async _runLoop(campaignId, account, adapter, runnerState) {
    const workerId = `wrk_${account.id}_${process.pid}`;
    let processedInBatch = 0;

    while (!runnerState.cancelled) {
      const currentCmp = campaignRepo.getById(campaignId);
      if (!currentCmp || currentCmp.status !== 'RUNNING') break;

      const settings = currentCmp.settingsSnapshot || settingsRepo.getAppSettings();
      if (settings.activeHoursEnabled && !this._isWithinActiveHours(settings)) {
        await sleep(30000);
        continue;
      }

      const task = taskRepo.claimNextTask({
        campaignId,
        workerId,
        accountId: account.id,
        leaseMs: 90000
      });
      if (!task) {
        campaignRepo.updateStatus(campaignId, 'COMPLETED', { stopReason: 'Đã xử lý xong toàn bộ tác vụ' });
        this.emit('campaign_completed', { campaignId });
        break;
      }

      // Kiểm tra lại consent ngay tại thời điểm trước khi gửi (Global Opt-Out có thể vừa cập nhật!)
      const enforceConsent = settings.requireOptInConsent !== false;
      const consentCheck = consentRepo.canMessagePhone(task.phone, { requireOptIn: enforceConsent });
      if (!consentCheck.allowed) {
        taskRepo.finalizeTask(task.id, {
          finalStatus: 'CANCELLED',
          resultCode: 'OPTED_OUT',
          reason: consentCheck.reason,
          accountId: account.id,
          accountName: account.name
        });
        continue;
      }

      const started = taskRepo.startProcessing(task.id, { workerId, accountId: account.id });
      if (!started) continue;

      const contact = contactRepo.getById(task.contactId) || { phone: task.phone, name: task.contactName };
      let outcome;
      try {
        // Check phone cache cho số KHONG_DANG_KY trước khi chạm nền tảng
        const cached = settings.usePhoneCache ? contactRepo.getPhoneCache(task.phone) : null;
        if (cached && cached.status === 'KHONG_DANG_KY') {
          outcome = {
            status: 'KHONG_DANG_KY',
            reason: `${cached.reason || 'Chưa ĐK Zalo'} (từ Cache)`,
            sentMessage: ''
          };
        } else {
          outcome = await adapter.sendMessage({
            account,
            contact,
            message: task.sentMessage || '',
            attachments: settings.attachedImages || [],
            settings,
            idempotencyKey: task.idempotencyKey
          });
        }
      } catch (err) {
        outcome = {
          status: 'REVIEW',
          reason: `Ngoại lệ khi gọi kênh gửi: ${err.message} — chuyển REVIEW`,
          sentMessage: task.sentMessage
        };
      }

      if (outcome.status === 'RATE_LIMITED') {
        // KHÔNG chuyển sang tài khoản khác để vượt giới hạn — dừng chiến dịch an toàn!
        taskRepo.finalizeTask(task.id, {
          finalStatus: 'REVIEW',
          resultCode: 'RATE_LIMITED',
          reason: outcome.reason || 'Nền tảng báo giới hạn — đã tạm dừng chiến dịch',
          accountId: account.id,
          accountName: account.name,
          attemptId: started.attemptId
        });
        campaignRepo.updateStatus(campaignId, 'PAUSED', {
          stopReason: 'Nền tảng báo giới hạn tần suất (RATE_LIMITED) — dừng chiến dịch để tuân thủ chính sách'
        });
        writeAudit({
          action: 'campaign.stopped_rate_limit',
          resourceType: 'campaign',
          resourceId: campaignId,
          details: { accountId: account.id, reason: outcome.reason }
        });
        break;
      }

      if (outcome.status === 'KHONG_DANG_KY') {
        contactRepo.setPhoneCache(task.phone, 'KHONG_DANG_KY', outcome.reason);
      }

      if (outcome.status === 'THANH_CONG') {
        accountRepo.incrementSent(account.id);
      }

      const finalTaskStatus =
        outcome.status === 'THANH_CONG' ||
        outcome.status === 'CHAN_NGUOI_LA' ||
        outcome.status === 'KHONG_DANG_KY'
          ? 'COMPLETED'
          : outcome.status === 'REVIEW'
          ? 'REVIEW'
          : 'FAILED';

      taskRepo.finalizeTask(task.id, {
        finalStatus: finalTaskStatus,
        resultCode: outcome.status,
        reason: outcome.reason || outcome.status,
        zaloName: outcome.zaloName || '',
        sentMessage: outcome.sentMessage || '',
        accountId: account.id,
        accountName: account.name,
        attemptId: started.attemptId
      });

      this.emit('task_processed', { campaignId, taskId: task.id, outcome });

      processedInBatch++;
      // Với mock_sandbox dùng delay tối thiểu hoặc configurable để test nhanh; với kênh thật ép min >= 5s
      if (currentCmp.channel !== 'mock_sandbox') {
        const minSec = Math.max(5, Number(settings.minDelaySec ?? 12));
        const maxSec = Math.max(minSec, Number(settings.maxDelaySec ?? 25));
        const batchSize = Math.max(1, Number(settings.batchSize ?? 15));
        const batchPause = Math.max(30, Number(settings.batchPauseSec ?? 120));
        const waitSec =
          processedInBatch % batchSize === 0
            ? batchPause
            : minSec + Math.floor(Math.random() * (maxSec - minSec + 1));
        await sleep(waitSec * 1000);
      }
    }
  }

  pauseCampaign(campaignId, { actor = 'operator' } = {}) {
    const runner = this.activeRunners.get(campaignId);
    if (runner) runner.cancelled = true;
    return campaignRepo.updateStatus(campaignId, 'PAUSED', { actor, stopReason: 'Người dùng tạm dừng' });
  }

  cancelCampaign(campaignId, { actor = 'operator' } = {}) {
    const runner = this.activeRunners.get(campaignId);
    if (runner) runner.cancelled = true;
    taskRepo.cancelCampaignTasks(campaignId, 'Chiến dịch bị hủy');
    return campaignRepo.updateStatus(campaignId, 'CANCELLED', { actor, stopReason: 'Người dùng hủy chiến dịch' });
  }

  startScheduler() {
    if (this.scheduleTimer) return;
    this.scheduleTimer = setInterval(() => {
      const nowIso = new Date().toISOString();
      const scheduled = campaignRepo.list({ status: 'SCHEDULED', limit: 20 });
      for (const cmp of scheduled) {
        if (cmp.scheduledAt && cmp.scheduledAt <= nowIso) {
          this.runCampaign(cmp.id, { actor: 'scheduler' }).catch(() => {});
        }
      }
    }, 5000);
  }

  stopScheduler() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  _isWithinActiveHours(settings) {
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
}

module.exports = new CampaignService();
