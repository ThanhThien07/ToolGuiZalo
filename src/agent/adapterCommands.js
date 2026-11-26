/**
 * Bộ điều phối lệnh chung cho ZaloWebAdapter (dùng chung cho cả Worker Process lẫn Inline Mode).
 */
async function executeAdapterCommand(adapter, cmd, args = {}) {
  switch (cmd) {
    case 'ensureSessionReady':
      return adapter.ensureSessionReady(args.account);
    case 'sendMessage':
      return adapter.sendMessage(args);
    case 'getLiveScreenshot':
      return adapter.getLiveScreenshot(args.accountId, args.forceViewer);
    case 'setViewerActive':
      adapter.setViewerActive(args.active, args.ttlMs);
      return { ok: true };
    case 'clickOnPage':
      return { ok: await adapter.clickOnPage(args.xRatio, args.yRatio, args.accountId) };
    case 'reloadPage':
      return { ok: await adapter.reloadPage(args.accountId) };
    case 'openChat':
      return adapter.openChat(args.account, args.phone, args.contactName);
    case 'fetchInboundConversations':
      return adapter.fetchInboundConversations(args.account);
    case 'closeSession':
      return adapter.closeSession(args.accountId);
    case 'closeAll':
      return adapter.closeAll();
    default:
      throw new Error(`Lệnh agent không hợp lệ: ${cmd}`);
  }
}

module.exports = {
  executeAdapterCommand
};
