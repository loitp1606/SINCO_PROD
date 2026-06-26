# SINCO AI Training - Print / Export Flow

Tai lieu nay dung de AI doc nhanh luong **in phieu / xuat file** trong du an SINCO.

Pham vi chinh:

- API: `POST /api/AttachedFile/export`
- Backend controller: `BackEnd/Server/Controllers/FilesController.cs`
- Backend service: `BackEnd/Server/Repositories/FileService.cs`
- Cau hinh schema: `BackEnd/Server/SqlJsonDefinations/JsonModels`
- Mau in FastReport: `BackEnd/Server/Controllers/FastReport`

## 1. Ket Luan Nhanh

Co 2 luong export khac nhau:

1. In chung tu/phieu nghiep vu:
   - `isReport = false` hoac khong truyen.
   - Dung file mau `.frx` trong `BackEnd/Server/Controllers/FastReport`.
   - Dung `JsonModels/*Model.json` de query du lieu tu database.

2. In bao cao dong:
   - `isReport = true`.
   - Dung file mau `.frx` trong `BackEnd/Server/Controllers/FastReport/Reports`.
   - Dung JSON report trong `BackEnd/Server/Controllers/Form/Report`.
   - Khong di theo `JsonModels` nhu chung tu.

Khi user noi "in phieu", "xuat phieu", "mau in", thuong la luong 1.
Khi user noi "bao cao", "report", "bcdtln", "bcthekho", thuong la luong 2.

## 2. Frontend Goi API

File build payload:

- `FrontEnd/src/app/file-handle/file-handle.component.ts`

Method chinh:

```ts
exportToReport(controll, type)
```

Payload mau:

```json
{
  "controll": "order",
  "tables": {
    "order$202506$0": "GUID_OR_PRIMARY_KEY"
  },
  "isPdfOrExcel": "pdf",
  "userID": "1",
  "unit": "SINCO",
  "language": "vi",
  "isReport": false,
  "noteEdited": "",
  "isEdit": false
}
```

Field quan trong:

- `controll`: ten file mau `.frx`, khong co duoi `.frx`.
- `tables`: danh sach chung tu can in.
- `isPdfOrExcel`: `pdf`, `excel`, hoac `word`.
- `isReport`: quyet dinh di theo luong chung tu hay bao cao.

Service goi API:

- `FrontEnd/src/app/services/file.service.ts`

```ts
POST /api/AttachedFile/export
```

## 3. Backend Endpoint

File:

- `BackEnd/Server/Controllers/FilesController.cs`

Endpoint:

```csharp
[HttpPost("export")]
public async Task<IActionResult> ExportPdf([FromBody] ReportRequest request)
```

Luu y:

- Route cua controller la `api/AttachedFile`.
- Ten class la `FilesController`, nhung URL van la `/api/AttachedFile/export`.
- Controller chi validate co `request.Controll`, sau do goi `FileService.ExportPdfAsync(request)`.

## 4. ReportRequest

File:

- `BackEnd/Server/Repositories/FileService.cs`

Model:

```csharp
public class ReportRequest
{
    public string? Controll { get; set; }
    public Dictionary<string, object> Tables { get; set; } = new();
    public string IsPdfOrExcel { get; set; } = string.Empty;
    public string? UserID { get; set; }
    public string? Unit { get; set; }
    public string? Language { get; set; }
    public string? PkValue { get; set; }
    public string? NoteEdited { get; set; }
    public bool? IsEdit { get; set; }
    public bool? IsReport { get; set; }
}
```

## 5. Luong In Chung Tu

Dieu kien:

```csharp
request.IsReport != true
```

Vi du:

- `/order` -> `controll = "Order"` -> load `order.frx`
- `/quotationPaper` -> `controll = "QuotationPaper"` -> load `quotationpaper.frx`
- `/deliveryNote` -> `controll = "deliveryNote"` -> load `deliverynote.frx`

### Buoc 1: Load Mau FRX

File:

- `BackEnd/Server/Repositories/FileService.cs`

Duong dan:

```csharp
Controllers\FastReport\{request.Controll.ToLower()}.frx
```

Neu khong thay file, API tra loi:

```text
Khong tim thay file bao cao: <controll>.frx
```

### Buoc 2: Doc DataSource Trong FRX

Method:

```csharp
ExtractTableNameFromFrx(filePath)
```

