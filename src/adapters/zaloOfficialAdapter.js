const crypto = require('crypto');
const { ChannelAdapter } = require('./channelAdapter');
const { getConfig } = require('../config');

/**
 * Zalo Official Account (OA) API & Webhook Adapter (Roadmap Mục 1 & 3):
 * Ưu tiên kênh chính thức của Zalo khi được cấu hình `ZALO_OA_ACCESS_TOKEN`.
 */
class ZaloOfficialAdapter extends ChannelAdapter {
  constructor() {
    super('zalo_oa');
  }

  isConfigured() {
    const cfg = getConfig();
    return Boolean(cfg.zaloOa.accessToken);
  }

  async ensureSessionReady(account) {
    if (!this.isConfigured()) {
      return {
        ok: false,
        status: 'CLOSED',
        reason: 'Chưa cấu hình ZALO_OA_ACCESS_TOKEN trong môi trường.'
      };
    }
    return { ok: true, status: 'READY', profileName: `${account.name} (Zalo OA)` };
  }

  async sendMessage({ contact, message }) {
    const cfg = getConfig();
    if (!cfg.zaloOa.accessToken) {
      return {
        status: 'LOI',
        reason: 'Thiếu ZALO_OA_ACCESS_TOKEN để gửi qua Zalo Official API.'
      };
    }
    const externalUserId = contact?.extraFields?.zalo_oa_user_id || contact?.extraFields?.user_id || '';
    if (!externalUserId) {
      return {
        status: 'LOI',
        reason: 'Thiếu zalo_oa_user_id (người dùng cần quan tâm OA trước).'
      };
    }

    try {
      const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: cfg.zaloOa.accessToken
        },
        body: JSON.stringify({
          recipient: { user_id: externalUserId },
          message: { text: message }
        }),
        signal: AbortSignal.timeout(10000)
      });

      const data = await res.json();
      if (res.status === 429 || data.error === -213) {
        return { status: 'RATE_LIMITED', reason: data.message || 'Zalo OA API vượt hạn mức' };
      }
      if (data.error === 0) {
        return {
          status: 'THANH_CONG',
          zaloName: contact.name || externalUserId,
          sentMessage: message,
          reason: `Đã gửi qua Zalo OA (msg_id: ${data.data?.message_id || 'ok'})`
        };
      }
      return { status: 'LOI', reason: `Zalo OA trả mã lỗi ${data.error}: ${data.message || ''}` };
    } catch (err) {
      // Lỗi mạng sau khi đã gọi API gửi ra ngoài -> kết quả không rõ ràng -> REVIEW
      return {
        status: 'REVIEW',
        sentMessage: message,
        reason: `Lỗi mạng khi gọi Zalo OA (${err.message}) — chuyển REVIEW`
      };
    }
  }

  /**
   * Xác minh chữ ký webhook từ Zalo OA (`X-ZEvent-Signature`)
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    const cfg = getConfig();
    const secret = cfg.zaloOa.appSecret || cfg.zaloOa.webhookSecret;
    if (!secret || !signatureHeader) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader).replace(/^mac=/i, '').trim());
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = {
  ZaloOfficialAdapter
};
