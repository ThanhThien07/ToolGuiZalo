const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');

// Thiết lập môi trường test tách biệt hoàn toàn khỏi data thật của người dùng
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tgz-v2-int-'));
const TEST_DATA_DIR = path.join(TEMP_ROOT, 'data');
const TEST_DB_PATH = path.join(TEST_DATA_DIR, 'test_v2.db');
const TEST_BACKUP_DIR = path.join(TEMP_ROOT, 'backups');
const TEST_UPLOADS_DIR = path.join(TEMP_ROOT, 'uploads');

process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.NO_AUTO_OPEN = 'true';
process.env.AGENT_ISOLATED = 'false';
process.env.LOG_SILENT = 'true';
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DB_PATH = TEST_DB_PATH;
process.env.BACKUP_DIR = TEST_BACKUP_DIR;
process.env.UPLOADS_DIR = TEST_UPLOADS_DIR;
process.env.USER_DATA_DIR = path.join(TEMP_ROOT, 'user_data');

// Tạo sẵn database.json V1 mẫu để kiểm thử quy trình Migration V1 -> V2
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
fs.writeFileSync(
  path.join(TEST_DATA_DIR, 'database.json'),
  JSON.stringify({
    activeAccountId: 'acc_default',
    accounts: [
      { id: 'acc_default', name: 'Zalo #1', profileDir: 'zalo_profile', sentCount: 5 },
      { id: 'acc_2', name: 'Zalo #2', profileDir: 'zalo_profile_2', sentCount: 2 }
    ],
    settings: {
      template: '{Chào|Xin chào} {ten}',
      minDelaySec: 0,
      maxDelaySec: 1,
      autoAddFriendWhenBlocked: true
    },
    contacts: [
      {
        id: 'c_v1_1',
        phone: '0912345678',
        name: 'Khiêm',
        zaloName: 'Khiêm',
        status: 'THANH_CONG',
        sentMessage: 'Chào Khiêm',
        hasReplied: true,
        replyText: 'Ok bạn',
        replyAt: '2026-11-14T10:00:00.000Z'
      },
      {
        id: 'c_v1_2',
        phone: '0987654323',
        name: 'Khiêm',
        zaloName: 'Khiêm',
        status: 'PENDING'
      }
    ],
    phoneCache: {
      '0905112230': { status: 'KHONG_DANG_KY', reason: 'Cached V1' }
    }
  }),
  'utf8'
);

const { createApp } = require('../../src/app');
const db = require('../../src/db/database');
const contactRepo = require('../../src/db/repositories/contactRepo');
const consentRepo = require('../../src/db/repositories/consentRepo');
const taskRepo = require('../../src/db/repositories/taskRepo');
const conversationRepo = require('../../src/db/repositories/conversationRepo');
const campaignService = require('../../src/services/campaignService');
const backupService = require('../../src/services/backupService');
const auditRepo = require('../../src/db/repositories/auditRepo');

let server;
let baseUrl;
let adminToken;
let viewerToken;
let operatorToken;

