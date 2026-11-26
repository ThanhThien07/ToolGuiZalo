const { ChannelAdapter } = require('./channelAdapter');

/**
 * Mock Sandbox Adapter cho kiểm thử tải, tích hợp và pilot (Roadmap Mục 15):
 * "Dùng mock/sandbox cho kiểm thử tải, không gửi tin thật hàng loạt."
 */
class MockSandboxAdapter extends ChannelAdapter {
  constructor() {
    super('mock_sandbox');
    this.sessions = new Map();
    this.sentHistory = [];
    this.scriptedOutcomes = new Map(); // phone -> { status, reason }
  }

  setScriptedOutcome(phone, outcome) {
    this.scriptedOutcomes.set(String(phone), outcome);
  }

  reset() {
    this.sentHistory = [];
    this.scriptedOutcomes.clear();
  }

  async ensureSessionReady(account) {
    this.sessions.set(account.id, { status: 'READY', profileName: `${account.name} (Sandbox)` });
    return { ok: true, status: 'READY', profileName: `${account.name} (Sandbox)` };
  }

  async sendMessage({ account, contact, message, attachments = [], idempotencyKey }) {
    const custom = this.scriptedOutcomes.get(String(contact.phone));
    if (custom) {
      return {
        status: custom.status,
        zaloName: custom.zaloName || contact.name || 'Sandbox User',
        reason: custom.reason || `Sandbox scripted: ${custom.status}`,
        sentMessage: custom.status === 'THANH_CONG' ? message : ''
      };
    }

    // Nếu số kết thúc bằng 999 -> mô phỏng RATE_LIMITED; 888 -> REVIEW; 777 -> CHAN_NGUOI_LA; 666 -> KHONG_DANG_KY
    const ph = String(contact.phone || '');
    if (ph.endsWith('999')) {
      return {
        status: 'RATE_LIMITED',
        reason: 'Sandbox mô phỏng nền tảng giới hạn tần suất (RATE_LIMITED)'
      };
    }
    if (ph.endsWith('888')) {
      return {
        status: 'REVIEW',
        zaloName: contact.name || 'Sandbox User',
        reason: 'Sandbox mô phỏng trạng thái không xác định sau thao tác gửi -> REVIEW',
        sentMessage: message
      };
    }
    if (ph.endsWith('777')) {
      return {
        status: 'CHAN_NGUOI_LA',
        zaloName: contact.name || 'Sandbox User',
        reason: 'Sandbox mô phỏng người nhận chặn người lạ',
        sentMessage: ''
      };
    }
    if (ph.endsWith('666')) {
      return {
        status: 'KHONG_DANG_KY',
        zaloName: '',
        reason: 'Sandbox mô phỏng SĐT chưa đăng ký',
        sentMessage: ''
      };
    }

    this.sentHistory.push({
      accountId: account.id,
      phone: ph,
      message,
      attachmentCount: attachments.length,
      idempotencyKey,
      at: new Date().toISOString()
    });

    return {
      status: 'THANH_CONG',
      zaloName: contact.name || `Khách ${ph.slice(-4)}`,
      sentMessage: message,
      reason: 'Sandbox gửi thành công'
    };
  }

  async closeSession(accountId) {
    this.sessions.delete(accountId);
    return { ok: true };
  }
}

module.exports = {
  MockSandboxAdapter
};
