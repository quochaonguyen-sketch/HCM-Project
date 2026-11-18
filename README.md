# HCM - FLM Hub Ops Dashboard — local và Apps Script

## Test không cần dữ liệu riêng tư

Chạy `npm run test:local` với Node.js >=18. Bộ test dùng dữ liệu tổng hợp trong thư mục tạm riêng cho từng nhóm, tự dọn sau khi chạy và không đọc/ghi dữ liệu local đang có. Không cần cài dependency, workbook hay credentials. Xem [hướng dẫn môi trường test và local](docs/local-development.md) để biết phạm vi kiểm tra và các test cũ cần dữ liệu gốc.

## Chạy local

Mở PowerShell trong thư mục dự án và chạy `./start-local.ps1`, sau đó mở http://127.0.0.1:3000.
Nếu đã cài Node.js 18+: `npm run dev`. Đổi cổng bằng biến môi trường `PORT`.

Local đọc trực tiếp `index.html`, `Styles.html`, `Theme.html`, `Javascript.html` mỗi lần tải trang. Sửa file rồi refresh trình duyệt. Không có bản sao giao diện riêng cần sửa thêm.

Local thực thi cùng mã `.gs` qua Node VM, với SpreadsheetApp, CacheService, PropertiesService và Session được mô phỏng. Các hàm xử lý dữ liệu, phân quyền và lọc HUB dùng chung với production. Sau khi sửa `.gs` hoặc runtime local, khởi động lại server.

Tài khoản mặc định là ADMIN giả `admin@example.test`. Không xác thực Google, không kết nối Google Sheets, BigQuery hay Drive thật. Kiểm thử dịch vụ Google và xác thực thật vẫn cần môi trường Apps Script test.

## Excel và mock

Hai workbook gốc được giữ nguyên. `local/import-workbooks.py` đọc cached values vào `local/workbooks.private.json`; công thức không có cached value được coi là thiếu. Chạy lại importer bằng Python có openpyxl khi thay workbook, rồi restart server.

- Back-end: D0, DTC, backlog history và FC.
- Front-end: Permission, KPI, targets, forecast, bản đồ, tài khoản và cấu hình.

Các giá trị có sẵn, không trống được giữ nguyên. `local/sample-data.cjs` bổ sung mock ổn định cho ô KPI thiếu, HUB/ngày KPI thiếu trong tháng hiện tại, HUB chưa có dòng D0/DTC/FC và attendance giờ. `local/mock-bigquery.cjs` cấp dữ liệu giả cho Backlog & Volume, Prelost/Alerts và Lost vì hai workbook chưa có các bảng BigQuery tương ứng.

Banner màu cam ghi `LOCAL · Excel + MOCK`. Xem `/api/local-data` để kiểm tra tóm tắt nguồn; `local/provenance.private.json` ghi các ô/dòng bổ sung. Mock không phải kết quả vận hành thực tế. Ngày của dữ liệu thật không bị đổi thành ngày hiện tại; Source Health vẫn có thể báo nguồn cũ hoặc thiếu.

Thay đổi quản trị local được lưu riêng trong `local/state.private.json`, không ghi vào Excel hay production. Di chuyển file này sang bản lưu khác và restart để reset trạng thái thử nghiệm. Excel, dữ liệu nhập, trạng thái và provenance được loại khỏi Git và gói production.

## Một nguồn mã cho hai môi trường

1. Sửa các file `.gs` và `.html` tại thư mục gốc.
2. `npm run check` kiểm tra cú pháp/khởi tạo với dữ liệu local; `npm run test:local` kiểm tra API và phạm vi quyền với dữ liệu tổng hợp cách ly. Kiểm thử dịch vụ Google trên Apps Script test trước khi phát hành.
3. Tạo gói: `npm run build:production`. Dùng các file trong `dist/apps-script/` để cập nhật cùng dự án Apps Script. `dist/source-hashes.json` ghi SHA-256 cho từng file để đối chiếu.
4. Trong Apps Script, thay các file tương ứng; giữ nguyên manifest `appsscript.json`, Script Properties, quyền và cấu hình hiện tại. Tạo version mới rồi cập nhật deployment hiện có sau khi kiểm thử. Có thể quay lại version trước bằng giao diện quản lý deployments.

Gói đổi `index.html` thành `Index.html` đúng với `doGet()`. `Theme.html` được bổ sung làm điểm mở rộng rỗng vì bản nguồn thiếu file này; CSS gốc vẫn nằm trong `Styles.html`.

