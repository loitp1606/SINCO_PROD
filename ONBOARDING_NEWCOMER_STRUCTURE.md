# SINCO Onboarding Guide (Backend + Frontend)

Tài liệu này dành cho người mới vào dự án SINCO. Mục tiêu là đọc 1 lần để biết:

- Hệ thống gồm những phần nào.
- Khi có yêu cầu mới thì phải sửa ở đâu.
- Cách lần lỗi từ UI xuống DB.
- Quy trình làm việc an toàn để không làm vỡ luồng đang chạy.

## 1. Bức tranh tổng thể

Repository hiện tại có 2 phần:

- `main/BackEnd`: ASP.NET Core API, business logic, SQL scripts.
- `main/FrontEnd`: Angular UI cho toàn bộ màn hình nghiệp vụ.

Luồng dữ liệu chuẩn:

1. User thao tác trên màn hình Angular.
2. Component gọi `service` để gửi HTTP request.
3. Backend `Controller` nhận request.
4. Controller gọi `Repository/Service` xử lý nghiệp vụ.
5. Repository chạy SQL/SP, trả dữ liệu về API.
6. Frontend nhận response và render lại grid/form/popup.

## 2. Cấu trúc Backend: hiểu theo vai trò

Gốc backend: `BackEnd/`

### 2.1. File/thư mục quan trọng nhất

- `Server/Program.cs`
Vai trò: nơi cấu hình toàn hệ thống (JWT, CORS, Swagger, Redis, DI, middleware).
Khi nào đụng: thêm service global, middleware, auth config, connection behavior.

- `Server/Controllers/`
Vai trò: public API endpoint.
Khi nào đụng: cần thêm endpoint mới hoặc đổi contract API.

- `Server/Repositories/`
Vai trò: xử lý nghiệp vụ và truy vấn DB.
Khi nào đụng: hầu hết yêu cầu nghiệp vụ mới/sửa dữ liệu sẽ sửa ở đây.

- `Server/Services/`
Vai trò: tiện ích hoặc logic dùng lại cho nhiều nơi.
Khi nào đụng: cần tách logic chung ra khỏi repository/controller.

- `Server/Data/`
Vai trò: DbContext, data access config.
Khi nào đụng: thay đổi cấu trúc EF hoặc cấu hình DB context.

- `Server/SqlScripts/`
Vai trò: script setup cột, function, stored procedure.
Khi nào đụng: yêu cầu thêm cột/chỉnh quy trình ghi sổ/tính toán ở DB.

- `Shared/`
Vai trò: DTO/Model dùng chung giữa các project .NET.
Khi nào đụng: thay đổi request/response model chia sẻ.

### 2.2. Công nghệ backend đang dùng

- Runtime chính: `.NET 8` (`Server/Sinco.Server.csproj`).
- Authentication: JWT Bearer.
- Logging: log4net.
- Cache: Redis (`StackExchange.Redis`).
- Data layer: kết hợp EF Core + Dapper + Stored Procedure.
- Report/export: FastReport, EPPlus, ClosedXML, PDF/Doc libs.

### 2.3. Lưu ý kỹ thuật quan trọng

- App có check `license` ngay khi startup trong `Program.cs`.
- Cấu hình DB/API token nằm ở `appsettings.json` và môi trường tương ứng.
- `Shared` đang target `net6.0`, còn `Server` target `net8.0`; khi nâng cấp package phải kiểm tra tương thích kỹ.

## 3. Cấu trúc Frontend: hiểu theo vai trò

Gốc frontend: `FrontEnd/`

### 3.1. File/thư mục quan trọng nhất

- `src/app/app.routes.ts`
Vai trò: bản đồ route toàn app.
Khi nào đụng: thêm màn hình, đổi URL, gắn guard.

- `src/app/services/`
Vai trò: lớp gọi API và gom logic client-side.
Khi nào đụng: endpoint đổi hoặc thêm API mới.

- `src/app/interceptors/`
Vai trò: xử lý HTTP global (token, error, header).
Khi nào đụng: thay đổi auth/token, chuẩn error response.

- `src/app/guards/`
Vai trò: chặn/mở route theo login/quyền.
Khi nào đụng: thay đổi policy truy cập màn hình.

- `src/app/components/`
Vai trò: thành phần dùng chung như login, navbar, sidebar, quản trị user.
Khi nào đụng: thay đổi layout/chức năng dùng chung toàn hệ thống.

- `src/app/<module>/`
Vai trò: module nghiệp vụ theo domain.
Ví dụ: `customer`, `item`, `receiptV2`, `purchase`, `report`.
Khi nào đụng: yêu cầu thuộc module nào thì sửa ngay module đó.

