# Graph Report - ToolGuiZalo  (2026-11-13)

## Corpus Check
- 8 files · ~19,447 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 1, .css 1, .bat 1)

## Summary
- 261 nodes · 429 edges · 10 communities (6 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `648ba3f3`
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

## God Nodes (most connected - your core abstractions)
1. `ZaloBot` - 52 edges
2. `Storage` - 28 edges
3. `initApp()` - 10 edges
4. `connectSSE()` - 8 edges
5. `escapeHtml()` - 7 edges
6. `renderStatus()` - 6 edges
7. `switchPanel()` - 6 edges
8. `renderTable()` - 6 edges
9. `sleep()` - 6 edges
10. `updateOverviewChart()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `buildContactRecord()` --calls--> `normalizePhone()`  [EXTRACTED]
  server.js → src/phoneUtils.js

## Import Cycles
- None detected.

## Communities (10 total, 4 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.02
Nodes (96): accountsListContainer, activeHoursBlock, attachedImagesContainer, badgeAccountsCount, badgeContactsTotal, badgeImagesTotal, badgeRepliesCount, badgeScheduleState (+88 more)

### Community 1 - "server.js"
Cohesion: 0.07
Nodes (28): app, buildContactRecord(), cors, express, fs, IMAGES_DIR, multer, path (+20 more)

### Community 2 - "package.json"
Cohesion: 0.13
Nodes (18): dependencies, cors@^2.8.5, express@^4.19.2, multer@^1.4.5-lts.1, playwright@^1.48.0, xlsx@^0.18.5, description, main (+10 more)

### Community 5 - "initApp"
Cohesion: 0.24
Nodes (17): closeQrModal(), connectSSE(), escapeHtml(), formatBadge(), initApp(), loadReplies(), renderAccounts(), renderAttachedImages() (+9 more)

### Community 6 - "ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại"
Cohesion: 0.50
Nodes (3): Cách chạy, ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại, Tính năng chính

### Community 8 - "applySettingsToForm"
Cohesion: 0.67
Nodes (3): applySettingsToForm(), toLocalDatetimeInputValue(), updateScheduleVisualState()

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ZaloBot` connect `ZaloBot` to `server.js`?**
  _High betweenness centrality (0.144) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.020618556701030927 - nodes in this community are weakly interconnected._
- **Why does `Storage` connect `Storage` to `server.js`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07057057057057058 - nodes in this community are weakly interconnected._
- **Why does `playwright` connect `package.json` to `server.js`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13450292397660818 - nodes in this community are weakly interconnected._
- **Should `ZaloBot` be split into smaller, more focused modules?**
  _Cohesion score 0.10708898944193061 - nodes in this community are weakly interconnected._