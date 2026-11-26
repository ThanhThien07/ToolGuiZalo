# Kiểm toán Baseline Source V1 (`BASELINE_AUDIT.md`)

Tài liệu ghi nhận kết quả kiểm tra mã nguồn V1 thực tế trước khi nâng cấp lên V2 theo [ToolGuiZalo_Pro_V2_Roadmap.md](../ToolGuiZalo_Pro_V2_Roadmap.md).

## 1. Kiểm tra API & UI mismatch phát hiện trong V1

| Vị trí | Vấn đề thực tế trong source V1 | Mức độ | Giải pháp V2 |
|---|---|---|---|
| `public/app.js` vs `server.js` | Frontend gọi `POST /api/contacts/import-excel` và đọc `data.addedCount`, trong khi backend chỉ có `POST /api/contacts/import-file` và trả `data.added`. Upload Excel lỗi ngay trên UI. | Nghiêm trọng | Chuẩn hóa `/api/v2/contacts/import-file` (+ preview & mapping cột), giữ adapter V1 cho cả hai endpoint. |
| `public/app.js` vs `server.js` | Frontend gọi `POST /api/images` (`data.images`) và `DELETE /api/images/:index`; backend định nghĩa `POST /api/images/upload` (`attachedImages`) và `DELETE /api/images/:id`. | Nghiêm trọng | Thống nhất API `/api/v2/attachments` + giữ adapter tương thích đúng. |
| `public/app.js` vs `server.js` | Nút đặt lại các dòng đã chọn gọi `PATCH /api/contacts/:id` nhưng route này chưa từng được khai báo trên `server.js`. | Cao | Bổ sung `PATCH /api/v2/contacts/:id` và alias V1. |
| `src/zaloBot.js` | `pollPhoneLookupResult` trả mặc định `NOT_REGISTERED` khi hết timeout (3.2s) thay vì phân biệt lỗi mạng/chậm → `REVIEW`. | Cao | Phân loại trạng thái `REVIEW` khi kết quả thao tác ngoài không chắc chắn. |

## 2. Rà soát lưu trữ, đồng thời & độ bền tác vụ

1. `src/storage.js` lưu toàn bộ trạng thái (`accounts`, `contacts`, `phoneCache`, `logs`) vào `data/database.json` bằng `fs.writeFileSync` mỗi lần ghi log hoặc cập nhật contact. Khi có nhiều tác vụ hoặc crash giữa chừng có thể hỏng file hoặc nghẽn I/O.
2. `src/taskEngine.js` giữ toàn bộ hàng đợi và `worker` trong RAM; mất điện hoặc restart sẽ mất lịch sử/trạng thái tác vụ đang chạy (`PROCESSING` chỉ reset chung về `PENDING` khi gọi `prepareContactsForCampaign`).
3. `appendContacts` đặt lại kết quả cũ của contact trên cùng một bản ghi thay vì tách lịch sử từng chiến dịch (`campaigns`, `campaign_contacts`).
4. Ghép phản hồi khách dựa theo tên hiển thị (`Khiêm`) dễ nhầm khi nhiều người trùng tên.

## 3. Rà soát bảo mật & chính sách nền tảng

1. `server.js` bind mặc định `0.0.0.0`, chưa có xác thực người dùng, chưa kiểm tra RBAC/CSRF trên các API nhạy cảm (`/api/browser/screenshot`, `/api/browser/click`, `/api/sync/*`).
2. `src/p2pSync.js` đọc `data/hub_config.json` (chứa IP/hostname thực) và đẩy toàn bộ danh bạ qua kênh `ntfy.sh` công khai.
3. Upload file chỉ kiểm tra phần mở rộng từ `originalname` phía client hoặc không kiểm tra magic bytes; xuất Excel chưa thoát ký tự đầu `= + - @` (formula injection).
4. Log hệ thống ghi số điện thoại và nội dung tin nhắn dạng rõ (chưa mask PII).
5. Tồn tại các cơ chế V1 cần loại bỏ theo Roadmap Mục 1 & 17:
   - Preset `TURBO` (`0–1s`, không nghỉ chặng).
   - Tự động chuyển sang tài khoản khác để vượt giới hạn tìm kiếm khi gặp `RATE_LIMITED`.
   - Tùy chọn tự kết bạn khi bị chặn (`autoAddFriendWhenBlocked`).
   - Biến đổi nội dung ngẫu nhiên Spintax (`{a|b|c}`) nhằm né bộ lọc spam.
   - Thiếu bảng và kiểm tra đồng ý nhận tin (`contact_consents`) / danh sách từ chối (`opt-out`).

## 4. Tách trách nhiệm & hiệu năng

1. `src/zaloBot.js` (~2.215 dòng) trộn lẫn quản lý tiến trình trình duyệt Chromium, vòng chạy chiến dịch, kiểm tra lịch hẹn, quét hội thoại và phát SSE.
2. `public/app.js` (~2.189 dòng) là file đơn lớn, thực hiện polling `/api/replies` mỗi 2.5s song song với SSE, và render lại toàn bộ bảng danh sách khi chỉ 1 contact thay đổi.
3. Kết quả quét baseline (trước khi nâng cấp): `node:sqlite` và `crypto.argon2Sync` chạy native trên Node v24.15.0 không cần compile addon C++.