`WorkspaceApi.gs` bổ sung entry point KPI/Forecast và API D0 mà bộ mã được cung cấp đang thiếu. File này dùng SpreadsheetApp thật trên production, không có danh tính local hoặc mock. Nếu dự án Apps Script có hàm cùng tên trong file khác, cập nhật định nghĩa tương ứng để tránh trùng hàm. Cần Script Properties `APP_DB_SHEET_ID`, `D0_DB_SHEET_ID`; `KPI_DAILY_DB_SHEET_ID` là tùy chọn khi dùng file archive riêng.

`Deoloyments.gs` đang trùng byte với `DailyKPIDirect.gs`, nên gói chỉ chứa `DailyKPIDirect.gs`. Nếu project Apps Script có cả hai, loại bỏ file trùng khi cập nhật để tránh hai định nghĩa hàm/const. Tool sẽ dừng nếu hai file không còn giống nhau; sửa `DailyKPIDirect.gs` và đồng bộ bản trùng hoặc loại bỏ bản trùng khỏi nguồn trước khi build.

Không tự động push/deploy. Bạn sao chép mã từ `dist/apps-script/` theo quy trình đã chọn. Gói không chứa `local/`, Excel hoặc dữ liệu mock; giữ nguyên manifest và cấu hình triển khai hiện tại.

## LM throughput theo giờ

D0 → LM đọc sheet `Throughput Hourly D0` trong database cấu hình bằng `D0_DB_SHEET_ID`. Giữ nguyên các header của CSV, gồm `station_id`, `station_name`, `grass_date`, `hour`, `fetched_at` và các cột `lm_hub_*_in_system_order_qty_1h`. Production đọc sheet này trực tiếp; không đọc file CSV trên máy.

Local dùng dữ liệu CSV thật trong `local/hourly.private.json`, không mock HUB hoặc giờ bị thiếu. Nhập mẫu mới bằng `python local/import-hourly.py "đường dẫn CSV"` rồi khởi động lại server. Biểu đồ dùng ngày mới nhất của nguồn, lọc theo quyền và phạm vi HUB; ô trống là thiếu dữ liệu, số 0 là quan sát hợp lệ. Dòng trùng HUB/giờ lấy bản có `fetched_at` mới nhất. Bộ chọn của biểu đồ chỉ liệt kê HUB có dữ liệu cho chỉ số đang chọn. Có thể kiểm tra bằng `node local/hourly.test.cjs`.

## Icon động

Morphicons 2.0.0 (MIT) được đóng gói trực tiếp trong `Javascript.html`; app không tải thư viện icon từ CDN. Menu/đóng, sáng/tối và refresh dùng cùng DOM driver với hiệu ứng nhẹ, theo tùy chọn giảm chuyển động của thiết bị. SVG và driver được tái sử dụng qua các lần render; refresh chỉ quay khi đang tải.

Nguồn: https://www.morphicons.com/docs. License được giữ trong khối vendor. Khi cần build lại thư viện, dùng package cố định và lockfile trong `local/morphicons-build/`, chạy `node local/morphicons-build/build.mjs`. Kiểm tra thư viện bằng `node local/morphicons-build/test.mjs`. Không cần cài package để chạy app vì bundle đã có trong HTML.
# HCM-Project
## FM Pending Pickup: Master Tracker và HUB Breakdown

Giao diện nằm trong `FMBacklogUI.html`. `FMBacklogLive.html` gọi `getFmPendingSnapshot()` trong `FMBacklogApi.gs` để đọc trực tiếp Google Sheets **FM. Pending Pickup** (`1q-GyZsksjnYLA9kZ6m9rjwnLMT3VMSBoaL_DkLrR5Qo`): **2_Visual** (`gid=344409718`) và **3_Deck_HCM** (`gid=1233387831`). `FMBacklogTracker.html` là snapshot cũ lưu tham khảo, không còn được include, phục vụ hoặc đóng gói production.

Trang tự kiểm tra mỗi 60 giây khi đang hiển thị, tạm ngưng khi ẩn và kiểm tra lại khi quay về. Server cache hai tab tổng hợp trong 30 giây, không đọc sheet raw. **Refresh from Sheet** và nút Refresh chung bỏ qua cache. Chỉ dữ liệu có revision thay đổi mới cập nhật bảng; truy vấn, trang đang xem và vị trí cuộn được giữ lại. Khi đồng bộ lỗi, trang ghi rõ lỗi và giữ dữ liệu đã tải lần cuối; không dùng snapshot nhúng để thay thế. Tài khoản chạy deployment Apps Script cần có quyền đọc file nguồn. Không cần trigger onEdit: các thay đổi giá trị do công thức cũng được đọc ở lần kiểm tra tiếp theo sau khi Sheet tính xong.

