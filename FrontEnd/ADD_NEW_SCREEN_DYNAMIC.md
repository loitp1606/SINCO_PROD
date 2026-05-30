# Hướng Dẫn Thêm Mới Màn Hình (Không Build Lại FrontEnd)

Tài liệu này mô tả cách thêm một màn hình mới bằng cấu hình backend, không cần thêm component/route cứng ở frontend.

## 1. Nguyên tắc

Frontend đã có route động:

- List: `/screen/<screenId>`
- Popup: `/screen/<screenId>/popup`

Vì vậy khi thêm màn mới, chỉ cần thêm cấu hình ở backend và trỏ URL menu đúng chuẩn.

## 2. Các bước bắt buộc

## 2.1. Thêm file cấu hình List

Tạo file:

- `BackEnd/Server/Controllers/Browser/<screenId>.list.json`

Ví dụ:

- `BackEnd/Server/Controllers/Browser/contract.list.json`

Nội dung tối thiểu:

```json
{
  "id": "contract",
  "title": "Hợp đồng",
  "headers": [],
  "query": {
    "formId": {
      "controller": "contract.page.json",
      "formId": "contract",
      "primaryKey": ["idGui"],
      "type": "voucher",
      "action": "loading",
      "idVC": "Z04",
      "value": [],
      "listTable": ["Contract", "ContractDetail"],
      "VCDate": "",
      "isFileHandle": "export"
    }
  },
  "sort": "voucherDate desc",
  "actions": []
}
```

Ghi chú:

- `id` phải trùng `<screenId>` trong URL route động.
- `controller` trong `query.formId` là file popup metadata (`<screenId>.page.json`) hoặc file form tương ứng.

## 2.2. Thêm file cấu hình Popup

Tạo file như luồng cũ:

- `BackEnd/Server/Controllers/Form/<screenId>.page.json`

Ví dụ:

- `BackEnd/Server/Controllers/Form/contract.page.json`

File này quyết định form popup (tabs, fields, detail, lookup, dataProcessing...).

## 2.3. Trỏ Menu về route động

Trong dữ liệu menu (DB hoặc nguồn menu backend), cấu hình URL:

- URL List: `/screen/<screenId>`
- URL Popup: `/screen/<screenId>/popup`

Ví dụ với `screenId = contract`:

- `/screen/contract`
- `/screen/contract/popup`

## 3. Quy ước đặt tên

- `screenId`: dùng chữ thường, không dấu, ưu tiên `kebabCase` hoặc camelCase nhất quán.
- File list: `<screenId>.list.json`
- File popup: `<screenId>.page.json`
- `id` trong JSON list phải đúng bằng `<screenId>`.

## 4. Checklist test sau khi thêm

1. Mở list bằng URL `/screen/<screenId>`.
2. Kiểm tra grid hiển thị đúng title/header/filter/action.
3. Bấm Add/Edit/View để vào popup `/screen/<screenId>/popup`.
4. Lưu dữ liệu và xác nhận flow API/DB chạy đúng.
5. Kiểm tra quyền truy cập qua menu user thực tế.

## 5. Lỗi thường gặp

- Lỗi không hiện dữ liệu list:
  - Sai tên file `Browser/<screenId>.list.json`.
  - `id` trong JSON không khớp `<screenId>`.
  - Thiếu `query.formId.controller` hoặc `query.formId.formId`.

- Lỗi popup không mở đúng:
  - Thiếu file `Form/<screenId>.page.json`.
  - `controller` trong list JSON trỏ sai tên file `.page.json`.

- Bấm menu không vào màn mới:
  - URL menu chưa đổi sang `/screen/<screenId>`.

## 6. Ví dụ nhanh

Muốn thêm màn `warranty`:

1. Tạo `BackEnd/Server/Controllers/Browser/warranty.list.json`.
2. Tạo `BackEnd/Server/Controllers/Form/warranty.page.json`.
3. Set URL menu list: `/screen/warranty`.
4. Popup dùng: `/screen/warranty/popup`.

Xong, không cần thêm route cứng hay component mới ở frontend.
