/**
 * Hợp đồng chuẩn cho Channel Adapter V2:
 * Mọi kênh gửi/nhận tin (Zalo OA chính thức, Web Assisted có giám sát, Mock Sandbox test)
 * đều phải tuân thủ giao diện thống nhất để không trộn logic trình duyệt vào API hay Worker.
 */
class ChannelAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Khởi tạo phiên tài khoản nếu cần
   * @returns {Promise<{ ok: boolean, status: string, profileName?: string }>}
   */
  async ensureSessionReady(account) {
    throw new Error(`Adapter ${this.name} chưa cài đặt ensureSessionReady()`);
  }

  /**
   * Gửi một tin nhắn tới một liên hệ.
   * BẮT BUỘC phân loại rõ:
   *  - 'THANH_CONG' (SENT)
   *  - 'CHAN_NGUOI_LA' (BLOCKED_STRANGER)
   *  - 'KHONG_DANG_KY' (NOT_REGISTERED)
   *  - 'RATE_LIMITED' (nền tảng báo giới hạn - DỪNG CHIẾN DỊCH, KHÔNG nhảy nick!)
   *  - 'REVIEW' (kết quả bên ngoài không rõ ràng - KHÔNG tự gửi lại!)
   *  - 'LOI' (FAILED rõ ràng trước khi gửi)
   */
  async sendMessage({ account, contact, message, attachments = [], settings = {}, idempotencyKey }) {
    throw new Error(`Adapter ${this.name} chưa cài đặt sendMessage()`);
  }

  /**
   * Quét hoặc nhận tin nhắn đến theo stable thread ID.
   */
  async fetchInboundConversations(account) {
    return [];
  }

  async closeSession(accountId) {
    return { ok: true };
  }
}

module.exports = {
  ChannelAdapter
};
