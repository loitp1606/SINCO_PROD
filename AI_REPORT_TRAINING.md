# SINCO AI Training - Report Module

Tài liệu này dùng để huấn luyện/định hướng AI khi làm việc với **phần báo cáo** trong dự án SINCO.

## 1. Mục tiêu khi AI xử lý báo cáo

- Xác định đúng luồng `Frontend -> API -> Report JSON -> SQL/SP`.
- Không đoán nghiệp vụ theo cảm tính, luôn bám metadata report.
- Khi sửa report phải giữ tính nhất quán giữa:
  - route frontend
  - component report
  - file JSON trong `BackEnd/Server/Controllers/Form/Report`
  - stored procedure tương ứng trong DB

## 2. Luồng chuẩn của màn hình báo cáo

Ví dụ: `http://localhost:4200/bcdtln`

1. Route frontend:
   - `bcdtln` -> `ReportBcdtlnComponent`
   - File: `FrontEnd/src/app/app.routes.ts`
2. Wrapper component:
   - set `controller = "bcdtln.json"`
   - File: `FrontEnd/src/app/bcdtln/bcdtln.component.ts`
3. Shared report UI:
   - `DynamicReportComponent` nhận `controller`
   - gọi `POST /api/DynamicReport/processReport` với `action = "loading"` để lấy cấu trúc
   - gọi lại với `action = "finding"` để lấy dữ liệu
   - File: `FrontEnd/src/app/dynamic-report/dynamic-report.component.ts`
4. Backend API:
   - `DynamicReportController.ProcessReport`
   - File: `BackEnd/Server/Controllers/DynamicReportController.cs`
5. Backend service:
   - đọc JSON report tại `Controllers/Form/Report/<controller>`
   - nếu `loading`: trả về header/filter
   - nếu `finding`: lấy query trong `dataProcessing.report`, replace param, execute SQL
   - File: `BackEnd/Server/Repositories/Report/DynamicReportService.cs`
6. Report metadata:
   - Ví dụ `BackEnd/Server/Controllers/Form/Report/bcdtln.json`
   - chứa `title`, `header`, `filters`, `dataProcessing.report[].query`

## 3. Contract API bắt buộc

Endpoint:

- `POST /api/DynamicReport/processReport`

Request mẫu:

```json
{
  "controller": "bcdtln.json",
  "type": "report",
  "action": "finding",
  "param": {
    "dateFrom": "2026-01-01",
    "dateTo": "2026-01-31",
    "item_group": "",
    "customer": "",
    "Employee": "",
    "item_id": "",
    "userId": "admin"
  }
}
```

## 4. Quy tắc khi AI sửa report

1. Sửa cột hiển thị:
   - chỉnh trong `header` của file JSON report.
2. Sửa filter:
   - chỉnh trong `filters` của file JSON report.
   - nếu là lookup thì kiểm tra `default.controller`.
3. Sửa dữ liệu report:
   - chỉnh query/SP trong `dataProcessing.report`.
   - nếu đổi param phải đổi đồng bộ filter và SP.
4. Không tự ý đổi endpoint/report flow nếu chưa có yêu cầu kiến trúc.
5. Nếu có export Excel: đảm bảo key header map đúng dữ liệu trả về.

## 5. Checklist debug nhanh cho AI

1. Route đúng chưa (`app.routes.ts`)?
2. `controller` truyền đúng file `.json` chưa?
3. Gọi API `loading` có trả về filter/header không?
4. Gọi API `finding` có payload param đúng không?
5. Query trong JSON có khớp tên param gửi lên không?
6. SP chạy trực tiếp ở DB có ra dữ liệu không?
7. Key trong `header[].key` có tồn tại trong result dataset không?

## 6. Các lỗi thường gặp

- Sai tên `controller` (`bcdtln` vs `bcdtln.json`) -> load cấu hình thất bại.
- Thiếu param trong `finding` -> query/SP trả sai hoặc rỗng.
- Đổi key cột trong SQL nhưng không đổi `header.key` -> UI trắng cột.
- Lookup filter sai `controller` -> dropdown không có dữ liệu.

## 7. Prompt template cho AI (dùng nội bộ)

```text
Bạn đang sửa module báo cáo SINCO.
Hãy bám đúng quy trình:
1) kiểm tra route frontend,
2) kiểm tra controller report .json,
3) kiểm tra request loading/finding tới /api/DynamicReport/processReport,
4) kiểm tra file BackEnd/Server/Controllers/Form/Report/<name>.json,
5) kiểm tra query/SP và mapping header/filter.
Không suy đoán ngoài luồng metadata report.
Khi trả lời, liệt kê rõ file đã sửa + lý do sửa + ảnh hưởng.
```

## 8. Phạm vi tài liệu

Tài liệu này chỉ dành cho **module báo cáo động** (`DynamicReport`), không bao gồm:

- Dynamic grid CRUD (`/api/data/*`)
- Form popup nghiệp vụ nhập liệu
- Quy trình posting chứng từ

## 9. SQL mẫu thêm menu báo cáo mới

Ví dụ thêm menu cho report `bcdchdpn` (Báo cáo đối chiếu hóa đơn và phiếu nhập):

```sql
IF NOT EXISTS (SELECT 1 FROM Menus WHERE MenuId = '90018')
BEGIN
    INSERT INTO Menus
    (
        MenuId, MenuName, sysID, ParentMenuId, IsActive,
        CreatedAt, UpdatedAt, TypeMenu, icon, MenuName2,
        VoucherCode, isExpanded, status, user_id0, user_id2, datetime0, datetime2
    )
    SELECT
        '90018',
        N'Báo cáo đối chiếu hóa đơn và phiếu nhập',
        '/bcdchdpn',
        '90000',
        1,
        GETDATE(),
        GETDATE(),
        'Report',
        icon,
        'Invoice and receipt reconciliation report',
        NULL,
        0,
        1,
        1,
        1,
        GETDATE(),
        GETDATE()
    FROM Menus
    WHERE MenuId = '90017';
END
```