Mỗi request kiểm tra lại quyền module/phạm vi HUB trước khi đọc cache. Hai bảng Pre-order đặt ngang trong 2_Visual được ghép bằng tên HUB, không theo vị trí dòng. Với phạm vi HUB bị giới hạn, tổng Zone được tính trong phạm vi đó; dữ liệu lịch sử thiếu hiện `—`, không dùng tổng lịch sử của cả Zone để so với một phần HUB.

Master Tracker mặc định mở **All HUBs** với toàn bộ 122 HUB trong snapshot, có thêm **Priority HUBs** và **Zone summary**. Hai nhóm nút View / Measures giữ nguyên trên màn hình khi đổi báo cáo. Master Tracker và HUB Breakdown đều phân trang 15/30/50 HUBs; tracker có nút đầu/cuối, trước/sau và chọn trang trực tiếp. Lọc hoặc đổi phạm vi đưa về trang 1; đổi nhóm chỉ số giữ trang đang xem. Xếp hạng và tỷ trọng được tính trước phân trang/lọc, backlog ≥4d lấy tổng 4d + >4d của MP/RV/NSS. Snapshot so sánh trước đó chỉ có ở 12 HUB ưu tiên: HUB còn lại hiện `—`, KPI thay đổi ghi rõ số HUB có cặp dữ liệu so sánh.

Mỗi bảng chỉ có một cột nhận diện cố định; chọn từng kênh MP/RV/NSS hoặc từng cặp thời điểm để tránh bảng quá rộng. Tìm kiếm giữ focus, không phân biệt dấu, gộp các lần gõ trong 120ms. Dữ liệu tìm kiếm/xếp hạng chuẩn bị một lần khi mở tracker; kết quả lọc được tái sử dụng khi chuyển trang/nhóm chỉ số. Chỉ render các dòng của trang hiện tại, không tạo lại nhóm nút hoặc KPI khi giá trị không đổi. CSV luôn xuất toàn bộ kết quả lọc qua mọi trang, kể cả truy vấn vừa nhập chưa hết thời gian chờ. Phần trăm thay đổi tính từ hai số hiển thị; baseline bằng 0 hiện `From 0`. Share và cumulative share dùng tổng backlog ≥4d đã báo cáo trong scope HUB được cấp quyền và đang chọn; tìm kiếm, lọc Zone, Priority HUBs và phân trang giữ nguyên mẫu số này. Cumulative share theo thứ hạng trong scope; không dùng tổng HCM cho tài khoản có phạm vi hẹp. Kiểm tra tracker bằng `node scratch/fm-ui-qa/test.cjs` sau khi cài dependencies của thư mục QA.

Nút **Mở dữ liệu raw** vẫn mở tab raw `gid=1645389409` ở tab mới. Tracker đồng bộ từ hai tab tổng hợp nêu trên, không tải 300.000 dòng raw. Các link nguồn 2_Visual / 3_Deck_HCM hiển thị ngay trên tracker.

Local không dùng phiên đăng nhập trình duyệt để đọc Sheet riêng tư. Nhập hai CSV mẫu bằng `node local/import-fm.cjs "<3_Deck_HCM.csv>" "<2_Visual.csv>"`, rồi restart server. Dữ liệu mẫu được lưu trong `local/fm-source.private.json`, nằm ngoài Git/gói production; giao diện ghi rõ **LOCAL CSV samples**. Kiểm tra bằng `node local/fm-pending.test.cjs`, `node scratch/fm-ui-qa/test.cjs`, `node scratch/fm-ui-qa/live.test.cjs` và `node local/check.cjs`. Chạy `node local/export.cjs` để tạo gói Apps Script đã nối nguồn; cập nhật deployment hiện có để bản web đang chạy dùng mã mới.

# HCM-Project

FM / LM Overview hiển thị tỉ trọng backlog của từng HUB trong HUB details, HUB watchlist và CSV: backlog HUB / tổng backlog cùng luồng FM hoặc LM đã báo cáo trong scope đang chọn × 100%. Hai luồng dùng mẫu số riêng; lọc tìm kiếm/phân trang không đổi mẫu số. Tổng bằng 0 hoặc dữ liệu thiếu hiện —; dữ liệu chỉ có một phần được ghi là reported backlog. Bảng theo ngày giữ số đơn snapshot, không cộng backlog qua nhiều ngày. Kiểm tra bằng `node scratch/fm-ui-qa/share.test.cjs`, `node local/backlog-share.test.cjs` và `node local/fm-pending.test.cjs`.

