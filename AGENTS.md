# Quy trình phân chia và xử lý issue SINCO

Tài liệu này là hướng dẫn làm việc mặc định cho AI và thành viên dự án SINCO. Mục tiêu là phân tích đúng phạm vi, giao đúng nhóm, mỗi issue có commit độc lập, dễ kiểm thử và dễ revert.

## 1. Mô hình nhóm

Dự án có ba nhóm triển khai chính và một cổng QC độc lập:

| Nhóm | Trách nhiệm chính | Không tự ý thực hiện |
|---|---|---|
| BA | Làm rõ yêu cầu, luồng nghiệp vụ, phạm vi ảnh hưởng và tiêu chí nghiệm thu | Không sửa mã nguồn khi chưa được giao vai trò triển khai |
| Dev Backend | API, database, truy vấn, cấu hình JSON phía server, FastReport và xử lý dữ liệu | Không hardcode cách hiển thị thuộc trách nhiệm Frontend |
| Dev Frontend | Giao diện, hành vi người dùng, component dùng chung, CSS và cách đọc cấu hình động | Không đưa quy tắc nghiệp vụ cố định vào UI nếu có thể khai báo từ server |
| QC | Kiểm thử độc lập sau tích hợp, regression và lưu evidence | Không sửa code trong lúc đang xác nhận kết quả; lỗi phải trả lại nhóm sở hữu |

QC là cổng nghiệm thu, không thay thế ba nhóm triển khai.

## 2. Nguyên tắc bắt buộc

1. Mỗi issue phải được phân tích trước khi sửa.
2. Mỗi issue có một commit độc lập để có thể revert riêng.
3. Không gộp nhiều issue không liên quan vào cùng commit.
4. Không commit file evidence dung lượng lớn, thông tin đăng nhập hoặc dữ liệu test nếu người dùng chưa yêu cầu.
5. Không sửa các thay đổi đang có của người dùng ngoài phạm vi issue.
6. Ưu tiên cấu hình động bằng JSON khi thứ tự cột, nhãn, trạng thái hoặc hành vi có thể khác nhau giữa các màn hình.
7. Chỉ sửa component dùng chung khi yêu cầu thực sự áp dụng chung; phải chạy regression trên các màn hình liên quan.
8. Không tự spawn sub-agent. Chỉ dùng sub-agent khi người dùng yêu cầu phân công song song hoặc giao việc cho nhiều agent.
9. Không báo PASS khi mới kiểm tra code. PASS phải dựa trên build/test hoặc evidence phù hợp.
10. Nếu production build lỗi do hạ tầng ngoài phạm vi, phải ghi rõ nguyên nhân và chạy phương án kiểm chứng thay thế hợp lệ.
11. Không hardcode tên field/key nghiệp vụ trong core dynamic để suy luận kiểu dữ liệu hoặc hành vi. Core chỉ được dựa vào metadata rõ ràng như `type`, `sqlType`, `dataType`, `valueType` hoặc cấu hình JSON. Nếu thiếu metadata, phải bổ sung metadata ở JSON/model thay vì đoán theo tên key.
12. Khi normalize payload trước khi lưu, không được tự đổi field thiếu metadata thành chuỗi rỗng theo kiểu blanket. Hành vi nền cũ là chuỗi rỗng thành `null`, còn số/ngày/object giữ nguyên trừ khi metadata chỉ định cách xử lý khác.
13. Trước khi sửa stored procedure, phải lấy definition mới nhất từ database đang chạy, so sánh với script trong repo, rồi sửa dựa trên bản DB hiện tại. Sau khi deploy DB phải cập nhật script trong repo và commit riêng.

## 3. Quy trình xử lý một issue

### Bước 1: BA phân tích

BA phải trả lời được:

- Người dùng thao tác ở màn hình nào?
- Hiện trạng và kết quả mong muốn là gì?
- Yêu cầu áp dụng riêng một màn hình hay dùng chung toàn hệ thống?
- Dữ liệu/API/database có thay đổi không?
- Có ảnh hưởng báo cáo, export, phân quyền hoặc trạng thái chứng từ không?
- Điều kiện nào được xem là PASS?
- Có rủi ro làm thay đổi dữ liệu thật không?

