# Cầm Tay Chỉ Việc: Tạo Tự Động Phiếu Từ 1 Phiếu Khác

Tài liệu này hướng dẫn đầy đủ luồng:
1. Khai báo nút trên FE.
2. Gọi API SyncData.
3. Viết store `SyncFrom<SourceForm>` trả dữ liệu cho phiếu đích.
4. Mở popup phiếu đích với dữ liệu kế thừa.

Ví dụ thực tế:
- Nguồn: `goodsReceipt`
- Đích: `paymentSlip` hoặc `orderReturn`

---

## 1) Luồng tổng quan

1. User đứng ở grid phiếu nguồn (vd: `goodsReceipt`) và bấm nút “Tạo phiếu ...”.
2. FE gọi `POST /api/FormConfig/SyncData` với:
   - `FormId = form nguồn`
   - `Ids = danh sách idGui đang chọn`
   - `IdSync = file form đích` (vd `orderReturn.page.json`)
3. Backend gọi store tên cố định:
   - `SyncFrom<FormIdNguon>`
   - Ví dụ: `FormId = goodsReceipt` -> store `SyncFromgoodsReceipt`
4. Store rẽ nhánh theo `@FormConfig` để build dữ liệu đúng form đích.
5. Store trả 3 result sets:
   - set 1: `type, message`
   - set 2: master data
   - set 3: detail data
6. Backend merge dữ liệu vào JSON form đích (`initialData`) rồi trả về FE.
7. FE mở popup form đích với dữ liệu kế thừa sẵn.

---

## 2) Khai báo FE: Nút “Tạo phiếu ...” ở grid nguồn

Ví dụ file:
- `FrontEnd/src/app/goodsReceipt/goodsReceipt-list.component.ts`

Thêm vào `actions`:

```ts
{
  controller: 'OrderReturn',
  id: 'orderReturn.page.json',
  label: 'Tạo phiếu xuất trả hàng',
  target: 'orderReturn/popup',
  color: 'orange',
}
```

Ý nghĩa:
- `id`: chính là `@FormConfig` truyền xuống store.
- `target`: route popup đích.
- `controller`: key localStorage để FE lưu metadata trả về.

---

## 3) FE gọi backend SyncData như thế nào

FE dùng `onGridButtonClick(...)` trong `dynamic-grid.component.ts`:
- Lấy danh sách `idGui` đang chọn từ selection.
- Tạo payload:

```json
{
  "FormId": "<form nguồn>",
  "Ids": ["id1","id2"],
  "IdSync": "orderReturn.page.json",
  "Unit": "...",
  "UserId": "...",
  "Language": "..."
}
```

- Gọi: `POST /api/FormConfig/SyncData`
- Nếu success:
  - lưu metadata vào localStorage
  - mở `target` popup

---

## 4) Backend controller SyncData

File:
- `Server/Controllers/FormConfigController.cs`

Luồng chính:
1. Đọc file form đích bằng `request.IdSync`.
2. Gọi repository `SyncDataFromFormAdvancedAsync(request, formConfig)`.
3. Repository gọi store:
   - tên store = `SyncFrom{request.FormId}`
4. Đọc multiple result sets và merge vào form config.

---

## 5) Quy ước store SyncFrom

Tên store bắt buộc:
- `SyncFrom<sourceFormId>`
- Ví dụ source `goodsReceipt` -> `SyncFromgoodsReceipt`

Signature chuẩn:

```sql
CREATE OR ALTER PROCEDURE [dbo].[SyncFromgoodsReceipt]
    @Ids NVARCHAR(MAX),
    @Unit NVARCHAR(50),
    @UserId NVARCHAR(50),
    @Language NVARCHAR(10),
    @FormConfig NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    ...
END
```

---

## 6) Khung store chuẩn (nên copy)

```sql
-- 1) Parse danh sách Ids -> #ds
-- 2) Nạp master/detail nguồn vào #master/#detail (theo partition yyyyMM)
-- 3) Validate nghiệp vụ nguồn (vd: cùng supplierCode)
-- 4) sp_UpdateNullsToDefault #master/#detail
-- 5) IF @FormConfig = 'xxx.page.json' THEN
--      - tạo #destMaster theo bảng đích$000000
--      - tạo #destDetail theo bảng detail đích$000000
--      - insert master
--      - insert detail
--      - update tổng master theo detail
--      - sp_UpdateNullsToDefault temp đích
--      - SELECT 1 type + 2 bảng data
--      - RETURN
-- 6) Nếu không match nhánh -> SELECT 0 + message chưa hỗ trợ
```

---

## 7) Mẫu nhánh `@FormConfig` (điền theo form đích)

```sql
IF @FormConfig = 'orderReturn.page.json'
BEGIN
    -- 1) check bảng đích
    -- 2) tạo #orderReturnMt, #orderReturnDt theo bảng 000000
    -- 3) insert master
    -- 4) insert detail
    -- 5) update tổng
    -- 6) sp_UpdateNullsToDefault
    -- 7) SELECT 1 + trả 2 result sets
    RETURN;
END;
```

---

## 8) Cực kỳ quan trọng: map cột phải khớp form JSON đích

Ví dụ form đích `orderReturn.page.json`:
- master `formId = orderReturn`
- detail `formId = orderReturnDetail`
- `foreignKey = idGui, line_nbr`
- detail key phải đúng: `line_nbr`

Nếu store trả `lineNbr` mà form dùng `line_nbr` thì popup hiển thị sai/không bind đúng.

---

## 9) Kết cấu result sets bắt buộc

Store SyncFrom phải trả theo thứ tự:

1. Result set #1:

```sql
SELECT 1 AS type, '' AS message;
```

hoặc

```sql
SELECT 0 AS type, N'lý do lỗi' AS message;
```

2. Result set #2:
- Dữ liệu master

3. Result set #3:
- Dữ liệu detail

`FormConfigHelper.UpdateInitialDataInFormConfig()` đang map theo thứ tự này.

---

## 10) Checklist test sau khi làm

1. Chọn 1 phiếu nguồn, bấm nút tạo -> popup đích mở đúng.
2. Master đích đã có dữ liệu kế thừa.
3. Detail đích có dữ liệu, line đúng chuẩn (`line_nbr`).
4. Tổng tiền master khớp tổng detail.
5. Chọn nhiều phiếu trái rule (vd khác NCC) -> báo lỗi đúng.
6. Trường hợp không có detail -> báo lỗi rõ.

---

## 11) Lỗi thường gặp

1. Sai `id` action:
- FE gửi nhầm `IdSync` -> store không vào đúng nhánh.

2. Sai tên store:
- `FormId` nguồn là `goodsReceipt` nhưng DB không có `SyncFromgoodsReceipt`.

3. Sai schema temp đích:
- `SELECT TOP 0 ... INTO` thiếu cột -> insert lỗi.

4. Sai tên cột detail:
- `line_nbr` vs `lineNbr` không đồng nhất.

5. Không `RETURN` sau nhánh:
- rơi xuống nhánh “chưa hỗ trợ” dù đã xử lý xong.

---

## 12) Best practices

1. Luôn `SELECT TOP 0 ... INTO` từ bảng `$000000` để tự bám schema thật.
2. Dùng `ISNULL/TRY_CONVERT` khi map số để tránh fail dữ liệu bẩn.
3. Có validate nghiệp vụ trước khi insert đích.
4. Có message lỗi rõ ràng cho user nghiệp vụ.
5. Tách rõ từng nhánh theo `@FormConfig` để dễ maintain.

