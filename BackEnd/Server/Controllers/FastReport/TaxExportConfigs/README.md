# Tax Excel export configuration

Mỗi nghiệp vụ Excel PM Thuế có một file JSON với tên trùng `code`.

JSON màn hình chỉ bật tính năng và tham chiếu cấu hình:

```json
"enableTaxExcelExport": true,
"taxExcelExportConfig": "paymentslip"
```

Các thuộc tính chính:

- `controller`: controller được phép dùng cấu hình; backend từ chối nếu không khớp request.
- `storeProcedure`: store trả dữ liệu nguồn.
- `templateFile`: file trong thư mục `TaxTemplates`.
- `groupBy`: trường nhóm master/detail, có thể bỏ trống.
- `sheets[].name`: tên sheet; để trống để dùng sheet đầu tiên.
- `sheets[].startRow`: dòng bắt đầu ghi dữ liệu.
- `sheets[].headerRow`: dòng ghi header nếu ô template đang trống.
- `sheets[].rowMode`: `allRows` hoặc `firstOfGroup`.
- `sheets[].orderBy`: danh sách trường sắp xếp.
- `columns[].column`: tên cột Excel (`A`, `B`, ..., `AA`).
- `columns[].sources`: tên trường store theo thứ tự ưu tiên.
- `columns[].value`: giá trị cố định; dùng `""` để xóa nội dung ô.
- `columns[].type`: `string`, `decimal`, `integer` hoặc `date`.
- `columns[].format`: định dạng cell Excel.
- `columns[].valueMode`: dùng `firstNonZeroInGroup` khi cần lấy giá trị khác 0 đầu tiên trong nhóm.

Không khai câu SQL hoặc đường dẫn template trong JSON màn hình. Backend chỉ đọc file cấu hình
trong thư mục này và kiểm tra controller trước khi gọi store.