- `src/assets/lang/vi.json`, `src/assets/lang/en.json`
Vai trò: dictionary đa ngôn ngữ.
Khi nào đụng: thêm label/message mới trên UI.

- `src/assets/env.js` + `env-to-ts.js`
Vai trò: bridge biến môi trường runtime -> TypeScript env file.
Khi nào đụng: thay base URL/API branding/language mặc định.

- `src/styles/`
Vai trò: stylesheet hệ thống + theme.
Khi nào đụng: chỉnh style dùng chung hoặc theme global.

### 3.2. Pattern component nghiệp vụ phổ biến

Phần lớn module có dạng:

- `<entity>-list.component.ts`: màn hình danh sách, grid, filter, action.
- `<entity>-popup.component.ts`: form thêm/sửa/xem chi tiết.

Ví dụ `receiptV2`:

- `src/app/receiptV2/receiptV2.component.ts`
- `src/app/receiptV2/receiptV2-popup.component.ts`

## 4. Muốn sửa tính năng: đi theo checklist này

### 4.1. Nếu yêu cầu liên quan dữ liệu DB

1. Xác định bảng/SP bị ảnh hưởng.
2. Tạo script trong `BackEnd/Server/SqlScripts/`.
3. Đặt tên rõ mục đích (`setup_*`, `sp_*`, `beforeUpdate*`, `afterUpdate*`).
4. Nếu bảng partition theo năm, dùng `sp_AddColumnToPartitionTables`.
5. Test script trên môi trường dev trước khi ghép vào flow API.

### 4.2. Nếu yêu cầu liên quan API

1. Chốt request/response contract.
2. Sửa hoặc thêm repository xử lý logic.
3. Sửa hoặc thêm controller endpoint.
4. Nếu cần, cập nhật DTO trong `Shared/`.
5. Test bằng Swagger/Postman trước khi đụng frontend.

### 4.3. Nếu yêu cầu liên quan UI

1. Sửa module đúng domain trong `src/app/<module>/`.
2. Cập nhật service gọi API nếu backend đổi.
3. Cập nhật route nếu có màn hình mới.
4. Cập nhật `vi.json`/`en.json` cho label và message.
5. Chạy lại flow nhập liệu end-to-end.

## 5. Cách debug nhanh khi có bug

Dùng thứ tự từ ngoài vào trong:

1. Kiểm tra UI event có bắn đúng chưa (button, form value, payload).
2. Kiểm tra request trong browser network (URL, method, body, token).
3. Kiểm tra endpoint backend nhận đúng chưa (controller action).
4. Kiểm tra repository có chạy đúng nhánh logic không.
5. Kiểm tra SQL/SP chạy đúng dữ liệu đầu vào/đầu ra không.
6. Đối chiếu kết quả trả về API với dữ liệu render trên UI.

Nguyên tắc: không đoán bug bằng cảm tính, luôn bám theo chuỗi `UI -> API -> Repo -> SQL`.

## 6. Case study training: ReceiptV2

Điểm bắt đầu khi hướng dẫn người mới với `receiptV2`:

- SQL setup: `BackEnd/Server/SqlScripts/setup_receiptV2_columns.sql`
- SQL xử lý nghiệp vụ: `beforeUpdateReceiptV2.phase2.sql`, `afterUpdateReceiptV2.phase2.sql`
- SQL ghi nhận công nợ: `sp_PostDebtFromReceiptV2.sql`
- UI module: `FrontEnd/src/app/receiptV2/`

Lộ trình hướng dẫn:

1. Đọc `setup_receiptV2_columns.sql` để biết field mới và ý nghĩa nghiệp vụ.
2. Tìm payload field tương ứng trong frontend và API.
3. Theo dõi điểm save từ popup -> service -> controller -> repository -> SP.
4. Kiểm chứng bằng test thực tế: tạo mới, sửa, reload, đối chiếu DB.

## 7. Kế hoạch onboarding đề xuất cho người mới (tuần đầu)

### Ngày 1: nắm khung hệ thống

1. Clone, build, chạy backend.
2. Chạy frontend, đăng nhập vào dashboard.
3. Đọc `Program.cs` và `app.routes.ts` để hiểu entrypoint.

### Ngày 2: nắm pattern màn hình

1. Chọn 1 module master data (vd `customer`) và đọc list/popup.
2. Chọn 1 module transaction (vd `receiptV2`) và theo dõi luồng save.
3. Đọc service gọi API của 2 module vừa chọn.

### Ngày 3: thực hành thay đổi nhỏ

1. Thêm 1 label i18n mới và hiển thị lên màn hình.
2. Chỉnh 1 field hiển thị trong popup/list.
3. Tự test end-to-end và ghi lại luồng đã đụng.

### Ngày 4-5: làm task có mentor review

