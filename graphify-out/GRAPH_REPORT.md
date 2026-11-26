# Graph Report - ToolGuiZalo  (2026-11-26)

## Corpus Check
- 64 files · ~50,562 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: .exe 3, .bat 2, .example 1)

## Summary
- 725 nodes · 1489 edges · 35 communities (22 shown, 13 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `73a705a2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- core.test.js
- server.js
- package.json
- js/app.js
- CampaignService
- TOOLGUIZALO PRO V2
- ToolGuiZalo Pro – Web App Tự Động Gửi Tin Nhắn Zalo Đa Tài Khoản
- StorageFacade
- v2_suite.test.js
- ZaloWebAdapter
- TaskEngine
- UserRepo
- with
- steps
- opsRoutes.js
- ZaloBotV2
- getConfig
- crmRoutes.js
- src/app.js
- ContactRepo
- database.js
- steps
- recordSyncEvent
- agentManager.js
- writeAudit
- TaskRepo
- DbManager
- authRoutes.js
- AccountRepo
- safeParseJson
- SettingsRepo
- migration.js
- TemplateRepo
- AuthenticatedSyncFacade
- ConsentRepo

## God Nodes (most connected - your core abstractions)
1. `getConfig()` - 37 edges
2. `writeAudit()` - 35 edges
3. `StorageFacade` - 27 edges
4. `recordSyncEvent()` - 23 edges
5. `apiFetch()` - 22 edges
6. `ZaloWebAdapter` - 22 edges
7. `UserRepo` - 22 edges
8. `bindEvents()` - 20 edges
9. `ContactRepo` - 20 edges
10. `TOOLGUIZALO PRO V2` - 20 edges

## Surprising Connections (you probably didn't know these)
- `2. Nguyên tắc vận hành & tuân thủ` --references--> `ZaloOfficialAdapter`  [INFERRED]
  docs/ARCHITECTURE_V2.md → src/adapters/zaloOfficialAdapter.js
- `Vai trò các module chính` --references--> `normalizePhone()`  [INFERRED]
  README.md → src/phoneUtils.js
- `Vai trò các module chính` --references--> `renderMessage()`  [INFERRED]
  README.md → src/templateEngine.js
- `createApp()` --calls--> `getConfig()`  [EXTRACTED]
  src/app.js → src/config.js
- `createApp()` --indirect_call--> `attachCorrelationId()`  [INFERRED]
  src/app.js → src/middleware/security.js

## Import Cycles
- None detected.

## Communities (35 total, 13 thin omitted)

### Community 0 - "core.test.js"
Cohesion: 0.08
Nodes (27): RFC-6238, AuthError, AuthService, BackupService, crypto, decodeBase32(), decryptBuffer(), deriveAesKey() (+19 more)

### Community 1 - "server.js"
Cohesion: 0.40
Nodes (3): app, cfg, startServer()

### Community 2 - "package.json"
Cohesion: 0.10
Nodes (24): dependencies, cors@^2.8.5, express@^4.19.2, multer@^1.4.5-lts.1, playwright@^1.48.0, xlsx@^0.18.5, description, main (+16 more)

### Community 3 - "js/app.js"
Cohesion: 0.17
Nodes (38): activeToastKeys, apiFetch(), escapeHtml(), formatError(), showToast(), applySettingsToForm(), applyTheme(), bindEvents() (+30 more)

### Community 4 - "CampaignService"
Cohesion: 0.07
Nodes (6): ChannelAdapter, MockSandboxAdapter, ZaloOfficialAdapter, CampaignService, EventEmitter, sleep()

### Community 5 - "TOOLGUIZALO PRO V2"
Cohesion: 0.06
Nodes (28): 1. Tổng quan kiến trúc Modular Monolith + Isolated Local Agent, 2. Nguyên tắc vận hành & tuân thủ, Kiến trúc ToolGuiZalo Pro V2, 1. Kiểm tra API & UI mismatch phát hiện trong V1, 2. Rà soát lưu trữ, đồng thời & độ bền tác vụ, 3. Rà soát bảo mật & chính sách nền tảng, 4. Tách trách nhiệm & hiệu năng, Kiểm toán Baseline Source V1 (`BASELINE_AUDIT.md`) (+20 more)

### Community 6 - "ToolGuiZalo Pro – Web App Tự Động Gửi Tin Nhắn Zalo Đa Tài Khoản"
Cohesion: 0.08
Nodes (24): 10. Danh sách API, 11. Dữ liệu lưu trữ, 12. Lưu ý an toàn tài khoản & xử lý sự cố, 1. 👤 Tài khoản Zalo (Đa tài khoản), 1. Tính năng chi tiết, 2. ⏰ Lịch hẹn & khung giờ, 3. Kiến trúc hệ thống, 3. 📥 Nạp danh sách SĐT (+16 more)

### Community 8 - "v2_suite.test.js"
Cohesion: 0.09
Nodes (18): assert, fs, http, os, path, TEMP_ROOT, test, TEST_BACKUP_DIR (+10 more)

### Community 9 - "ZaloWebAdapter"
Cohesion: 0.16
Nodes (5): ZaloWebAdapter, adapter, loopMonitor, { monitorEventLoopDelay }, shutdown()

### Community 12 - "with"
Cohesion: 0.06
Nodes (34): runs-on, steps, environment, needs, permissions, runs-on, steps, env (+26 more)

### Community 13 - "steps"
Cohesion: 0.12
Nodes (19): runs-on, steps, NODE_AUTH_TOKEN, jobs, build, publish-npm, name, on (+11 more)

### Community 14 - "opsRoutes.js"
Cohesion: 0.16
Nodes (11): crypto, crypto, crypto, crypto, crypto, crypto, crypto, os (+3 more)

### Community 16 - "getConfig"
Cohesion: 0.11
Nodes (16): { chromium }, fs, path, VIEWPORT_SIZE, crypto, ensureOrLoadLocalSecret(), fs, getConfig() (+8 more)

### Community 17 - "crmRoutes.js"
Cohesion: 0.07
Nodes (40): 2. Cấu trúc mã nguồn, Vai trò các module chính, normalizePhone(), SseHub, crypto, express, fs, multer (+32 more)

### Community 18 - "src/app.js"
Cohesion: 0.18
Nodes (18): createApp(), express, fs, path, attachCorrelationId(), createRateLimiter(), crypto, csrfAndOriginGuard() (+10 more)

### Community 20 - "database.js"
Cohesion: 0.13
Nodes (12): result, res, { DatabaseSync }, DEFAULT_ROLES, fs, path, SCHEMA_FILE, crypto (+4 more)

### Community 21 - "steps"
Cohesion: 0.12
Nodes (16): jobs, test-and-verify, name, on, pull_request, push, branches, branches (+8 more)

### Community 22 - "recordSyncEvent"
Cohesion: 0.21
Nodes (5): enqueueOutbox(), recordSyncEvent(), ConversationRepo, crypto, msgDedupeHash()

### Community 23 - "agentManager.js"
Cohesion: 0.20
Nodes (6): executeAdapterCommand(), AgentManager, crypto, EventEmitter, { fork }, path

### Community 24 - "writeAudit"
Cohesion: 0.21
Nodes (4): CampaignRepo, crypto, writeAudit(), DeltaSyncService

### Community 27 - "authRoutes.js"
Cohesion: 0.27
Nodes (8): authLimiter, express, router, parseSchema(), s, validateBody(), validateValue(), ValidationError

### Community 31 - "migration.js"
Cohesion: 0.29
Nodes (6): dryRun, result, crypto, fs, migrateV1JsonToSqlite(), path

## Knowledge Gaps
- **1 isolated node(s):** `RFC-6238`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 275 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getConfig()` connect `getConfig` to `core.test.js`, `server.js`, `CampaignService`, `ZaloWebAdapter`, `opsRoutes.js`, `crmRoutes.js`, `src/app.js`, `database.js`, `agentManager.js`, `DbManager`, `authRoutes.js`, `migration.js`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **What connects `RFC-6238` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `core.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08392156862745098 - nodes in this community are weakly interconnected._
- **Why does `ZaloOfficialAdapter` connect `CampaignService` to `TOOLGUIZALO PRO V2`, `opsRoutes.js`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09666666666666666 - nodes in this community are weakly interconnected._
- **Why does `2. Nguyên tắc vận hành & tuân thủ` connect `TOOLGUIZALO PRO V2` to `CampaignService`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Should `CampaignService` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._