async function reqJson(urlPath, { method = 'GET', token = null, deviceToken = null, body = undefined } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (deviceToken) headers['X-Device-Token'] = deviceToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

test.before(async () => {
  const app = createApp({ initBot: false });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

test('1. V1 JSON -> SQLite WAL migration reconciles counts and strips policy-violating V1 defaults', async () => {
  const metaRow = db.queryOne("SELECT value_json FROM settings WHERE key = 'v1_migrated_meta'");
  assert.ok(metaRow);
  const meta = JSON.parse(metaRow.value_json);
  assert.equal(meta.accountsImported, 2);
  assert.equal(meta.contactsImported, 2);
  assert.equal(meta.conversationsImported, 1);
  assert.equal(meta.cacheImported, 1);
  assert.ok(fs.existsSync(meta.backupDir));

  const settingsRow = JSON.parse(db.queryOne("SELECT value_json FROM settings WHERE key = 'app_settings'").value_json);
  assert.ok(settingsRow.minDelaySec >= 5);
  assert.equal(settingsRow.autoAddFriendWhenBlocked, false);
  assert.equal(settingsRow.template.includes('|'), false);
});

test('2. Auth & RBAC strictly protect sensitive endpoints (401 unauthenticated, 403 viewer)', async () => {
  // Chưa login -> từ chối
  assert.equal((await reqJson('/api/v2/contacts')).status, 401);
  assert.equal((await reqJson('/api/browser/screenshot')).status, 401);
  assert.equal((await reqJson('/api/v2/sync/info')).status, 401);

  // Setup Admin lần đầu
  const setup = await reqJson('/api/v2/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'AdminPassword123!' }
  });
  assert.equal(setup.status, 201);
  adminToken = setup.json.accessToken;

  // Setup lần 2 phải bị chặn 409
  const setup2 = await reqJson('/api/v2/auth/setup', {
    method: 'POST',
    body: { username: 'hacker', password: 'Password123!' }
  });
  assert.equal(setup2.status, 409);

  // Tạo user Viewer và Operator
  assert.equal(
    (
      await reqJson('/api/v2/auth/users', {
        method: 'POST',
        token: adminToken,
        body: { username: 'viewer1', password: 'ViewerPass123!', role: 'viewer' }
      })
    ).status,
    201
  );
  assert.equal(
    (
      await reqJson('/api/v2/auth/users', {
        method: 'POST',
        token: adminToken,
        body: { username: 'operator1', password: 'OperatorPass123!', role: 'operator' }
      })
    ).status,
    201
  );

  viewerToken = (
    await reqJson('/api/v2/auth/login', {
      method: 'POST',
      body: { username: 'viewer1', password: 'ViewerPass123!' }
    })
  ).json.accessToken;
  operatorToken = (
    await reqJson('/api/v2/auth/login', {
      method: 'POST',
      body: { username: 'operator1', password: 'OperatorPass123!' }
    })
  ).json.accessToken;

  // Viewer đọc được danh bạ nhưng BỊ CẤM 403 mọi API nhạy cảm
  assert.equal((await reqJson('/api/v2/contacts', { token: viewerToken })).status, 200);
  assert.equal(
    (await reqJson('/api/v2/contacts/import-text', { method: 'POST', token: viewerToken, body: { text: '0905112233' } })).status,
    403
  );
  assert.equal((await reqJson('/api/v2/backups', { method: 'POST', token: viewerToken })).status, 403);
  assert.equal((await reqJson('/api/v2/browser/screenshot', { token: viewerToken })).status, 403);

  // Operator không tạo được backup/user Admin-only
  assert.equal((await reqJson('/api/v2/backups', { method: 'POST', token: operatorToken })).status, 403);
});

test('3. Consent & Global Opt-out enforcement + Sandbox Campaign stops on RATE_LIMITED & routes uncertain to REVIEW', async () => {
  // Nạp 5 số cho kịch bản sandbox:
  // 0901000001: OPTED_IN -> THANH_CONG
  // 0901000888: OPTED_IN -> REVIEW (uncertain external outcome)
  // 0901000777: OPTED_IN -> CHAN_NGUOI_LA
  // 0901000002: OPTED_OUT -> Bị chặn bởi global opt-out list (không gửi)
  // 0901000003: UNKNOWN -> Bị bỏ qua khi requireOptInConsent = true
  // 0901000999: OPTED_IN -> RATE_LIMITED -> Phải tạm dừng chiến dịch ngay, không chuyển nick!
  const imp = await reqJson('/api/v2/contacts/import-text', {
    method: 'POST',
    token: operatorToken,
    body: {
      text: [
        '0901000001 | Khách OK | Info 1',
        '0901000888 | Khách Review | Info 2',
        '0901000777 | Khách Chặn | Info 3',
        '0901000002 | Khách Từ Chối | Info 4',
        '0901000003 | Khách Chưa Rõ | Info 5'
      ].join('\n'),
      consentStatus: 'UNKNOWN'
    }
  });
  assert.equal(imp.status, 200);

  await reqJson('/api/v2/consents/bulk-opt-in', {
    method: 'POST',
    token: operatorToken,
    body: { phones: ['0901000001', '0901000888', '0901000777'] }
  });
  await reqJson('/api/v2/consents', {
    method: 'POST',
    token: operatorToken,
    body: { phone: '0901000002', status: 'OPTED_OUT', source: 'user_unsubscribed' }
  });

  // Nhập lại SĐT đã Opt-out với consentStatus = OPTED_IN -> KHÔNG được ghi đè mất trạng thái OPTED_OUT!
  await reqJson('/api/v2/contacts/import-text', {
    method: 'POST',
    token: operatorToken,
    body: { text: '0901000002 | Khách Từ Chối', consentStatus: 'OPTED_IN' }
  });
  assert.equal(consentRepo.getByPhone('0901000002').status, 'OPTED_OUT');

  // Tạo và chạy chiến dịch mock_sandbox
  const cmpRes = await reqJson('/api/v2/campaigns', {
    method: 'POST',
    token: operatorToken,
    body: {
      name: 'Sandbox Test 1',
      channel: 'mock_sandbox',
      requireOptInConsent: true
    }
  });
  assert.equal(cmpRes.status, 201);
  assert.equal(cmpRes.json.queuedTasks, 3);
  assert.ok(cmpRes.json.skippedByConsent >= 2);

  const cmpId = cmpRes.json.campaign.id;
  await reqJson(`/api/v2/campaigns/${cmpId}/approve`, { method: 'POST', token: adminToken });
  const runRes = await reqJson(`/api/v2/campaigns/${cmpId}/start?wait=true`, { method: 'POST', token: operatorToken });
  assert.equal(runRes.json.campaign.status, 'COMPLETED');

  // Kiểm tra kết quả từng số
  assert.equal(contactRepo.getByPhone('0901000001').status, 'THANH_CONG');
  assert.equal(contactRepo.getByPhone('0901000888').status, 'REVIEW');
  assert.equal(contactRepo.getByPhone('0901000777').status, 'CHAN_NGUOI_LA');
  assert.equal(contactRepo.getByPhone('0901000002').status, 'OPTED_OUT');

  // Giải quyết hàng chờ REVIEW qua API
  const revTasks = await reqJson(`/api/v2/tasks?campaignId=${cmpId}&status=REVIEW`, { token: operatorToken });
  assert.equal(revTasks.json.items.length, 1);
  const resolved = await reqJson(`/api/v2/tasks/${revTasks.json.items[0].id}/resolve-review`, {
    method: 'POST',
    token: operatorToken,
    body: { resolution: 'COMPLETED', note: 'Đã xác nhận trên Zalo' }
  });
  assert.equal(resolved.json.task.status, 'COMPLETED');

  // Kiểm thử kịch bản RATE_LIMITED: chiến dịch PHẢI dừng ở PAUSED thay vì xoay nick né limit
  await reqJson('/api/v2/contacts/import-text', {
    method: 'POST',
    token: operatorToken,
    body: { text: '0901000999 | Khách Rate Limit', consentStatus: 'OPTED_IN' }
  });
  const rlContact = contactRepo.getByPhone('0901000999');
  const rlCmp = await reqJson('/api/v2/campaigns', {
    method: 'POST',
    token: operatorToken,
    body: { name: 'RateLimit Halt Test', channel: 'mock_sandbox', contactIds: [rlContact.id] }
  });
  const rlStart = await reqJson(`/api/v2/campaigns/${rlCmp.json.campaign.id}/start?wait=true`, {
    method: 'POST',
    token: operatorToken
  });
  assert.equal(rlStart.json.campaign.status, 'PAUSED');
  assert.ok(rlStart.json.campaign.stopReason.includes('RATE_LIMITED'));
});

test('4. Crash recovery moves interrupted PROCESSING task into REVIEW without auto-resending', () => {
  const cmp = campaignService.createCampaign({ name: 'Crash Recovery', channel: 'mock_sandbox', autoApprove: true });
  // Tạo thủ công 1 task giả lập đang PROCESSING trước khi mất điện
  const c = contactRepo.getByPhone('0901000001');
  taskRepo.enqueueCampaignTasks(cmp.campaign.id, [
    { contactId: c.id, phone: c.phone, renderedMessage: 'Msg', idempotencyKey: `crash:${cmp.campaign.id}:${c.id}` }
  ]);
  const claimed = taskRepo.claimNextTask({ campaignId: cmp.campaign.id, workerId: 'wrk_crash_test' });
  taskRepo.startProcessing(claimed.id, { workerId: 'wrk_crash_test' });

  const recovery = taskRepo.recoverInterruptedTasks();
  assert.ok(recovery.movedToReview >= 1);
  const after = taskRepo.getById(claimed.id);
  assert.equal(after.status, 'REVIEW');
});

test('5. Ambiguous duplicate contact names in Inbox are flagged NEEDS_VERIFICATION instead of silent merge', () => {
  // Hai số 0912345678 và 0987654323 từ V1 đều tên "Khiêm"
  const rec = conversationRepo.recordInboundOrOutbound({
    externalThreadId: 'thread_khiem_ambig',
    accountId: 'acc_default',
    customerName: 'Khiêm',
    body: 'Em hỏi thông tin học phí ạ',
    direction: 'INBOUND'
  });
  assert.equal(rec.conversation.matchStatus, 'NEEDS_VERIFICATION');

  // Xác minh thủ công gắn đúng với SĐT 0987654323
  const exactContact = contactRepo.getByPhone('0987654323');
  const verified = conversationRepo.verifyLink(rec.conversation.id, { contactId: exactContact.id });
  assert.equal(verified.matchStatus, 'VERIFIED');
  assert.equal(verified.phone, '0987654323');
});

test('6. Encrypted Backup & Clean Environment Restore pass integrity check', async () => {
  const created = await reqJson('/api/v2/backups', { method: 'POST', token: adminToken, body: { kind: 'manual' } });
  assert.equal(created.status, 201);
  const bkpId = created.json.backup.id;

  const verified = await reqJson(`/api/v2/backups/${bkpId}/verify`, { method: 'POST', token: adminToken });
  assert.equal(verified.json.ok, true);

  // Restore vào một thư mục/DB hoàn toàn sạch
  const cleanDbPath = path.join(TEMP_ROOT, 'clean_restore_env', 'restored.db');
  const restored = await reqJson(`/api/v2/backups/${bkpId}/restore`, {
    method: 'POST',
    token: adminToken,
    body: { targetDbPath: cleanDbPath }
  });
  assert.equal(restored.json.ok, true);
  assert.equal(restored.json.integrity, 'ok');
  assert.ok(restored.json.verifiedContactsCount >= 5);
});

test('7. Authenticated Delta Sync handles pairing, idempotency replay, conflict review, tombstones, and token revocation', async () => {
  const pairRes = await reqJson('/api/v2/devices/pair', { method: 'POST', token: adminToken, body: { role: 'SYNC_CLIENT' } });
  assert.equal(pairRes.status, 201);

  const enrollRes = await reqJson('/api/v2/devices/enroll', {
    method: 'POST',
    body: { code: pairRes.json.code, deviceName: 'Laptop Chi Nhánh', hostname: 'BRANCH-PC' }
  });
  assert.equal(enrollRes.status, 201);
  const devId = enrollRes.json.device.id;
  const devTok = enrollRes.json.deviceToken;

  // Mã ghép dùng lại lần 2 phải lỗi 400
  const reuse = await reqJson('/api/v2/devices/enroll', {
    method: 'POST',
    body: { code: pairRes.json.code, deviceName: 'Replay', hostname: 'EVIL' }
  });
  assert.equal(reuse.status, 400);

  // Client gửi delta mới và REPLAY lại đúng mutationId -> không nhân đôi!
  const mutationId = 'mut-idempotent-1';
  const d1 = await reqJson('/api/v2/sync/delta', {
    method: 'POST',
    deviceToken: devTok,
    body: {
      sinceCursor: 0,
      mutations: [
        {
          mutationId,
          entityType: 'contact',
          operation: 'UPSERT',
          entityVersion: 1,
          payload: { phone: '0909888111', rawPhone: '0909888111', name: 'Synced User', info: 'From Branch' }
        }
      ]
    }
  });
  assert.equal(d1.status, 200);
  assert.equal(d1.json.applied, 1);

  const d2Replay = await reqJson('/api/v2/sync/delta', {
    method: 'POST',
    deviceToken: devTok,
    body: {
      sinceCursor: 0,
      mutations: [
        {
          mutationId,
          entityType: 'contact',
          operation: 'UPSERT',
          entityVersion: 1,
          payload: { phone: '0909888111', rawPhone: '0909888111', name: 'Synced User', info: 'From Branch' }
        }
      ]
    }
  });
  assert.equal(d2Replay.json.skippedDuplicate, 1);
  assert.equal(d2Replay.json.applied, 0);

  // Mô phỏng xung đột: Server cập nhật bản ghi lên version cao hơn, Client đẩy baseVersion cũ (0) với tên khác
  const syncedC = contactRepo.getByPhone('0909888111');
  contactRepo.updateContact(syncedC.id, { name: 'Tên Server Mới', info: 'Server Info' });

  const conflictSync = await reqJson('/api/v2/sync/delta', {
    method: 'POST',
    deviceToken: devTok,
    body: {
      sinceCursor: 0,
      mutations: [
        {
          mutationId: 'mut-conflict-2',
          entityType: 'contact',
          operation: 'UPSERT',
          baseVersion: 0,
          entityVersion: 2,
          payload: { id: syncedC.id, phone: '0909888111', name: 'Tên Client Khác', info: 'Client Info' }
        }
      ]
    }
  });
  assert.equal(conflictSync.json.conflictsCreated, 1);

  // Kiểm tra tombstone khi xóa và đồng bộ lại
  await reqJson(`/api/v2/contacts/${syncedC.id}`, { method: 'DELETE', token: operatorToken });
  const pullAfterDel = await reqJson('/api/v2/sync/delta', {
    method: 'POST',
    deviceToken: devTok,
    body: { sinceCursor: 0, mutations: [] }
  });
  assert.ok(pullAfterDel.json.tombstones.some((t) => t.entity_id === syncedC.id));

  // Thu hồi device token -> phải bị 401
  await reqJson(`/api/v2/devices/${devId}/revoke`, { method: 'POST', token: adminToken });
  const revokedCall = await reqJson('/api/v2/sync/delta', {
    method: 'POST',
    deviceToken: devTok,
    body: { sinceCursor: 0, mutations: [] }
  });
  assert.equal(revokedCall.status, 401);

  // Incremental event log check
  const maxEvt = auditRepo.getLatestSyncEventId();
  assert.ok(maxEvt > 0);
});
