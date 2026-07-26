# Logic Excel PM Thuế và chọn dòng trên Dynamic Grid

Tài liệu này mô tả luồng xuất **Excel PM Thuế** trên `dynamic-grid`, đặc biệt phần chọn dòng và chọn tất cả khi dữ liệu có phân trang.

## 1. Màn hình nào có Excel PM Thuế

Nút **Excel PM Thuế** chỉ hiển thị khi browser config bật:

```json
"enableTaxExcelExport": true,
"taxExcelExportConfig": "deliverynote"
```

Hiện đang thấy bật ở:

- `BackEnd/Server/Controllers/Browser/deliveryNote.list.json`
- `BackEnd/Server/Controllers/Browser/poin.list.json`
- `BackEnd/Server/Controllers/Browser/paymentSlip.list.json`
- `receiptV2` bật từ component riêng `FrontEnd/src/app/receiptV2/receiptV2.component.ts`

## 2. Vai trò của DynamicGrid

`DynamicGridComponent` không trực tiếp export file thuế. Component này chỉ:

- hiển thị checkbox chọn dòng;
- quản lý `selectedOptions`;
- truyền dữ liệu đã chọn sang `FileHandleComponent`;
- truyền flag `enableTaxExcelExport`.

Trong `dynamic-grid.component.html`:

```html
<app-file-handle
  [enableTaxExcelExport]="girdData?.query?.formId?.enableTaxExcelExport || false"
  [controll]="controll"
  [exportData]="exportData"
  [selectedExportRows]="getSelectedExportRows()"
  [exportAllRows]="filteredData">
</app-file-handle>
```

Trong đó:

- `selectedExportRows`: danh sách dòng đã chọn.
- `exportAllRows`: dữ liệu trang hiện tại / dữ liệu đang hiển thị.

## 3. Quy tắc dữ liệu khi xuất Excel PM Thuế

Trong `FileHandleComponent`, khi chọn loại export `excel-tax`, dữ liệu được lấy theo ưu tiên:

1. Nếu có dòng đã chọn: dùng `selectedExportRows`.
2. Nếu chưa chọn dòng nào: fallback về `exportAllRows`.
3. Nếu vẫn không có dữ liệu: báo lỗi không có dữ liệu để export.

Ý nghĩa thực tế:

- User tick dòng nào thì Excel PM Thuế xuất đúng các dòng đó.
- Nếu user không tick dòng nào mà bấm Excel PM Thuế, hệ thống vẫn xuất dữ liệu đang hiển thị như behavior cũ.

## 4. Checkbox chọn all trên header

Checkbox chọn all trên header hiện được hiểu là:

```text
Chọn tất cả dòng theo bộ lọc hiện tại
```

Không còn là “chọn tất cả dòng trên trang hiện tại”.

Khi user tick checkbox header:

1. Frontend lấy `response.total` để biết tổng số dòng theo filter hiện tại.
2. Gọi API `/api/Dynamic/filter` nhiều lần theo từng chunk/page.
3. Mỗi dòng trả về được đưa vào `selectedOptions`.
4. Gọi `updateExportData()`.
5. Gọi `persistSelectionState()` để lưu selection.

Khi user bỏ tick checkbox header:

1. Clear toàn bộ `selectedOptions`.
2. Clear `exportData`.
3. Clear `exportKeyMap`.
4. Clear `masterPrimaryKeys`.
5. Reset `exportCount`.
6. Rebuild lại export list mặc định.
7. Persist lại selection.

## 5. Vì sao phải fetch toàn bộ qua các trang

Dynamic grid đang dùng server-side paging.

Điều này nghĩa là:

- `filteredData` chỉ chứa dữ liệu của trang hiện tại.
- `response.total` mới là tổng số dòng theo bộ lọc.

Vì vậy, nếu user muốn “chọn all” mà dữ liệu đang phân trang, frontend không thể chỉ dùng `filteredData`. Nó phải gọi lại API theo từng page/chunk để lấy đủ toàn bộ kết quả đang lọc.

## 6. API được dùng khi chọn all

Hàm chọn all dùng lại query giống phần tính tổng nhiều trang:

```ts
buildSummaryQueryParams(page, pageSize)
```

API:

```text
GET /api/Dynamic/filter
```

Tham số chính:

- `formId`
- `filter`
- `page`
- `pageSize`
- `sort`

Filter là filter tổng hợp hiện tại, gồm:

- advanced filter;
- quick filter trên header;
- filter mặc định từ config.

## 7. Luồng export sau khi đã chọn all

Sau khi checkbox header chọn xong toàn bộ dòng:

1. `selectedOptions` chứa toàn bộ dòng theo filter.
2. `getSelectedExportRows()` trả về toàn bộ dòng đó.
3. `FileHandleComponent` nhận qua `selectedExportRows`.
4. Khi bấm **Excel PM Thuế**, payload gửi backend dùng danh sách này.

Ví dụ payload phần `tables`:

```ts
{
  deliverynote: selectedExportRows
}
```

Backend sẽ đọc từng dòng để lấy:

- `idGui`
- `voucherDate`

Sau đó gọi store tương ứng để lấy dữ liệu chuẩn cho mẫu PM Thuế.

## 8. Backend xử lý Excel PM Thuế

Frontend gọi:

```text
POST /api/Files/export-tax-excel
```

Backend đi vào:

- `FilesController.ExportTaxExcel`
- `FileService.ExportTaxExcelAsync`
- `TaxExcelExportService.ExportTaxExcelAsync`

Store, template, sheet và mapping cột được khai báo trong:

```text
BackEnd/Server/Controllers/FastReport/TaxExportConfigs
```

Các controller đang được cấu hình:

| Controller | Store | Template |
| --- | --- | --- |
| `deliverynote` | `oot$exportVat` | `XHD_Mau.xlsx` |
| `poin` | `oot$exportVatPoin` | `Mau_Phieunhapmua.xlsx` |
| `receiptv2` | `oot$exportVatReceiptV2` | `Mau_Phieu_thu.xlsx` |
| `paymentslip` | `oot$exportVatPaymentSlip` | `Mau_Phieu_chi_tvt.xlsx` |

## 9. Ghi chú nghiệp vụ

- Chọn all header là chọn toàn bộ dữ liệu theo filter hiện tại, không phụ thuộc trang đang đứng.
- Nếu đang filter, chọn all chỉ chọn dữ liệu sau filter.
- Nếu không filter, chọn all sẽ chọn toàn bộ dữ liệu của màn hình đó.
- Excel PM Thuế ưu tiên dòng đã chọn, nên user có thể xuất một phần hoặc toàn bộ tùy selection.