Kết quả BA tối thiểu:

```text
Issue: #<số>
Hiện trạng: ...
Mong muốn: ...
Phạm vi: riêng/chung
Nhóm chính: BA/Backend/Frontend
Nhóm phối hợp: ...
Acceptance criteria:
- ...
- ...
Regression cần kiểm tra:
- ...
```

### Bước 2: Chọn nhóm sở hữu

| Loại thay đổi | Nhóm chính | Nhóm phối hợp |
|---|---|---|
| CSS, kích thước nút, focus/blur, giữ dòng đang chọn | Frontend | BA, QC |
| Thứ tự/nhãn cột khai báo trong JSON server | Backend | BA, Frontend, QC |
| Component Frontend đọc và render JSON | Frontend | Backend |
| API, stored procedure, validation dữ liệu | Backend | BA, QC |
| FastReport `.frx`, export PDF/Word/Excel | Backend | BA, QC |
| Yêu cầu chưa rõ hoặc có nhiều cách hiểu | BA | Backend, Frontend |
| Regression và evidence | QC | Nhóm sở hữu issue |

Nếu issue chạm cả Backend và Frontend, phải xác định ranh giới rõ ràng trước khi sửa. Không để hai nhóm cùng hardcode một quy tắc.

### Bước 3: Lập kế hoạch thay đổi

Kế hoạch phải nêu:

- File hoặc module dự kiến ảnh hưởng.
- Có thay đổi API/schema hay không.
- Test đơn vị, build hoặc Playwright cần chạy.
- Cách bảo vệ dữ liệu test.
- Tên commit dự kiến.

### Bước 4: Triển khai

- Đọc trạng thái Git trước khi sửa.
- Giữ nguyên thay đổi không liên quan của người dùng.
- Sửa nhỏ nhất có thể nhưng đủ giải quyết nguyên nhân gốc.
- Không copy logic cho nhiều màn hình nếu có thể đưa vào component chung hoặc JSON.
- Không dùng thao tác phá hủy dữ liệu nếu chưa được cho phép.

### Bước 5: Tự kiểm tra của Dev

Dev phải kiểm tra tối thiểu:

- `git diff --check` không có lỗi whitespace.
- Build phù hợp với phạm vi thay đổi.
- Luồng chính hoạt động trên localhost.
- Không phát sinh thay đổi file ngoài phạm vi.
- Nếu sửa dùng chung, kiểm tra ít nhất một màn hình đại diện và các regression quan trọng.

### Bước 6: QC nghiệm thu

QC kiểm tra theo acceptance criteria của BA, không chỉ kiểm tra theo cách Dev đã cài đặt.

Ưu tiên Playwright cho các issue giao diện:

- Tự đăng nhập và chọn đơn vị.
- Chụp ảnh trước/sau.
- Lưu trace và video khi cần.
- Bắt response hoặc file download cho export.
- Không bấm Lưu nếu có thể kiểm tra bằng dữ liệu chưa lưu.
- Nếu bắt buộc thay đổi dữ liệu, phải dùng dữ liệu test và ghi rõ dữ liệu đã tạo/sửa/xóa.

Evidence khuyến nghị:

```text
QC-Evidence/<ngày>-<môi trường>/
├── QC-REPORT.md
├── index.html
├── qc-results.json
├── <issue>-before.png
├── <issue>-after.png
├── trace.zip
└── video/
```

Thông tin đăng nhập phải truyền qua biến môi trường, không ghi trực tiếp vào source hoặc Git:

```text
SINCO_QC_URL
SINCO_QC_USER
SINCO_QC_PASSWORD
SINCO_QC_UNIT
```

### Bước 7: Commit riêng

Chỉ stage file thuộc issue đang xử lý:

```bash
git add -- <file-1> <file-2>
git commit -m "fix(#<issue>): <mô tả ngắn>"
```

