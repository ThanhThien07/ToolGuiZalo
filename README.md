# ToolGuiZalo Pro V2 – Nền tảng Quản lý Khách hàng & Tác vụ Đa thiết bị

Ứng dụng Web chạy **local** (Express + SQLite WAL + Incremental SSE) kết hợp **Local Agent tách tiến trình** để quản lý khách hàng, kiểm soát đồng ý nhận tin (**Consent / Opt-out**), điều phối chiến dịch bền vững, theo dõi hộp thư hội thoại và đồng bộ Delta đa thiết bị có xác thực.

> Lưu ý: Tải về chỉ cần 1 file duy nhất **[ToolGuiZalo_Setup.exe](ToolGuiZalo_Setup.exe)** — nháy đúp là tự bung vào `C:\ToolGuiZalo`, tự mở Terminal khởi chạy server tại `http://127.0.0.1:3000` và lưu dữ liệu riêng tại `%LOCALAPPDATA%\ToolGuiZalo` để cập nhật không bao giờ mất dữ liệu.

---

## 1. Tính năng chính V2

- **Xác thực & Phân quyền RBAC (`admin`, `operator`, `viewer`):**
  - Thiết lập tài khoản Quản trị viên lần đầu qua giao diện Web (`Argon2id` password hash, TOTP MFA 2 lớp, session cookie `HttpOnly` + Bearer token).
  - Ràng buộc `127.0.0.1` mặc định, kiểm tra Origin/CORS, giới hạn request, che PII (`0912***678`, token, cookie) trong log.
- **Lưu trữ SQLite WAL (`node:sqlite`) & Migration an toàn:**
  - Tự động sao lưu `data/database.json` + ảnh trước khi migrate sang `data/toolguizalo.db` (`WAL`, `foreign_keys = ON`, `busy_timeout = 5000`).
  - Bảo toàn lịch sử chiến dịch qua bảng `campaigns` và `campaign_contacts`.
- **Quản lý Khách hàng, Consent & Danh sách Từ chối (Opt-out):**
  - Nhập văn bản / Excel/CSV có **xem trước & ánh xạ cột**; kiểm tra magic bytes & dung lượng upload; chuẩn hóa SĐT Việt Nam (`phoneUtils.js`); gắn tag và phân trang phía server (kiểm thử 50.000 bản ghi p95 < 50ms).
  - Chỉ gửi tin cho khách `OPTED_IN` (khi bật yêu cầu Consent); danh sách `OPTED_OUT` chặn toàn hệ thống.
  - Xuất báo cáo Excel (`.xlsx`) có chống CSV/Formula Injection (`=`, `+`, `-`, `@`).
- **Mẫu tin nhắn chuẩn hóa (không Spintax né spam):**
  - Hỗ trợ biến cá nhân hóa (`{ten}`, `{sdt}`, `{thong_tin}`, `{ghi_chu}`, cột Excel mở rộng), kiểm tra biến thiếu và phê duyệt mẫu theo phiên bản.
- **Chiến dịch & Task Engine bền vững:**
  - Trạng thái tác vụ: `PENDING → ASSIGNED → PROCESSING → COMPLETED / FAILED / REVIEW / CANCELLED`.
  - Hỗ trợ `ZaloOfficialAdapter` (ưu tiên OA API + webhook signature), `ZaloWebAdapter` (Playwright chạy ở tiến trình Agent tách biệt, chỉ chụp màn hình khi popup xem đang mở), và `MockSandboxAdapter` (kiểm thử không gửi tin thật).
  - Tuân thủ giới hạn nền tảng: **loại bỏ hoàn toàn** preset gửi siêu tốc, tự kết bạn khi bị chặn và nhảy nick né `RATE_LIMITED` (tạm dừng chiến dịch ngay khi gặp giới hạn). Kết quả không xác định hoặc gián đoạn khi restart chuyển sang hàng chờ **REVIEW** để tránh gửi trùng.
- **Hộp thư Inbox theo ID ổn định:**
  - Liên kết theo ID hội thoại; các tên hiển thị trùng nhau được gắn cờ `NEEDS_VERIFICATION` để xác minh SĐT thủ công.
- **Thiết bị & Đồng bộ Delta xác thực:**
  - Ghép thiết bị bằng mã dùng 1 lần, cấp token có thể thu hồi, đồng bộ qua `outbox`, `tombstones` và đưa xung đột vào hàng chờ duyệt.
