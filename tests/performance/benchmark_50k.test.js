const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tgz-v2-perf-'));
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.NO_AUTO_OPEN = 'true';
process.env.AGENT_ISOLATED = 'false';
process.env.LOG_SILENT = 'true';
process.env.DATA_DIR = path.join(TEMP_ROOT, 'data');
process.env.DB_PATH = path.join(TEMP_ROOT, 'data', 'perf_50k.db');
process.env.BACKUP_DIR = path.join(TEMP_ROOT, 'backups');
process.env.UPLOADS_DIR = path.join(TEMP_ROOT, 'uploads');

const { createApp } = require('../../src/app');
const db = require('../../src/db/database');

let server;
let baseUrl;
let token;

test.before(async () => {
  const app = createApp({ initBot: false });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const setup = await fetch(`${baseUrl}/api/v2/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'PerfPassword123!' })
  });
  const data = await setup.json();
  token = data.accessToken;

  // Seed 50.000 contacts trực tiếp trong 1 transaction SQLite
  const conn = db.getConnection();
  const now = new Date().toISOString();
  db.withTransaction(() => {
    const stmt = conn.prepare(`
      INSERT INTO contacts (id, phone, raw_phone, name, info, status, reason, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, 'OK', ?, ?, 1)
    `);
    const statuses = ['THANH_CONG', 'PENDING', 'CHAN_NGUOI_LA', 'KHONG_DANG_KY'];
    for (let i = 0; i < 50000; i++) {
      const phone = `09${String(10000000 + i).padStart(8, '0')}`;
      stmt.run(
        `perf_${i}`,
        phone,
        phone,
        `Khach Hang ${i}`,
        `Don #${i}`,
        statuses[i % statuses.length],
        now,
        now
      );
    }
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

test('50,000 contacts API list benchmark meets p95 < 300ms target', async () => {
  const latencies = [];
  for (let i = 0; i < 30; i++) {
    const offset = (i * 250) % 45000;
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/api/v2/contacts?status=THANH_CONG&limit=25&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    const elapsed = performance.now() - t0;
    assert.equal(res.status, 200);
    assert.equal(body.items.length, 25);
    assert.equal(body.stats.total, 50000);
    latencies.push(elapsed);
  }
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  console.log(`50k Contacts Benchmark -> p50: ${p50.toFixed(1)}ms, p95: ${p95.toFixed(1)}ms, max: ${latencies[latencies.length - 1].toFixed(1)}ms`);
  assert.ok(p95 < 300, `Expected p95 < 300ms, got ${p95.toFixed(1)}ms`);
});