No doc cac node:

```xml
<TableDataSource Name="order">
  <Column Name="idGui" />
  <Column Name="voucherNumber" />
</TableDataSource>
```

Ket qua la danh sach table va column ma mau in dang can.

Vi du `order.frx` co:

- `order`
- `orderDetail`

### Buoc 3: Lay Schema Tu JsonModels

Method:

```csharp
GetTemplateByTableNameAsync(expectedCols.FirstOrDefault().Key)
```

Neu FRX co table `order`, backend tim file:

```text
BackEnd/Server/SqlJsonDefinations/JsonModels/OrderModel.json
```

Quy tac ten file:

```text
{tableName}Model.json
```

Khong phan biet hoa thuong.

### Buoc 4: Query Du Lieu

Method:

```csharp
GetTablesAsync(suffix, idValue, expectedSources)
```

`tables` tu frontend thuong co key dang:

```text
order$202506$0
```

Backend tach:

- base table: `order`
- suffix partition: `$202506`
- id can lay: value trong `tables`

Neu model co:

```json
"partition": true
```

thi query table:

```text
order$202506
orderDetail$202506
```

Neu khong partition thi query table goc.

### Buoc 5: Xu Ly Lookup / SqlExpression

Trong `JsonModels`, field co the co:

```json
"sqlExpression": "dbo.fn_NumberToWordsVN(ISNULL({m}.total_payment,0))"
```

hoac:

```json
"foreign": {
  "table": "uom",
  "key": "uomCode",
  "lookup": "uomName"
}
```

Khi FRX yeu cau field do:

- `sqlExpression`: select theo expression.
- `foreign.lookup`: join bang lookup de lay ten hien thi.
- field thuong: select truc tiep tu bang chinh/detail.

### Buoc 6: Bind Data Vao FastReport

Data duoc convert thanh `DataTable`, ten bang duoc lowercase:

```csharp
dataTable.TableName = kv.Key.ToLower();
```

Sau do register:

```csharp
currentReport.RegisterData(dataSetForCurrentReport, "ReportData", true);
```

Vi vay trong FRX, `ReferenceName` thuong co dang:

```xml
ReferenceName="ReportData.order"
ReferenceName="ReportData.orderdetail"
```

### Buoc 7: Export File

Theo `isPdfOrExcel`:

- `pdf`: export PDF, neu nhieu phieu thi merge thanh 1 PDF.
- `excel`: export Excel, neu nhieu phieu thi merge sheet.
- `word`: export DOCX, neu nhieu phieu thi merge document.

File tra ve co content-type theo duoi file:

- `.pdf` -> `application/pdf`
- `.xlsx` -> Excel
- `.docx` -> Word

## 6. Luong In Bao Cao

Dieu kien:

```csharp
request.IsReport == true
```

Mau FRX lay tu:

```text
BackEnd/Server/Controllers/FastReport/Reports/{controll}.frx
```

Config report lay tu:

```text
BackEnd/Server/Controllers/Form/Report/{tableName}.json
```

Backend doc:

```json
dataProcessing.report[0].query
```

Sau do replace param tu `request.Tables`, execute query, va bind vao FastReport.

Luồng này dùng cho các màn hình như:

- `bcdtln`
- `bcthekho94`
- `bcthnxt95`
- cac bao cao trong `Controllers/Form/Report`

## 7. Vai Tro Cua JsonModels

Folder:

```text
BackEnd/Server/SqlJsonDefinations/JsonModels
```

Dung chinh cho:

- Import Excel.
- Export template Excel.
- In chung tu theo `.frx`.
- Mo ta schema database cho master/detail.

Cac phan quan trong trong model:

```json
{
  "model": "order",
  "schema": {
    "partition": true,
    "fields": []
  },
  "foriegnModel": []
}
```

Y nghia:

- `model`: ten table/data source master.
- `schema.partition`: co dung table theo thang hay khong.
- `schema.fields`: danh sach field that trong DB hoac field tinh bang `sqlExpression`.
- `foriegnModel`: danh sach detail table.

Luu y ten property dang viet sai chinh ta la `foriegnModel`, khong tu sua thanh `foreignModel` neu khong sua ca code.

## 8. Vai Tro Cua FRX

Folder:

```text
BackEnd/Server/Controllers/FastReport
```

FRX quyet dinh:

- Mau in nhin nhu the nao.
- DataSource nao can dung.
- Column nao can lay tu DB.
- Format hien thi so/ngay/text.

Neu them field vao mau in:

1. Them column vao `.frx`.
2. Dam bao field co trong `JsonModels`.
3. Neu field la lookup, khai bao `foreign.lookup`.
4. Neu field la field tinh, khai bao `sqlExpression`.

## 9. Checklist Them/Sua Mau In Chung Tu

1. Xac dinh route/list dang goi `controll` nao.
2. Mo file:

```text
BackEnd/Server/Controllers/FastReport/{controll}.frx
```

3. Kiem tra `TableDataSource Name`.
4. Mo model tuong ung:

```text
BackEnd/Server/SqlJsonDefinations/JsonModels/{TableName}Model.json
```

5. Dam bao moi column trong FRX co field trong model.
6. Neu chung tu co partition, payload `tables` phai co suffix thang, vi du:

```text
order$202506$0
```

7. Neu loi mat du lieu lookup, kiem tra `foreign.lookup`.
8. Neu loi khong co cot, kiem tra ten cot trong FRX va `schema.fields[].name`.
9. Neu loi khong load file, kiem tra ten `controll` va ten file `.frx` lower-case.

## 10. Checklist Debug Loi Thuong Gap

Loi: `Khong tim thay file bao cao`

- Kiem tra `controll` frontend gui len.
- Kiem tra file `.frx` co ton tai khong.
- Neu `isReport = true`, file phai nam trong `FastReport/Reports`.
- Neu `isReport = false`, file phai nam truc tiep trong `FastReport`.

Loi: in ra file trang hoac thieu du lieu

- Kiem tra `tables` payload co key va id dung khong.
- Kiem tra suffix partition dung theo `voucherDate` khong.
- Kiem tra `TableDataSource Name` trong FRX co khop model khong.
- Kiem tra `ReferenceName="ReportData.<tablename lowercase>"`.

Loi: cot lookup in ra ma thay vi ten

- Kiem tra field trong `JsonModels` co:

```json
"foreign": {
  "table": "...",
  "key": "...",
  "lookup": "..."
}
```

Loi: them cot vao FRX nhung API fail

- Kiem tra cot do co trong `schema.fields`.
- Neu cot la alias tinh toan, them `sqlExpression`.
- Neu cot nam o detail, them vao dung `foriegnModel`.

Loi: sai so le khi in

- Kiem tra format trong `.frx` truoc.
- Kiem tra kieu cot trong `JsonModels` la `DECIMAL(...)`.
- Kiem tra form JSON frontend neu gia tri duoc tinh truoc khi save.
- Luu y export/in lay du lieu tu DB, khong lay truc tiep tu UI hien tai.

## 11. Request Mau

In 1 don hang PDF:

```json
{
  "controll": "Order",
  "tables": {
    "order$202506$0": "ID_GUI_CAN_IN"
  },
  "isPdfOrExcel": "pdf",
  "userID": "1",
  "unit": "SINCO",
  "language": "vi",
  "isReport": false,
  "noteEdited": "",
  "isEdit": false
}
```

Xuat 1 bao cao PDF:

```json
{
  "controll": "bcthekho94",
  "tables": {
    "bcthekho94": "{\"dateFrom\":\"2026-01-01\",\"dateTo\":\"2026-01-31\",\"item\":\"\",\"userId\":\"1\",\"unit\":\"SINCO\",\"language\":\"Vi\"}"
  },
  "isPdfOrExcel": "pdf",
  "userID": "1",
  "unit": "SINCO",
  "language": "vi",
  "isReport": true
}
```

## 12. Quy Tac Cho AI

Khi duoc giao sua in/export:

1. Khong sua lung tung ca frontend va backend khi chua xac dinh luong `isReport`.
2. Neu la chung tu, doc `.frx` truoc, sau do doc `JsonModels`.
3. Neu la bao cao, doc `Controllers/Form/Report/*.json` truoc.
4. Neu thieu field, sua dong bo:
   - `.frx`
   - `JsonModels`
   - DB/schema neu can
5. Neu chi doi format hien thi, uu tien sua trong `.frx`.
6. Neu doi du lieu lay ra, sua `JsonModels`/query/SP tuong ung.
7. Luon test parse JSON neu sua model/config.

