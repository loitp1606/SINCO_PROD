# Logic sửa nhanh DeliveryNote

Tài liệu này mô tả luồng **Sửa nhanh** trên màn hình `deliveryNote` / `Phiếu xuất hàng`.

## 1. Màn hình đang dùng

- Route frontend: `/deliveryNote`
- Component list: `FrontEnd/src/app/deliveryNote/deliveryNote-list.component.ts`
- Component popup: `FrontEnd/src/app/deliveryNote/deliveryNote-popup.component.ts`
- File form config đang dùng: `BackEnd/Server/Controllers/Form/deliveryNote.page.json`

Lưu ý: repo có thêm file `delivery-note.page.json`, nhưng popup hiện tại khai báo:

```ts
id = "deliveryNote"
name = "deliveryNote.page.json"
```

Vì vậy logic sửa nhanh thực tế lấy theo `deliveryNote.page.json`.

## 2. Field nào được sửa nhanh

Trong `deliveryNote.page.json`, phần detail `deliveryNoteDetail` có 3 field bật `quickEditable: true`:

| Field | Nhãn hiển thị | Type | Ý nghĩa |
| --- | --- | --- | --- |
| `invoiceNumber` | Số hóa đơn | `text` | Cho nhập/sửa số hóa đơn |
| `invoiceDate` | Ngày hóa đơn | `date` | Cho chọn ngày hóa đơn |
| `isReceived` | Đã nhận | `checkbox` | Tick/bỏ tick trạng thái đã nhận |

Các field khác trong detail không có `quickEditable: true`, nên khi bật sửa nhanh vẫn bị khóa.

## 3. Vị trí nút sửa nhanh

Nút **Sửa nhanh** nằm trong panel chi tiết sau khi expand một phiếu xuất hàng.

Điều kiện hiển thị:

- Đã expand một dòng master, tức có `expandedRowId`.
- Detail section hiện tại có ít nhất một field `quickEditable: true`.

Các nút liên quan:

- `Sửa nhanh`: bật chế độ sửa nhanh detail.
- `Chọn all`: chọn/bỏ chọn toàn bộ dòng detail đang hiển thị.
- `Áp dụng cho dòng đã chọn`: áp dụng giá trị nhập ở thanh sửa nhanh vào các dòng đã tick chọn.
- `Lưu nhanh`: lưu thay đổi detail.
- `Hủy`: bỏ thay đổi và phục hồi dữ liệu cũ.

## 3.1. Áp dụng nhanh cho nhiều dòng đã chọn

Khi đã bật **Sửa nhanh**, hệ thống hiển thị thêm một thanh áp dụng nhanh phía trên bảng chi tiết.

Đồng thời vùng browser/master phía trên sẽ tự thu gọn để nhường thêm diện tích cho bảng chi tiết. Khi **Hủy** hoặc **Lưu nhanh** thành công, chiều cao master/detail được phục hồi về trạng thái trước khi sửa nhanh.

Thanh này gồm:

- Số lượng dòng đang được chọn.
- Danh sách các field `quickEditable`.
- Checkbox bật/tắt áp dụng cho từng field.
- Ô nhập giá trị cho từng field.
- Nút `Chọn all`.
- Nút `Áp dụng cho dòng đã chọn`.

Ví dụ bài toán khách hàng:

- Có 10 dòng chi tiết.
- 7 dòng cùng số hóa đơn.
- 7 dòng này cũng cần set `Đã nhận = 1`.

Cách thao tác:

1. Bấm **Sửa nhanh**.
2. Tick chọn 7 dòng cần cập nhật.
3. Nhập `Số hóa đơn`.
4. Tick field `Số hóa đơn` để bật áp dụng field này.
5. Tick giá trị `Đã nhận`.
6. Tick field `Đã nhận` để bật áp dụng field này.
7. Bấm **Áp dụng cho dòng đã chọn**.
8. Kiểm tra lại dữ liệu trên lưới.
9. Bấm **Lưu nhanh** để gửi lên backend.

Nút `Chọn all` chỉ chọn các dòng đang hiển thị ở detail hiện tại. Nếu detail đang được lọc, nút này chỉ chọn các dòng sau lọc.

Lưu ý: hệ thống chỉ apply những field đã bật checkbox áp dụng. Điều này tránh lỗi nhập một field nhưng vô tình ghi đè field khác.

## 4. Luồng bật sửa nhanh

Khi bấm **Sửa nhanh**, frontend gọi:

```ts
startQuickEditDetail()
```

Logic chính:

1. Kiểm tra detail hiện tại có field được khai báo `quickEditable`.
2. Nếu đang sửa nhanh master thì hủy chế độ master.
3. Clone toàn bộ detail rows hiện tại vào `quickEditDetailSnapshot`.
4. Bật `quickEditDetailMode = true`.

Snapshot này dùng để phục hồi dữ liệu nếu người dùng bấm **Hủy**.

## 5. Luồng render cell khi sửa nhanh

Trong bảng detail, mỗi field được kiểm tra bằng:

```ts
isQuickEditEnabledForField(field)
```

Field chỉ được enable khi thỏa đủ điều kiện:

- Đang ở `quickEditDetailMode`.
- Detail có field quick editable.
- Field không bị `disabled`.
- Field có `quickEditable === true`.

Với deliveryNote, kết quả là:

- `invoiceNumber`: input text được enable.
- `invoiceDate`: input date được enable.
- `isReceived`: checkbox được enable.
- Các field còn lại disabled.

Riêng checkbox `isReceived` xử lý qua:

```ts
onQuickCheckboxToggle(row, field.key, event)
```

Giá trị lưu vào row:

- Checked: `1`
- Unchecked: `0`

## 6. Luồng hủy sửa nhanh

Khi bấm **Hủy**, frontend gọi:

```ts
cancelQuickEditDetail()
```

Logic chính:

1. Nếu có `quickEditDetailSnapshot`, restore lại toàn bộ detail rows từ snapshot.
2. Gọi `applyFilters()` để cập nhật lại danh sách detail đang hiển thị.
3. Tắt `quickEditDetailMode`.
4. Reset trạng thái saving.
5. Xóa snapshot.

Thông báo hiển thị:

```text
Đã hủy thay đổi nhanh ở chi tiết.
```

## 7. Luồng lưu sửa nhanh

Khi bấm **Lưu nhanh**, frontend gọi:

```ts
saveQuickEditDetail()
```

API được gọi:

```text
POST /api/Dynamic/save
```

Payload chính:

```ts
{
  controller: metadata.controller,
  formId: metadata.formId,
  action: "update",
  type: metadata.type,
  userId: localStorage.getItem("userId"),
  unit: localStorage.getItem("unit") ?? "CTY",
  language: localStorage.getItem("language") ?? "vi",
  VCDate: ...,
  idVC: metadata.idVC,
  primaryKey: metadata.primaryKey,
  originalPrimaryKeyValues: ...,
  data: {
    ...masterData,
    details: [
      {
        controllerDetail: detailSection.controllerDetail,
        formIdDetail: detailSection.formId,
        foreignKey: detailSection.foreignKey,
        data: currentDetailRows.map(...)
      }
    ]
  },
  dataProcessing: metadata.dataProcessing ?? { actions: { post: [] } }
}
```

Với deliveryNote, detail section tương ứng:

```json
{
  "controllerDetail": "deliveryNoteDetail",
  "formId": "deliveryNoteDetail",
  "foreignKey": "idGui, line_nbr"
}
```

Điểm quan trọng: khi lưu nhanh detail, frontend gửi **toàn bộ rows detail hiện tại**, không chỉ gửi 3 field vừa sửa.

## 8. Xử lý dữ liệu trước khi gửi

Trước khi gửi lên backend, dữ liệu được xử lý qua:

```ts
normalizeValues(stripQuickSaveAutoFields(row))
```

Các xử lý chính:

- Chuỗi rỗng được đổi thành `null`.
- Field có tên chứa `date` sẽ chuẩn hóa ngày dạng ISO về `yyyy-MM-dd`.
- Ngày `0001-01-01...` được đổi thành `null`.
- Một số field hệ thống bị loại khỏi payload:
  - `user_id0`
  - `user_id2`
  - `datetime0`
  - `datetime2`

## 9. Sau khi lưu thành công

Nếu API lưu thành công:

1. Tắt `quickEditDetailMode`.
2. Xóa snapshot.
3. Hiển thị thông báo:

```text
Cập nhật chi tiết thành công.
```

4. Nếu vẫn còn dòng master đang expand, gọi lại:

```ts
toggleRow(row, true)
```

Mục đích là reload lại chi tiết của dòng đó.

Nếu không xác định được dòng đang expand thì gọi:

```ts
loadData()
```

## 10. Ghi chú về sửa nhanh master

Dynamic grid có sẵn logic sửa nhanh master:

- `startQuickEditMaster()`
- `saveQuickEditMaster()`
- `cancelQuickEditMaster()`

Tuy nhiên với `deliveryNote`, hiện không thấy field master nào được khai báo `quickEditable: true`.

Vì vậy trên màn hình deliveryNote, sửa nhanh đang được dùng chủ yếu cho **detail**, không phải master.