Quy ước commit:

- `fix(#51): reduce detail row checkbox size`
- `feat(#53): support bulk deletion of detail rows`
- `fix(#60): align contract export fields`
- `fix(#90): restore active row after closing detail form`

Không dùng `git add .` khi workspace có thay đổi hoặc evidence không liên quan.

## 4. Definition of Done

Một issue chỉ hoàn tất khi đáp ứng tất cả điều kiện phù hợp:

- BA đã chốt hiện trạng, mong muốn và acceptance criteria.
- Nhóm sở hữu đã sửa đúng phạm vi.
- Build/test phù hợp đã chạy.
- QC đã PASS hoặc ghi rõ phần chưa thể kiểm tra.
- Evidence đủ để người khác xem lại kết quả.
- Không làm thay đổi dữ liệu ngoài dự kiến.
- Commit riêng đã được tạo.
- Có thể revert commit mà không làm mất sửa chữa của issue khác.

## 5. Mẫu bảng phân công

| Issue | BA | Backend | Frontend | QC | Commit | Trạng thái |
|---|---|---|---|---|---|---|
| #xx | Phân tích và AC | API/JSON/report nếu có | UI/component nếu có | Test và evidence | `<hash>` | Todo/Doing/Pass/Fail |

Ý nghĩa trạng thái:

- `Todo`: chưa bắt đầu.
- `Doing`: đang phân tích hoặc triển khai.
- `Ready for QC`: Dev đã tự kiểm tra xong.
- `Pass`: QC đạt đầy đủ acceptance criteria.
- `Fail`: QC có evidence lỗi và trả lại nhóm sở hữu.
- `Blocked`: thiếu thông tin, môi trường hoặc quyền cần thiết.

## 6. Ví dụ phân chia từ các issue đã xử lý

| Issue | Nhóm chính | Lý do | QC chính |
|---|---|---|---|
| #48 | Frontend | Hành vi focus/blur của input số dùng chung | Focus `0` thành rỗng, blur khôi phục `0`, số khác không đổi |
| #51 | Frontend | Kích thước checkbox chọn dòng trong detail | Đo DOM `14×14px` và chụp giao diện |
| #53 | Frontend | Chọn nhiều dòng và xóa trong detail chưa lưu | Số dòng, trạng thái chọn và tổng tiền sau xóa |
| #60 | Backend | Canh lề trong FastReport hợp đồng | Xuất đủ mẫu, xác nhận PDF hợp lệ và xem preview |
| #90 | Frontend | Lưu/khôi phục dòng đang thao tác trên grid | Xem/Sửa → đóng → đúng dòng được highlight |
| #91 | Backend | Thứ tự cột được khai báo động trong JSON | Kiểm tra nhiều danh sách; Trạng thái ngay sau Số tiền |

Với #91, Frontend chỉ cần render đúng thứ tự JSON. Không hardcode thứ tự riêng cho từng màn hình trong component.

## 7. Mẫu báo cáo cuối cho người dùng

```text
Đã xử lý #<issue>:

- Thay đổi: ...
- Phạm vi: ...
- Test: ...
- Evidence: ...
- Commit: <hash> <message>
- Lưu ý/rủi ro còn lại: ...
```

Luôn dẫn link đến file evidence hoặc file mã nguồn khi có ích. Không yêu cầu người dùng đọc lại log công cụ để biết kết quả.

## 8. Quy tắc môi trường QC

- `localhost` chỉ truy cập được trên chính máy đang chạy ứng dụng.
- QC từ máy khác phải dùng IP/LAN, staging URL hoặc tunnel được phê duyệt.
- Frontend và Backend phải cùng trỏ về môi trường dữ liệu test.
- Tài khoản QC nên có quyền phù hợp với phạm vi kiểm thử; không dùng dữ liệu production cho thao tác phá hủy.
- Trước khi test phải ghi nhận URL, thời gian, nhánh và commit.
- Sau khi test phải đóng browser/process do automation tạo và kiểm tra lại trạng thái Git.
