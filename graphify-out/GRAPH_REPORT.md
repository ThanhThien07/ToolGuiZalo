# Graph Report - ToolGuiZalo  (2026-11-26)

## Corpus Check
- 61 files · ~46,937 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .exe 2, .bat 2, .example 1)

## Summary
- 632 nodes · 1375 edges · 33 communities (21 shown, 12 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `da812265`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- core.test.js
- server.js
- package.json
- js/app.js
- CampaignService
- TOOLGUIZALO PRO V2
- crmRoutes.js
- StorageFacade
- v2_suite.test.js
- ZaloWebAdapter
- agentManager.js
- UserRepo
- getConfig
- sseHub.js
- writeAudit
- ZaloBotV2
- healthService.js
- v1CompatRoutes.js
- src/app.js
- ContactRepo
- database.js
- steps
- excelSecurity.js
- agentManager.js
- writeAudit
- TaskRepo
- DbManager
- authRoutes.js
- zaloWebAdapter.js
- config.js
- SettingsRepo
- TemplateRepo
- AuthenticatedSyncFacade

## God Nodes (most connected - your core abstractions)
1. `getConfig()` - 37 edges
2. `writeAudit()` - 35 edges
3. `StorageFacade` - 27 edges
4. `ZaloWebAdapter` - 23 edges
5. `recordSyncEvent()` - 23 edges
6. `UserRepo` - 22 edges
7. `apiFetch()` - 22 edges
8. `ContactRepo` - 20 edges
9. `bindEvents()` - 20 edges
10. `TOOLGUIZALO PRO V2` - 20 edges

## Surprising Connections (you probably didn't know these)
- `1. Tính năng chính V2` --references--> `ZaloWebAdapter`  [INFERRED]
  README.md → src/adapters/zaloWebAdapter.js
- `2. Nguyên tắc vận hành & tuân thủ` --references--> `ZaloOfficialAdapter`  [INFERRED]
  docs/ARCHITECTURE_V2.md → src/adapters/zaloOfficialAdapter.js
- `1. Tính năng chính V2` --references--> `MockSandboxAdapter`  [INFERRED]
  README.md → src/adapters/mockSandboxAdapter.js
- `1. Tính năng chính V2` --references--> `ZaloOfficialAdapter`  [INFERRED]
  README.md → src/adapters/zaloOfficialAdapter.js
- `setSessionCookie()` --calls--> `getConfig()`  [EXTRACTED]
  src/routes/authRoutes.js → src/config.js

## Import Cycles
- None detected.

## Communities (33 total, 12 thin omitted)

### Community 0 - "core.test.js"
Cohesion: 0.10
Nodes (25): RFC-6238, AuthError, AuthService, crypto, decodeBase32(), decryptBuffer(), deriveAesKey(), encryptBuffer() (+17 more)

### Community 1 - "server.js"
Cohesion: 0.40
Nodes (3): app, cfg, startServer()

### Community 2 - "package.json"
Cohesion: 0.10
Nodes (22): dependencies, cors@^2.8.5, multer@^1.4.5-lts.1, playwright@^1.48.0, xlsx@^0.18.5, description, main, name (+14 more)

### Community 3 - "js/app.js"
Cohesion: 0.17
Nodes (38): activeToastKeys, apiFetch(), escapeHtml(), formatError(), showToast(), applySettingsToForm(), applyTheme(), bindEvents() (+30 more)

### Community 4 - "CampaignService"
Cohesion: 0.05
Nodes (17): 1. Tổng quan kiến trúc Modular Monolith + Isolated Local Agent, 2. Nguyên tắc vận hành & tuân thủ, Kiến trúc ToolGuiZalo Pro V2, 1. Tính năng chính V2, 2. Cấu trúc mã nguồn, 3. Cài đặt & Sử dụng nhanh, Cách 1 – Chạy 1 file duy nhất (Khuyên dùng), Cách 2 – Chạy từ mã nguồn & Kiểm thử (+9 more)

### Community 5 - "TOOLGUIZALO PRO V2"
Cohesion: 0.07
Nodes (25): 1. Kiểm tra API & UI mismatch phát hiện trong V1, 2. Rà soát lưu trữ, đồng thời & độ bền tác vụ, 3. Rà soát bảo mật & chính sách nền tảng, 4. Tách trách nhiệm & hiệu năng, Kiểm toán Baseline Source V1 (`BASELINE_AUDIT.md`), 10. Bảo mật và quyền riêng tư, 11. Giao diện và chức năng, 12. Cấu trúc mã nguồn đích (+17 more)

### Community 6 - "crmRoutes.js"
Cohesion: 0.24
Nodes (11): crypto, express, fs, multer, path, router, upload, buildVariablesMap() (+3 more)

### Community 8 - "v2_suite.test.js"
Cohesion: 0.09
Nodes (18): assert, fs, http, os, path, TEMP_ROOT, test, TEST_BACKUP_DIR (+10 more)

### Community 10 - "agentManager.js"
Cohesion: 0.22
Nodes (7): executeAdapterCommand(), crypto, { fork }, path, adapter, loopMonitor, { monitorEventLoopDelay }

### Community 11 - "UserRepo"
Cohesion: 0.10
Nodes (3): AuditRepo, safeParseJson(), UserRepo

### Community 12 - "getConfig"
Cohesion: 0.42
Nodes (3): getConfig(), BackupService, sha256Hex()

### Community 14 - "writeAudit"
Cohesion: 0.06
Nodes (30): dryRun, result, { DatabaseSync }, DEFAULT_ROLES, fs, path, SCHEMA_FILE, crypto (+22 more)

### Community 16 - "healthService.js"
Cohesion: 0.22
Nodes (5): fs, getSystemHealth(), loopMonitor, { monitorEventLoopDelay }, os

### Community 17 - "v1CompatRoutes.js"
Cohesion: 0.15
Nodes (19): normalizePhone(), crypto, express, fs, handleSpreadsheetImport(), multer, path, router (+11 more)

### Community 18 - "src/app.js"
Cohesion: 0.13
Nodes (26): express@^4.19.2, express, createApp(), express, fs, path, attachCorrelationId(), createRateLimiter() (+18 more)

### Community 20 - "database.js"
Cohesion: 0.17
Nodes (7): result, res, crypto, { DatabaseSync }, fs, path, zlib

### Community 21 - "steps"
Cohesion: 0.12
Nodes (16): jobs, test-and-verify, name, on, pull_request, push, branches, branches (+8 more)

### Community 22 - "excelSecurity.js"
Cohesion: 0.36
Nodes (7): handleImageUpload(), detectImageMagic(), path, sanitizeFilename(), sanitizeSpreadsheetCell(), validateSpreadsheetUpload(), validateUploadedImage()

### Community 27 - "authRoutes.js"
Cohesion: 0.53
Nodes (4): parseSchema(), validateBody(), validateValue(), ValidationError

### Community 28 - "zaloWebAdapter.js"
Cohesion: 0.29
Nodes (4): { chromium }, fs, path, VIEWPORT_SIZE

### Community 29 - "config.js"
Cohesion: 0.29
Nodes (5): crypto, ensureOrLoadLocalSecret(), fs, path, ROOT_DIR

## Knowledge Gaps
- **1 isolated node(s):** `RFC-6238`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 229 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ZaloOfficialAdapter` connect `CampaignService` to `src/app.js`, `writeAudit`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **What connects `RFC-6238` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `core.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10299003322259136 - nodes in this community are weakly interconnected._
- **Why does `getConfig()` connect `getConfig` to `core.test.js`, `server.js`, `CampaignService`, `crmRoutes.js`, `ZaloWebAdapter`, `agentManager.js`, `writeAudit`, `healthService.js`, `v1CompatRoutes.js`, `src/app.js`, `database.js`, `excelSecurity.js`, `agentManager.js`, `DbManager`, `zaloWebAdapter.js`, `config.js`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.10276679841897234 - nodes in this community are weakly interconnected._
- **Should `CampaignService` be split into smaller, more focused modules?**
  _Cohesion score 0.04931972789115646 - nodes in this community are weakly interconnected._
- **Should `TOOLGUIZALO PRO V2` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._