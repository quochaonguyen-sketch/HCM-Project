> Lưu tham khảo: dashboard hiện dùng tab riders/staff trong backend Google Sheets, không cần khôi phục BigQuery cho hai module này. Gói dưới đây không được export vào app.

# Khôi phục bảng Rider bị thiếu

Các file ở đây được lấy từ `FLM_Rider_Missing_Table_Patch_v3.zip` do người dùng cung cấp. Đây là mã cho project ingestion, không phải app dashboard; `local/export.cjs` không đưa chúng vào `dist/apps-script`.

Đích: `root-opus-497613-d8.hubops_pilot.flm_rider_resource_v1`, location `asia-southeast1`. Hai file `.gs` dùng namespace riêng và chỉ cho tài khoản owner cấu hình trong `FLMRR_CFG.owner` chạy. Không đổi owner thành tài khoản web app để chạy thử.

1. Xác định project ingestion đang nạp Rider và đối chiếu code/config/trigger hiện có. Nếu có loader `PeopleIngest`, đối chiếu rồi áp `PeopleIngest.RIDER_ONLY.patch` tại đó. Workspace này chưa có source loader thật nên chưa áp diff đó.
2. Thêm `RiderCore.gs` và `RiderRepair.gs` vào cùng project ingestion. Project cần Advanced Services Sheets v4 và BigQuery v2, cùng quyền đọc nguồn và nạp dữ liệu của owner.
3. Owner chạy `flmRiderRepairPreview()`. Chỉ tiếp tục khi trả `READY_FOR_START`; bước này chưa ghi BigQuery.
4. Chạy `flmRiderRepairStart()`, rồi `flmRiderRepairContinue()` để poll các job LOAD/COPY đã lưu. Tiếp tục đến `SUCCESS`; xem trạng thái bằng `flmRiderRepairStatus()`.
5. Sau SUCCESS, kiểm schema/count/job thật rồi kiểm summary và danh sách Rider qua scope tài khoản thật trên app.

Bootstrap từ chối ghi đè bảng đã tồn tại, giữ checkpoint khi lỗi và không tạo trigger đồng bộ mới. Không xóa checkpoint hoặc gửi lại job khi kết quả gửi chưa rõ. Loader Rider cũ và repair phải dùng chung project/ScriptLock; nếu có writer ở project khác, cần đối soát writer đó trước. Bảng FTE không nằm trong luồng repair.

Phía app đã bổ sung lỗi `RIDER_DATA_NOT_PUBLISHED`, sửa truy vấn dùng `last_work_date`, kiểm schema Rider riêng và không thay lỗi BigQuery Rider bằng số liệu operational/local. Luồng local khi không có BigQuery vẫn dùng dữ liệu kiểm thử hiện có.

Kiểm thử app: `node local/people-sheets.test.cjs`, `node local/people.test.cjs`, `node local/check.cjs`. Mã repair được kiểm bằng 42 test mock trong ZIP; kết quả mock không chứng minh bảng BigQuery thật đã được tạo. Chưa chạy repair hoặc deploy trong phiên này.
