# Graph Report - ToolGuiZalo  (2026-11-14)

## Corpus Check
- 12 files · ~30,619 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .exe 3, .bat 2, (none) 1)

## Summary
- 420 nodes · 704 edges · 18 communities (11 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b83790f4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- server.js
- package.json
- ZaloBot
- Storage
- initApp
- ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại
- openQrModal
- applySettingsToForm
- collectSettingsFromForm
- TaskEngine
- P2PSyncEngine
- with
- steps
- p2pSync.js
- zaloBot.js
- storage.js
- renderMessage

## God Nodes (most connected - your core abstractions)
1. `ZaloBot` - 56 edges
2. `Storage` - 34 edges
3. `P2PSyncEngine` - 31 edges
4. `TaskEngine` - 18 edges
5. `connectSSE()` - 15 edges
6. `initApp()` - 11 edges
7. `escapeHtml()` - 9 edges
8. `switchPanel()` - 9 edges
9. `with` - 9 edges
10. `updatePanelBadges()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `buildContactRecord()` --calls--> `normalizePhone()`  [EXTRACTED]
  server.js → src/phoneUtils.js

## Import Cycles
- None detected.

## Communities (18 total, 7 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.02
Nodes (114): accountsListContainer, activeHoursBlock, attachedImagesContainer, badgeAccountsCount, badgeContactsTotal, badgeImagesTotal, badgeLocalSyncStatus, badgeMasterTargetHost (+106 more)

### Community 1 - "server.js"
Cohesion: 0.14
Nodes (13): app, buildContactRecord(), cors, express, fs, IMAGES_DIR, multer, path (+5 more)

### Community 2 - "package.json"
Cohesion: 0.13
Nodes (18): dependencies, cors@^2.8.5, express@^4.19.2, multer@^1.4.5-lts.1, playwright@^1.48.0, xlsx@^0.18.5, description, main (+10 more)

### Community 5 - "initApp"
Cohesion: 0.17
Nodes (25): closeQrModal(), connectSSE(), escapeHtml(), formatBadge(), getUniqueRepliedContacts(), initApp(), loadReplies(), loadSyncInfo() (+17 more)

### Community 6 - "ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại"
Cohesion: 0.50
Nodes (3): Cách chạy, ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại, Tính năng chính

### Community 8 - "applySettingsToForm"
Cohesion: 0.40
Nodes (5): applySettingsToForm(), setSpeedPreset(), toLocalDatetimeInputValue(), updateScheduleVisualState(), updateSpeedPresetUI()

### Community 12 - "with"
Cohesion: 0.06
Nodes (34): runs-on, steps, environment, needs, permissions, runs-on, steps, env (+26 more)

### Community 13 - "steps"
Cohesion: 0.12
Nodes (19): runs-on, steps, NODE_AUTH_TOKEN, jobs, build, publish-npm, name, on (+11 more)

### Community 14 - "p2pSync.js"
Cohesion: 0.13
Nodes (10): cleanTopicKey(), dgram, EventEmitter, fs, https, HUB_CONFIG_FILE, os, p2pSync (+2 more)

### Community 15 - "zaloBot.js"
Cohesion: 0.17
Nodes (10): EventEmitter, BASE_USER_DATA_DIR, { chromium }, EventEmitter, fs, path, STATUS_LABELS, STATUS_PRIORITY (+2 more)

### Community 16 - "storage.js"
Cohesion: 0.22
Nodes (6): DATA_DIR, DB_FILE, DEFAULT_ACCOUNTS, DEFAULT_STATE, fs, path

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ZaloBot` connect `ZaloBot` to `zaloBot.js`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.017391304347826087 - nodes in this community are weakly interconnected._
- **Why does `Storage` connect `Storage` to `storage.js`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.14166666666666666 - nodes in this community are weakly interconnected._
- **Why does `P2PSyncEngine` connect `P2PSyncEngine` to `p2pSync.js`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13450292397660818 - nodes in this community are weakly interconnected._
- **Should `ZaloBot` be split into smaller, more focused modules?**
  _Cohesion score 0.10064935064935066 - nodes in this community are weakly interconnected._