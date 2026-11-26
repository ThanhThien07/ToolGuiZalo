const EventEmitter = require('events');
const storage = require('./storage');
const agentManager = require('./agent/agentManager');
const campaignService = require('./services/campaignService');
const campaignRepo = require('./db/repositories/campaignRepo');
const taskRepo = require('./db/repositories/taskRepo');
const contactRepo = require('./db/repositories/contactRepo');
const conversationRepo = require('./db/repositories/conversationRepo');
const { accountRepo } = require('./db/repositories/accountRepo');

/**
 * ZaloBot V2 Facade:
 * Giữ sự kiện SSE/log tương thích V1 và điều phối xuống AgentManager + CampaignService + Repositories.
 */
class ZaloBotV2 extends EventEmitter {
  constructor() {
    super();
    this.viewingAccountId = null;
    this._replyTimer = null;
    this._activeCampaignId = null;

    agentManager.on('session_status', ({ accountId, status }) => {
      this.emit('status', this.getStatus());
    });

    campaignService.setWebSender({
      ensureSessionReady: async (account) => agentManager.call('ensureSessionReady', { account }),
      sendMessage: async (payload) => agentManager.call('sendMessage', payload)
    });

    campaignService.on('task_processed', ({ taskId }) => {
      const task = taskRepo.getById(taskId);
      if (task) {
        const contact = contactRepo.getById(task.contactId);
        if (contact) this.emit('contact_updated', contact);
      }
      this.emit('status', this.getStatus());
    });

    campaignService.on('campaign_completed', () => {
      this.emit('status', this.getStatus());
    });
  }

  init() {
    storage.init();
    const active = accountRepo.getActive();
    this.viewingAccountId = active ? active.id : null;
    taskRepo.recoverInterruptedTasks({ actor: 'startup_recovery' });
    campaignService.startScheduler();
  }

  log(level, message, meta = {}) {
    const entry = storage.addLog(level, message, meta);
    this.emit('log', entry);
    return entry;
  }

  getStatus() {
    const accounts = accountRepo.list();
    const activeAcc = accountRepo.getActive() || accounts[0];
    const runningCmp = campaignRepo.list({ status: 'RUNNING', limit: 1 })[0] || null;
    const stats = contactRepo.getStats();

    return {
      browserState: activeAcc ? activeAcc.status : 'CLOSED',
      campaignState: runningCmp ? 'RUNNING' : 'IDLE',
      activeCampaignId: runningCmp ? runningCmp.id : null,
      activeAccountId: activeAcc ? activeAcc.id : 'acc_default',
      activeAccountName: activeAcc ? activeAcc.name : 'Zalo Web',
      viewingAccountId: this.viewingAccountId || (activeAcc ? activeAcc.id : null),
      readyAccountsCount: accounts.filter((a) => a.status === 'READY').length,
      accounts,
      countdownSec: 0,
      scheduleCountdownSec: 0,
      stats
    };
  }

  async launchBrowser(targetAccountId, { makeActive = false, setViewing = true } = {}) {
    const acc = accountRepo.getById(targetAccountId) || accountRepo.getActive();
    if (!acc) throw new Error('Không tìm thấy tài khoản.');
    if (makeActive) accountRepo.setActive(acc.id);
    if (setViewing || makeActive) this.viewingAccountId = acc.id;
    agentManager.start();
    await agentManager.call('ensureSessionReady', { account: acc }, 65000);
    return this.getStatus();
  }

  async launchAllAccounts() {
    agentManager.start();
    const accounts = accountRepo.list();
    await Promise.allSettled(accounts.map((acc) => agentManager.call('ensureSessionReady', { account: acc }, 65000)));
    return this.getStatus();
  }

  async switchAccount(accountId) {
    const target = accountRepo.setActive(accountId);
    if (!target) throw new Error('Không tìm thấy tài khoản.');
    this.viewingAccountId = target.id;
    return this.getStatus();
  }

  async getLiveScreenshot(accountId = null, forceViewer = false) {
    return agentManager.call('getLiveScreenshot', {
      accountId: accountId || this.viewingAccountId,
      forceViewer
    });
  }

  async setViewerActive(active, ttlMs = 15000) {
    return agentManager.call('setViewerActive', { active, ttlMs });
  }

  async clickOnPage(xRatio, yRatio, accountId = null) {
    return agentManager.call('clickOnPage', {
      xRatio,
      yRatio,
      accountId: accountId || this.viewingAccountId
    });
  }

  async reloadZaloPage(accountId = null) {
    return agentManager.call('reloadPage', { accountId: accountId || this.viewingAccountId });
  }

  async closeBrowser(accountId) {
    return agentManager.call('closeSession', { accountId });
  }

  async closeAllBrowsers() {
    return agentManager.call('closeAll', {});
  }

  async checkReplies(targetAccountId = null) {
    const accounts = accountRepo.list().filter((a) => (!targetAccountId || a.id === targetAccountId) && a.status === 'READY');
    let foundCount = 0;
    for (const acc of accounts) {
      try {
        const inbound = await agentManager.call('fetchInboundConversations', { account: acc });
        for (const item of inbound) {
          const res = conversationRepo.recordInboundOrOutbound({
            externalThreadId: item.threadId || null,
            accountId: acc.id,
            customerName: item.name,
            body: item.snippet,
            direction: 'INBOUND',
            channel: 'zalo_web',
            sidebarRank: item.sidebarRank
          });
          if (res.isNewMessage) {
            foundCount++;
            this.emit('reply_received', {
              conversation: res.conversation,
              contact: res.conversation,
              replyText: item.snippet,
              accountName: acc.name,
              replyAt: res.conversation.lastMessageAt
            });
          }
        }
      } catch {}
    }
    const { items } = conversationRepo.list({ limit: 200 });
    return { ok: true, foundCount, replies: items };
  }

  async openChat(accountId, phone, contactName = '') {
    const acc = accountRepo.getById(accountId) || accountRepo.getActive();
    await agentManager.call('openChat', { account: acc, phone, contactName });
    this.viewingAccountId = acc.id;
    return this.getStatus();
  }

  async startCampaign(options = {}) {
    const { campaign } = campaignService.createCampaign({
      accountId: options.accountId,
      channel: options.channel || 'web_assisted',
      autoApprove: true
    });
    this._activeCampaignId = campaign.id;
    await campaignService.runCampaign(campaign.id);
    return this.getStatus();
  }

  pauseCampaign() {
    if (this._activeCampaignId) {
      campaignService.pauseCampaign(this._activeCampaignId);
    }
    const running = campaignRepo.list({ status: 'RUNNING', limit: 10 });
    for (const r of running) {
      campaignService.pauseCampaign(r.id);
    }
    return this.getStatus();
  }
}

module.exports = new ZaloBotV2();
