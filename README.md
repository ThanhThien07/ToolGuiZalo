# ToolGuiZalo - Web App Tự Động Gửi Tin Nhắn Zalo & Xuất Báo Cáo Phân Loại

Ứng dụng Web chạy local kết hợp trình duyệt tự động **Playwright** giúp tự động tìm kiếm số điện thoại trên Zalo Web (`chat.zalo.me`), gửi tin nhắn cá nhân hóa theo danh sách và xuất báo cáo Excel phân loại chi tiết.

## Tính năng chính

1. **Nạp danh sách linh hoạt (Excel / CSV / Dán văn bản):**
   - Hỗ trợ upload file `.xlsx`, `.xls`, `.csv` hoặc dán danh sách trực tiếp.
   - Tự động chuẩn hóa SĐT Việt Nam (`+84...`, `84...`, mất số `0` đầu ở Excel $\rightarrow$ `09xxxxxxxx`) và lọc số trùng lặp / sai định dạng.
2. **Cá nhân hóa nội dung & Spintax chống khóa tài khoản:**
   - Gán biến động theo từng khách hàng: `{ten}`, `{sdt}`, `{thong_tin}`, `{ghi_chu}` hoặc bất kỳ tên cột nào trong file Excel.
   - Hỗ trợ cú pháp trộn nội dung **Spintax**: `{Xin chào|Chào|Em chào}` giúp mỗi tin nhắn gửi đi có câu chữ tự nhiên.
   - Hỗ trợ cột **Nội dung riêng** cho từng SĐT.
3. **Tự động phân loại & lập danh sách báo cáo:**
   - **Đã gửi thành công (`THANH_CONG`)**
   - **Bị chặn người lạ (`CHAN_NGUOI_LA`):** Phát hiện thông báo *"Bạn chưa thể gửi tin nhắn cho người này vì người này chặn không nhận tin nhắn từ người lạ"*.
   - **Chưa đăng ký Zalo / Chặn tìm kiếm SĐT (`KHONG_DANG_KY`):** Phát hiện thông báo *"Số điện thoại chưa đăng ký tài khoản hoặc không cho phép tìm kiếm"*.
   - **Xuất file báo cáo Excel (`.xlsx`)** chia sẵn 5 Sheet riêng biệt: `1_Tong_Hop`, `2_Bi_Chan_Nguoi_La`, `3_Chua_Dang_Ky_Zalo`, `4_Gui_Thanh_Cong`, `5_Sai_So_Hoac_Loi`.
4. **Cơ chế tối ưu bảo vệ tài khoản Zalo:**
   - Lưu phiên đăng nhập Zalo Web vào `user_data/zalo_profile` (chỉ cần quét QR 1 lần).
   - Nghỉ ngẫu nhiên giữa 2 SĐT (`Min - Max` giây) + Nghỉ giải lao theo chặng (`Batch Pause`).
   - Bộ nhớ **Cache SĐT**: Tự động nhận biết SĐT đã từng kiểm tra là *"Chưa đăng ký Zalo"* để không tốn lượt tìm kiếm SĐT trong ngày.
   - Tự động **Tạm dừng (Auto-Pause)** khi Zalo cảnh báo giới hạn tìm kiếm.

## Cách chạy

```bash
npm install
npm start
```

Hoặc nháy đúp vào file `start.bat` trên Windows, sau đó mở trình duyệt tại:
👉 **http://localhost:3000**