1. Nhận 1 task nhỏ có cả UI + API hoặc API + SQL.
2. Làm theo checklist mục 4.
3. Review với người hướng dẫn trước khi merge.

## 8. Quy ước làm việc nên nhấn mạnh cho người mới

- Mọi thay đổi nghiệp vụ nên đi đủ 3 lớp: `SQL + API + UI` nếu có liên quan dữ liệu.
- Không hardcode text UI, luôn thêm key vào `vi.json` và `en.json`.
- Đặt tên rõ nghĩa, nhất quán giữa route, folder, component.
- Tránh tạo route trùng hoặc module trùng khác kiểu đặt tên (`delivery-note` và `deliveryNote`).
- Trước khi bàn giao, luôn test lại luồng đầy đủ của nghiệp vụ đã sửa.

## 9. Danh sách file bắt buộc nên đọc đầu tiên

Backend:

- `BackEnd/Server/Program.cs`
- `BackEnd/Server/Controllers/`
- `BackEnd/Server/Repositories/`
- `BackEnd/Server/SqlScripts/`

Frontend:

- `FrontEnd/src/app/app.routes.ts`
- `FrontEnd/src/app/services/data.service.ts`
- `FrontEnd/src/app/interceptors/auth.interceptor.ts`
- `FrontEnd/src/app/receiptV2/`
- `FrontEnd/src/assets/lang/vi.json`
- `FrontEnd/src/assets/lang/en.json`

## 10. Deep Dive theo các phần trọng tâm

Phần này đi sâu đúng các khu vực mentor thường phải giải thích kỹ cho người mới.

### 10.1. `BackEnd/Server/Controllers/`: lớp public API

Mục tiêu của thư mục này là nhận request từ frontend, validate đầu vào cơ bản, gọi service/repository, và trả response chuẩn.

Các nhóm controller chính hiện tại:

- Nhóm auth/user/quyền:
  - `AuthController.cs`
  - `UserController.cs`
  - `UserGroupController.cs`
  - `MenuPermissionController.cs`
- Nhóm dynamic/data (được dùng nhiều nhất cho nghiệp vụ form động):
  - `DatasController.cs`
  - `DynamicController.cs`
  - `DynamicReportController.cs`
  - `FormConfigController.cs`
  - `LookupController.cs`
- Nhóm hạ tầng/chức năng phụ:
  - `FilesController.cs`
  - `AttachedFileController.cs`
  - `CustomQueryController.cs`
  - `DatabaseConnectionsController.cs`
  - `SystemOptionsController.cs`
  - `ReportsController.cs`, `ReportConnectionsController.cs`, `PowerBIController.cs`

Điểm mentor nên nhấn mạnh:

1. Controller không nên chứa business logic nặng.
2. Controller là nơi dễ debug request/response nhất khi mới vào dự án.
3. Khi bug API, luôn kiểm tra thứ tự: route -> model binding -> gọi service/repo -> response mapping.

### 10.2. `BackEnd/Server/Repositories/`: lõi nghiệp vụ và truy vấn DB

Repository là nơi xử lý nghiệp vụ thực tế, đặc biệt với hệ dynamic-form/dynamic-grid.

Các cụm quan trọng:

- `BaseRepository/`: CRUD/template metadata nền tảng.
- `Dynamic/`: query động theo metadata và filter runtime.
- `Report/`: truy vấn phục vụ báo cáo.
- `Lookup/`: dữ liệu lookup cho field chọn nhanh.
- `AttachedFile/`: tệp đính kèm.
- `TaxExcel/`: export excel thuế theo nghiệp vụ voucher.
- `Auth/`, `Permission/`, `Custom/`: nghiệp vụ riêng theo domain.

Các file repo/service cấp root cần hiểu:

- `DataService.cs`: lớp map endpoint `api/data/*` sang xử lý dữ liệu.
- `DatabaseConnectionRepository.cs`: quản lý kết nối DB động.
- `ReportRepository.cs`: thao tác/report data backend.
- `RedisService.cs`: wrapper cache Redis.

Điểm mentor nên nhấn mạnh:

1. Nếu frontend dùng `DataService` thì phần lớn backend đi qua `DatasController` + `Repositories/DataService`.
2. `DynamicRepository` đang xử lý phân nhánh theo `Type` (`list` hoặc `voucher`) và theo `Action` (`loading`, `finding`) cho voucher.
3. Query động có ghép SQL theo runtime nên phải ưu tiên validate kỹ field/operator/filter.

### 10.3. `FrontEnd/src/app/app.routes.ts`: bản đồ màn hình toàn hệ thống

File này là route map trung tâm, chứa hầu hết màn hình nghiệp vụ.

Điểm quan trọng trong cấu trúc hiện tại:

