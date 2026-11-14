# Graph Report - ToolGuiZalo  (2026-11-14)

## Corpus Check
- 10 files · ~26,887 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: .exe 3, .bat 2, (none) 1)

## Summary
- 335 nodes · 570 edges · 12 communities (7 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `07dbf697`
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

## God Nodes (most connected - your core abstractions)
1. `ZaloBot` - 56 edges
2. `Storage` - 32 edges
3. `TaskEngine` - 18 edges
4. `P2PSyncEngine` - 16 edges
5. `connectSSE()` - 14 edges
6. `initApp()` - 11 edges
7. `escapeHtml()` - 9 edges
8. `switchPanel()` - 9 edges
9. `updatePanelBadges()` - 7 edges
10. `renderReplies()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `buildContactRecord()` --calls--> `normalizePhone()`  [EXTRACTED]
  server.js → src/phoneUtils.js

## Import Cycles
- None detected.

## Communities (12 total, 5 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.02
Nodes (110): accountsListContainer, activeHoursBlock, attachedImagesContainer, badgeAccountsCount, badgeContactsTotal, badgeImagesTotal, badgeRepliesCount, badgeScheduleState (+102 more)

### Community 1 - "server.js"
Cohesion: 0.06
Nodes (31): app, buildContactRecord(), cors, express, fs, IMAGES_DIR, multer, path (+23 more)

### Community 2 - "package.json"
Cohesion: 0.13
Nodes (18): dependencies, cors@^2.8.5, express@^4.19.2, multer@^1.4.5-lts.1, playwright@^1.48.0, xlsx@^0.18.5, description, main (+10 more)

### Community 5 - "initApp"
Cohesion: 0.18
Nodes (24): closeQrModal(), connectSSE(), escapeHtml(), formatBadge(), getUniqueRepliedContacts(), initApp(), loadReplies(), loadSyncInfo() (+16 more)

### Community 6 - "ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại"
Cohesion: 0.50
Nodes (3): Cách chạy, ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại, Tính năng chính

### Community 8 - "applySettingsToForm"
Cohesion: 0.40
Nodes (5): applySettingsToForm(), setSpeedPreset(), toLocalDatetimeInputValue(), updateScheduleVisualState(), updateSpeedPresetUI()

### Community 11 - "P2PSyncEngine"
Cohesion: 0.14
Nodes (5): dgram, EventEmitter, os, p2pSync, P2PSyncEngine

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ZaloBot` connect `ZaloBot` to `server.js`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.018018018018018018 - nodes in this community are weakly interconnected._
- **Why does `Storage` connect `Storage` to `server.js`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06463414634146342 - nodes in this community are weakly interconnected._
- **Why does `TaskEngine` connect `TaskEngine` to `server.js`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13450292397660818 - nodes in this community are weakly interconnected._
- **Should `ZaloBot` be split into smaller, more focused modules?**
  _Cohesion score 0.10064935064935066 - nodes in this community are weakly interconnected._