- **Sao lưu Mã hóa & Giám sát:**
  - Tạo bản sao lưu nén + mã hóa `AES-256-GCM` + kiểm tra `SHA-256` & `PRAGMA integrity_check`; phục hồi được vào môi trường DB sạch.
  - Giám sát RAM, CPU, Event Loop Lag, dung lượng SQLite WAL và nhật ký Audit Logs.

---

## 2. Cấu trúc mã nguồn

```text
ToolGuiZalo/
├── server.js                    # HTTP entrypoint (bind 127.0.0.1, graceful shutdown)
├── package.json                 # Khai báo script start, migrate, backup, restore, lint, test
├── start.bat                    # Launcher Windows tự mở Terminal + bảo toàn dữ liệu ngoài app
├── build_exe.bat                # Đóng gói thành 1 file duy nhất ToolGuiZalo_Setup.exe
├── sfx_config.txt               # Cấu hình SFX tự mở Terminal chạy start.bat
├── node.exe                     # Node.js v24 Portable đi kèm
├── .env.example                 # Mẫu biến môi trường (HOST, PORT, ZALO_OA_*, BACKUP_*)
├── installer/ToolGuiZalo.iss    # Script Inno Setup chuẩn Windows
│
├── src/
│   ├── app.js                   # Express app factory & gắn SSE / middleware
│   ├── config.js                # Quản lý cấu hình & đường dẫn dữ liệu
│   ├── phoneUtils.js            # Chuẩn hóa & kiểm tra SĐT Việt Nam
│   ├── templateEngine.js        # Thay thế biến cá nhân hóa & kiểm tra biến thiếu
│   ├── storage.js               # Facade tương thích đọc/ghi vào SQLite
│   ├── zaloBot.js               # Điều phối phiên, chiến dịch & phản hồi
│   ├── p2pSync.js               # Client đồng bộ Delta xác thực
│   ├── adapters/                # channelAdapter, zaloOfficialAdapter, zaloWebAdapter, mockSandboxAdapter
│   ├── agent/                   # agentManager, agentWorker, adapterCommands (tiến trình tách biệt)
│   ├── db/                      # schema.sql, database.js, migration.js & repositories/
│   ├── middleware/security.js   # Auth, RBAC, Origin/CSRF, Rate Limit, Error Handler
│   ├── realtime/sseHub.js       # SSE incremental + replay theo eventId
│   ├── routes/                  # authRoutes, crmRoutes, campaignRoutes, opsRoutes, v1CompatRoutes
│   ├── services/                # authService, campaignService, backupService, deltaSyncService, healthService, reportService
│   └── utils/                   # logger (PII masking), cryptoUtils (Argon2id/AES-GCM/TOTP), validator, excelSecurity
│
├── public/                      # Web UI ES Modules (Light/Dark Mode, 12 màn hình V2)
│   ├── index.html
│   ├── styles.css
│   └── js/                      # api.js, state.js, realtime.js, app.js, panels_ops.js
│
├── scripts/                     # CLI migrate_json_to_sqlite.js, create_backup.js, restore_backup.js
├── docs/                        # BASELINE_AUDIT.md, ARCHITECTURE_V2.md
└── tests/                       # unit/, integration/, performance/ (benchmark 50.000 bản ghi)
```

---

## 3. Cài đặt & Sử dụng nhanh

### Cách 1 – Chạy 1 file duy nhất (Khuyên dùng)
Tải **[ToolGuiZalo_Setup.exe](ToolGuiZalo_Setup.exe)** và nháy đúp:
- Tự bung ứng dụng vào `C:\ToolGuiZalo` và tạo shortcut trên Desktop.
- Tự động mở cửa sổ Terminal chạy Web Server và mở trình duyệt tới `http://127.0.0.1:3000`.
- Dữ liệu (`toolguizalo.db`, backup, ảnh, phiên trình duyệt) được lưu tách biệt tại `%LOCALAPPDATA%\ToolGuiZalo`, nên tải bản mới về chạy đè cũng **không mất dữ liệu**.

### Cách 2 – Chạy từ mã nguồn & Kiểm thử
```bash
npm install
npm run lint
npm test
npm run test:perf
npm start
```
Hoặc nháy đúp [start.bat](start.bat). Trong lần mở đầu tiên, tạo tài khoản `admin` trên màn hình thiết lập để bắt đầu sử dụng.

### Đóng gói lại thành 1 file `.exe`
Chạy [build_exe.bat](build_exe.bat) để tạo `ToolGuiZalo_Setup.exe` (không đóng gói `data/`, `user_data/`, `uploads/`, `.env`).