- Dùng `canActivate: [authGuard]` cho phần lớn màn hình cần đăng nhập.
- Kết hợp cả route `component` trực tiếp và `loadComponent` lazy cho một số màn hình.
- Có nhóm route nghiệp vụ master/transaction và nhóm route báo cáo.

Các điểm cần lưu ý khi training:

1. Người mới phải tìm route ở đây trước khi sửa UI module.
2. Không tạo path trùng.
3. Hiện đang có path trùng (`dynamic-data-grid`, `lsgdbghd`) nên khi refactor cần dọn để tránh khó debug.
4. Nên thống nhất naming route (tránh lẫn kiểu như `deliveryNote` và `delivery-note` ở các module khác).

### 10.4. `FrontEnd/src/app/services/data.service.ts`: cổng API dữ liệu động phía frontend

`data.service.ts` là service nền cho nhiều module dynamic, base URL:

- `${environment.apiUrl}/api/data`

Các method chính và endpoint tương ứng:

- `getMetadata(formId)` -> `GET /api/data/metadata/{formId}`
- `getDataList(data)` -> `GET /api/data/list`
- `postDataSave(data)` -> `POST /api/data/save`
- `deleteData(data)` -> `DELETE /api/data/delete`
- `deletedMultiData(data)` -> `DELETE /api/data/deletedMulti`
- `getDataOptions(optionId, data)` -> `GET /api/data/options/{optionId}`
- `getDataLookup(optionId, invoice, data)` -> `GET /api/data/lookup/{optionId}/{invoice}`
- `getDataReport(formId, data)` -> `GET /api/data/report/{formId}`
- `getDataReportPivot(formId, data)` -> `GET /api/data/report/pivot/{formId}`
- `postDataCustom(data)` -> `POST /api/data/custom`

Điểm mentor nên nhấn mạnh:

1. Đây là service “xương sống” của dynamic UI.
2. Đa số method đều map `response.data`; nếu backend đổi contract phải sửa đồng bộ chỗ này.
3. `deletedMultiData` hiện chưa `map(response.data)` như các method khác, nên cần lưu ý format xử lý ở component gọi.

### 10.5. `FrontEnd/src/app/interceptors/auth.interceptor.ts`: điểm gắn token và bắt lỗi phiên

Vai trò chính:

1. Lấy token từ `localStorage`.
2. Nếu token hết hạn (`authService.isTokenExpired()`), tự logout + redirect login.
3. Nếu có token hợp lệ, gắn header `Authorization: Bearer <token>`.
4. Bắt lỗi `401/403` và hiển thị thông báo phù hợp.

Điểm mentor nên nhấn mạnh:

- Đây là lớp bắt buộc phải hiểu khi debug lỗi “đang dùng bị đá ra login”.
- Khi gặp lỗi 401, cần kiểm tra cả token và session DB (backend có validate session).
- File hiện có dấu hiệu lỗi encoding chuỗi tiếng Việt; nếu chỉnh sửa nên chuẩn hóa UTF-8 để tránh khó đọc/log sai.

### 10.6. `FrontEnd/src/app/receiptV2/`: module nghiệp vụ mẫu để học full-stack

Hiện có 2 file:

- `receiptV2.component.ts`: khai báo `initData` cho grid dynamic.
- `receiptV2-popup.component.ts`: popup dynamic với:
  - `id = 'receiptV2'`
  - `name = 'receiptV2.page.json'`

`receiptV2.component.ts` cho thấy rõ pattern dynamic:

1. `id` nghiệp vụ (`receiptV2`).
2. Cấu hình `headers` (field hiển thị grid, kiểu dữ liệu, quick edit).
3. `query.formId` chứa metadata vận hành:
   - `type: "voucher"`
   - `action: "loading"`
   - `controller: "receiptV2.page.json"`
   - `listTable: ["receiptV2", "receiptdetailV2"]`
   - `idVC: "Z07"`, `VCDate: "voucherDate"`, `unit`, `language`, `userId`
4. Sort mặc định: `voucherDate desc, voucherNumber desc`.

Điểm mentor nên nhấn mạnh:

- Đây là module rất phù hợp để dạy người mới vì thể hiện đủ chain:
  `route -> grid config -> data.service -> /api/data|/api/dynamic -> repository -> SQL/SP`.
- Khi thêm field mới cho receiptV2, phải rà đủ:
  - SQL script setup/logic
  - metadata JSON page
  - header/popup field frontend
  - mapping backend trả dữ liệu

## 11. Tóm tắt 1 câu cho người mới

Muốn sửa đúng và nhanh trong SINCO, hãy luôn xác định module nghiệp vụ trước, rồi đi theo đúng chuỗi `UI -> API -> Repo -> SQL`, và kiểm chứng dữ liệu bằng test end-to-end.
