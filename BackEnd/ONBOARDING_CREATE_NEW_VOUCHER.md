# Cầm Tay Chỉ Việc: Tạo Chứng Từ Mới Hoàn Toàn

Tài liệu này dành cho người mới, hướng dẫn tạo 1 chứng từ mới từ số 0 theo chuẩn dự án.

Ví dụ tên chứng từ:
- Master: `abcVoucher`
- Detail: `abcVoucherDetail`

---

## 1) Chuẩn bị tên và quy ước

Trước khi code, chốt 5 thứ:
1. `controller` JSON: `abcVoucher`
2. `formId` master: `abcVoucher`
3. `formId` detail: `abcVoucherDetail`
4. Route FE: `abcVoucher` và `abcVoucher/popup`
5. Mã chứng từ `idVC` (vd: `Z99`)

Quy ước quan trọng:
- Khóa master: `idGui`
- Khóa detail nên dùng `line_nbr`
- Detail `foreignKey`: `idGui, line_nbr`

---

## 2) Tạo bảng DB

Tạo script trong:
- `Server/SqlScripts/createAbcVoucher.sql`

Nội dung tối thiểu:
1. `CREATE TABLE abcVoucher$000000`
2. `CREATE TABLE abcVoucherDetail$000000`
3. Tạo bảng phân kỳ bằng:
```sql
exec sp_create_periods_range_nofk 'abcVoucher$000000','abcVoucher', 'idGui', 'voucherDate', 1, '202501','202612'
exec sp_create_periods_range_nofk 'abcVoucherDetail$000000','abcVoucherDetail', 'idGui,line_nbr', 'voucherDate', 1, '202501','202612'
```

Checklist DB:
- Master có `voucherDate`, `voucherNumber`, `status`, `unitCode`
- Detail có `idGui`, `line_nbr`, các cột nghiệp vụ

---

## 3) Tạo Json Model (backend schema)

Tạo file:
- `Server/SqlJsonDefinations/JsonModels/abcVoucherModel.json`

Cấu trúc cần có:
1. `model = abcVoucher`
2. `foriegn = [abcVoucherDetail]`
3. `foriegnModel[0].model = abcVoucherDetail`
4. Khai báo đủ kiểu dữ liệu SQL tương ứng

Lưu ý:
- Tên cột trong model phải khớp tuyệt đối cột DB.

---

## 4) Tạo Form JSON

Tạo file:
- `Server/Controllers/Form/abcVoucher.page.json`

Bắt buộc có:
1. `controller: "abcVoucher"`
2. `formId: "abcVoucher"`
3. `type: "voucher"`
4. `tabs[0].form.formId = "abcVoucher"`
5. `tabs[0].detail[0].formId = "abcVoucherDetail"`
6. `tabs[0].detail[0].foreignKey = "idGui, line_nbr"`

Nên có:
- `dataProcessing.actions.post`:
  - `beforeUpdateAbcVoucher`
  - `afterUpdateAbcVoucher`

---

## 5) Tạo hook store trước/sau lưu

Tạo 2 file:
- `Server/SqlScripts/beforeUpdateAbcVoucher.sql`
- `Server/SqlScripts/afterUpdateAbcVoucher.sql`

Mẫu tối thiểu:
```sql
CREATE OR ALTER PROCEDURE [dbo].[beforeUpdateAbcVoucher]
    @idGui NVARCHAR(50),
    @voucherNumber NVARCHAR(50),
    @voucherDate NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
END
GO
```

Làm tương tự cho `afterUpdate...`.

---

## 6) Tạo FE module list/popup

Tạo thư mục:
- `FrontEnd/src/app/abcVoucher/`

Tạo 2 file:
1. `abcVoucher-list.component.ts`
2. `abcVoucher-popup.component.ts`

Trong list component:
- `query.formId.controller = "abcVoucher.page.json"`
- `query.formId.formId = "abcVoucher"`
- `query.formId.listTable = ["abcVoucher", "abcVoucherDetail"]`

Trong popup component:
- `id = "AbcVoucher"`
- `name = "abcVoucher.page.json"`

---

## 7) Đăng ký route

Sửa:
- `FrontEnd/src/app/app.routes.ts`

Thêm import + route:
1. `path: 'abcVoucher'`
2. `path: 'abcVoucher/popup'`

---

## 8) (Tuỳ chọn) Thêm nút tạo chứng từ liên quan

Nếu cần tạo từ chứng từ khác:
- Thêm `actions` trong list nguồn:
  - `id: "abcVoucher.page.json"`
  - `target: "abcVoucher/popup"`

Và viết store:
- `SyncFrom<SourceForm>`
- nhánh `IF @FormConfig = 'abcVoucher.page.json' ...`

---

## 9) Test end-to-end

Test tối thiểu:
1. Mở list `abcVoucher` được.
2. Mở popup insert được.
3. Lưu được master + detail.
4. Đọc lại chứng từ ra đúng dữ liệu.
5. Không lỗi hook `before/after`.

Test thêm:
1. Sửa chứng từ.
2. Xóa chứng từ.
3. Kiểm tra partition theo `voucherDate`.

---

## 10) Lỗi thường gặp

1. Sai tên cột `line_nbr`/`lineNbr` giữa DB và JSON.
2. Quên tạo file `xxxModel.json` đúng tên form.
3. Route FE khai báo thiếu import component.
4. `dataProcessing` gọi proc chưa tồn tại.
5. `listTable` sai tên -> save/load detail lỗi.

---

## 11) Checklist bàn giao

1. Có script tạo bảng + phân kỳ.
2. Có model JSON.
3. Có form JSON.
4. Có before/after proc.
5. Có FE list/popup + route.
6. Có ảnh/chụp test hoặc log test save/load.