HUB & page permissions: Admin tìm người theo email, tên (hỗ trợ không dấu) hoặc vai trò, xem các HUB/trang hiện có và chọn Review & edit để nạp quyền vào form. Nhập email đã có cũng tự nạp quyền khi rời ô email. Current permissions giữ thông tin đang lưu; Access after save phản ánh lựa chọn mới. Tài khoản NORMAL không tự chọn sẵn các trang vận hành. Tài khoản Admin chỉ xem tại đây; chỉnh tại Set Account. Lưu custom access thay thế phạm vi HUB/trang từ Permission mapping, không sửa sheet Permission. Kiểm tra bằng `node local/access-grants.test.cjs` và `node local/check.cjs`.


Cấp quyền AOM dùng chung danh mục/tên/mô tả Viewing permissions với admin, gồm đủ 10 quyền. Access profile gồm HUB viewer (Daily Snapshot/KPI/D0), Operations viewer (toàn bộ danh mục) và Custom access. Đổi checkbox chuyển sang Custom; có Chọn tất cả, Bỏ chọn và Điền quyền hiện có. Chọn riêng backlog_fm/backlog_lm không tự thêm backlog tổng. Server từ chối Custom trống/quyền lạ, vẫn giữ quyền đã cấp và chỉ cho AOM cấp vào Hub đang quản lý. Test: `node local/aom-permissions.test.cjs`, `node local/access-grants.test.cjs`; bộ `local/hub-request.test.cjs` đối chiếu số quyền theo danh mục hiện tại.

FTE Resource và Rider Resource đọc trực tiếp Google Sheets backend cấu hình bằng `D0_DB_SHEET_ID`: FTE lấy tab `staff`, loại các dòng có từ Rider trong cột Vị trí; Rider lấy toàn bộ tab `riders`. Staff, Lead, Sup và các vị trí còn lại trong `staff` được giữ nguyên. Summary, danh sách Hub, hồ sơ phân trang và diagnostics đều dùng Sheets, không gọi BigQuery. Dữ liệu lấy đúng tên/mã/vị trí/ngày nhận/nghỉ trong nguồn; ngày không hợp lệ được phân loại UNKNOWN. Quyền Hub và quyền xem hồ sơ được xác minh trước mỗi lần đọc cache. Cache phiên bản `flmp-sheets-3` bỏ qua snapshot cũ còn lẫn Rider.

FTE Resource có lựa chọn **Staff / Outsource (BPO)**, dùng danh sách và cache riêng. Outsource (module BPO, dùng quyền trang `fte`) đọc tab `bpo` trong cùng backend, giữ nguyên header của CSV BPO được cung cấp. Import CSV vào tab `bpo` trước khi dùng trên app. Mỗi Mã CTV lấy dòng có Ngày làm gần nhất mới nhất; nếu cùng ngày nhưng xung đột thông tin thì báo lỗi để sửa nguồn. Các Hub cũ của mã trùng không được đếm lại. Ngày làm gần nhất và Số ngày chưa phát sinh công giữ đúng ý nghĩa phát sinh công, không dùng làm ngày nghỉ hoặc suy ra trạng thái nhân sự. Bảng Outsource tìm kiếm và phân trang trên server, luôn áp lại phạm vi Hub và quyền xem hồ sơ; không gộp vào headcount Staff.

Cache nhân sự theo ngày Việt Nam: CacheService chia nhỏ giữ tối đa 21.600 giây; bản nén bền trong tab ẩn `_People Resource Cache` của chính backend giúp không phải đọc lại nguồn khi cache tạm bị xóa sớm. Ba dòng cache Rider/FTE/BPO được ghi đè khi đổi ngày, không tích lũy bản sao theo ngày. Lần truy cập đầu tiên sau 00:00 làm mới module tương ứng; không cần trigger. Nút Làm mới bỏ qua cả hai tầng và đọc lại nguồn ngay. Backend cần quyền ghi để tạo/cập nhật tab cache; nếu ghi lỗi, app vẫn trả dữ liệu thật và hiện cảnh báo cache ngày chưa lưu được. Các tab nguồn không bị sửa.

Local: dùng Python có openpyxl chạy `local/import-people.py "<backend.xlsx>" "<bpo.csv>"`, rồi restart server (tham số BPO tùy chọn). Nguồn được lưu trong `local/people-source.private.json` (ngoài Git/production), không thay dữ liệu D0 của workbook local cũ. Kiểm thử bằng `node local/people-sheets.test.cjs`, `node local/people.test.cjs` và `node local/check.cjs`. Gói `ingestion/rider-repair/` là bản lưu quy trình BigQuery cũ, không còn cần cho các module này và không được export vào dashboard.
