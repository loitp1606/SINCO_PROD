using ClosedXML.Excel;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using FastReport;
using FastReport.Data;
using FastReport.Export.OoXML;
using FastReport.Export.Pdf;
using FastReport.Table;
using FastReport.Utils;
using Newtonsoft.Json;
using OfficeOpenXml;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using reportSystem01.Shared;
using Sinco.Server.Helpers;
using Sinco.Server.Models;
using Sinco.Server.Repositories.BaseRepository;
using Sinco.Server.Repositories.Report;
using Sinco.Server.SqlJsonDefinations;
using System.Data;
using System.Dynamic;
using System.Text.Json;
using static Sinco.Server.SqlJsonDefinations.SqlJsonDefination;
using Color = System.Drawing.Color;
using TableRow = FastReport.Table.TableRow;
// Sử dụng alias để tránh xung đột với Spire.Doc
using Wp = DocumentFormat.OpenXml.Wordprocessing;
// using WpI = DocumentFormat.OpenXml.Drawing.Wordprocessing; // Có thể cần nếu bạn dùng Drawing
// ... (các using khác của dự án)


namespace Sinco.Server.Repositories
{
    public class FileRequest
    {
        public IFormFile? File { get; set; }
        public string Type { get; set; } = string.Empty;
        public string Header { get; set; } = string.Empty;
        public string Controll { get; set; } = string.Empty;
        public string? User { get; set; }
        public bool? OverWrite { get; set; }
        public List<string> GetHeaderList()
        {
            return string.IsNullOrEmpty(Header)
                ? new List<string>()
                : JsonConvert.DeserializeObject<List<string>>(Header) ?? new List<string>();
        }
    }
    public class ImportFileResponse
    {
        public byte[] FileBytes { get; set; } = [];
        public string FileName { get; set; } = "template.xlsx";
        public string ContentType { get; set; } = "application/octet-stream";
    }

    public class ReportRequest
    {
        //tên file mẫu frx
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

    public interface IFileService
    {
        Task<ServiceResponse<object>> ImportFileAsync(FileRequest fileRequest);
        Task<ServiceResponse<MemoryStream>> ExportPdfAsync(ReportRequest request);
        Task<ServiceResponse<MemoryStream>> ExportDeliveryNoteTaxExcelAsync(ReportRequest request);
    }
    public class FileService : IFileService
    {
        private readonly IBaseRepository<ExpandoObject> _repository;
        private readonly IRedisService _redisService;
        private readonly IDynamicReportService _dynamicReport;
        private readonly ITaxExcelExportService _taxExcelExportService;

        public FileService(
            IBaseRepository<ExpandoObject> baseRepository,
            IRedisService redisService,
            IDynamicReportService dynamicReport,
            ITaxExcelExportService taxExcelExportService
        )
        {
            _repository = baseRepository;
            _redisService = redisService;
            _dynamicReport = dynamicReport;
            _taxExcelExportService = taxExcelExportService;
        }

        public async Task<ServiceResponse<object>> ImportFileAsync(FileRequest fileRequest)
        {
            var result = new ServiceResponse<object>();
            try
            {
                //lấy user
                var userAssign = new Dictionary<string, object>();
                if (!string.IsNullOrEmpty(fileRequest.User))
                {
                    var userDict = JsonConvert.DeserializeObject<Dictionary<string, object>>(fileRequest.User);

                    if (userDict != null && userDict.Count > 0)
                    {
                        foreach (var kv in userDict)
                        {
                            if (kv.Key.Contains("datetime", StringComparison.OrdinalIgnoreCase))
                            {
                                userAssign[kv.Key] = DateTime.Now;
                            }
                            else
                            {
                                userAssign[kv.Key] = kv.Value ?? "";
                            }
                        }
                    }
                }
                var sqlDefinition = await _repository.GetTemplateByTableNameAsync(fileRequest.Controll);
                var colNames = new List<ExcelIntegrationMap.ExcelColumnMapping>();
                colNames.AddRange(sqlDefinition.ExcelIntegration.ColumnMapping);
                if (sqlDefinition.ForiegnModel != null)
                    foreach (var foriegnTable in sqlDefinition.ForiegnModel)
                    {
                        colNames.AddRange(foriegnTable.ExcelIntegration.ColumnMapping);
                    }
                if (sqlDefinition == null || sqlDefinition.ExcelIntegration?.ColumnMapping == null)
                {
                    result.Success = false;
                    result.Message = "Không tìm thấy thông tin cấu hình mẫu.";
                    return result;
                }
                // Lấy định nghĩa Master + Detail
                var foriegnDefs = new List<SqlJsonDefination>();
                if (sqlDefinition.ForiegnModel != null)
                    foriegnDefs.AddRange(sqlDefinition.ForiegnModel);
                if (fileRequest.Type != null)
                {
                    switch (fileRequest.Type)
                    {
                        case "template":
                            if (string.IsNullOrWhiteSpace(fileRequest.Controll))
                            {
                                result.Success = false;
                                result.Message = "Thiếu thông tin bảng (controll).";
                                return result;
                            }
                            //tạo template dựa trên file json mẫu
                            var report = await CreateTemplateFromDefinition(sqlDefinition, foriegnDefs);
                            byte[] fileBytes;
                            using (var ms = new MemoryStream())
                            {
                                report.Prepare();
                                var export = new FastReport.Export.OoXML.Excel2007Export
                                {
                                    ShowProgress = false
                                };
                                report.Export(export, ms);
                                fileBytes = ms.ToArray();
                            }
                            // thiết lập LicenseContext trước khi mở package
                            ExcelPackage.License.SetNonCommercialPersonal("SaiGonSinco");
                            var allExcelMap = new List<SqlJsonDefination.ExcelIntegrationMap.ExcelColumnMapping>();
                            allExcelMap.AddRange(sqlDefinition.ExcelIntegration.ColumnMapping);
                            foreach (var foriegnDef in foriegnDefs)
                            {
                                allExcelMap.AddRange(foriegnDef.ExcelIntegration.ColumnMapping);
                            }
                            using (var package = new OfficeOpenXml.ExcelPackage(new MemoryStream(fileBytes)))
                            {
                                var ws = package.Workbook.Worksheets[0]; // Sheet chính
                                var lookupSheet = package.Workbook.Worksheets.Add("Lookup"); // Sheet ẩn chứa dropdown
                                lookupSheet.Hidden = eWorkSheetHidden.VeryHidden;

                                int dataStartRow = 3;
                                int totalRows = 1000;
                                int colIndex = 1;
                                int lookupColIndex = 1; // Cột trong sheet Lookup

                                foreach (var col in allExcelMap)
                                {
                                    if (!string.IsNullOrEmpty(col.ClauseForiegn))
                                    {
                                        var foreignData = await _repository.GetForeignDataAsync(col.ClauseForiegn);

                                        // 1. Ghi dữ liệu vào sheet Lookup:
                                        // hiển thị "Code - Name" để người dùng dễ chọn,
                                        // import sẽ tách lại "Code" ở BaseRepository.
                                        int lookupRow = 1;
                                        foreach (var item in foreignData)
                                        {
                                            var displayValue = string.IsNullOrWhiteSpace(item.Name)
                                                ? item.Code
                                                : $"{item.Code} - {item.Name}";
                                            lookupSheet.Cells[lookupRow++, lookupColIndex].Value = displayValue;
                                        }

                                        // 2. Tạo DataValidation tham chiếu đến Lookup sheet
                                        var validation = ws.DataValidations.AddListValidation(
                                            ws.Cells[dataStartRow, colIndex, dataStartRow + totalRows - 1, colIndex].Address
                                        );

                                        string colLetter = GetColumnLetter(lookupColIndex);
                                        validation.Formula.ExcelFormula = $"=Lookup!${colLetter}$1:${colLetter}${foreignData.Count}";

                                        lookupColIndex++;
                                    }

                                    colIndex++;
                                }

                                fileBytes = package.GetAsByteArray();
                            }

                            // Trả về file dạng response
                            result.Success = true;
                            result.Message = "Tạo file mẫu thành công.";
                            result.Data = new ImportFileResponse
                            {
                                FileBytes = fileBytes,
                                FileName = $"{fileRequest.Controll}_template.xlsx",
                                ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            };
                            return result;

                        case "import":
                            if (fileRequest.File == null)
                            {
                                result.Success = false;
                                result.Message = "Không có file được gửi lên.";
                                return result;
                            }
                            var extension = Path.GetExtension(fileRequest.File!.FileName).ToLower();
                            //var expectedCols = sqlDefinition.ExcelIntegration.ColumnMapping.Select(c => c.ExcelColumn.ToLower()).ToList();
                            //read file
                            DataTable table = extension switch
                            {
                                ".csv" => FileHelpers.ReadCsvToDataTableWithMapping(fileRequest.File, colNames),
                                ".xlsx" or ".xsl" => FileHelpers.ReadXlsxToDataTable(fileRequest.File),
                                _ => throw new InvalidOperationException("Unsupported file format.")
                            };
                            // Tách Excel thành nhiều DataTable
                            var (dataTables, errors) = _repository.SplitFlatTableWithHeaderDetection(table, sqlDefinition, foriegnDefs);



                            if (errors.Any())
                            {
                                result.StatusCode = 400;
                                result.Success = false;
                                result.Message = string.Join(", ", errors);
                                return result;
                            }
                            //call repo
                            var contrller = fileRequest.Controll;
                            if (contrller == "QuotationPaper")
                            {
                                //thêm ghi chú mặc định cho quotationpaper

                                var upsertResultBG = await _repository.UpsertAsyncQuaquotationPaper(dataTables, sqlDefinition, foriegnDefs, userAssign, fileRequest.OverWrite);
                            }
                            else
                            {
                                var upsertResult = await _repository.UpsertMultipleTablesAsync(dataTables, sqlDefinition, foriegnDefs, userAssign, fileRequest.OverWrite);
                            }
                            result.StatusCode = 200;
                            result.Success = true;
                            result.Message = "File import successfully";
                            break;
                    }
                }
            }
            catch (ExceptionFormat ex)
            {
                if (ex.Code != null && ex.Code == 409)
                {
                    result.StatusCode = 409;
                    result.Success = false;
                    result.Message = ex.Message;
                    result.Data = ex.Errors; // Trả về list lỗi đầy đủ
                }
                else
                {
                    result.StatusCode = 400;
                    result.Success = false;
                    result.Message = ex.Message;
                    result.Data = ex.Errors; //
                }
            }
            catch (Exception ex)
            {
                result.StatusCode = 500;
                result.Success = false;
                result.Message = $"Import failed: {ex.Message}";
            }
            return result;
        }

        public async Task<ServiceResponse<MemoryStream>> ExportPdfAsync(ReportRequest request)
        {
            var response = new ServiceResponse<MemoryStream>();
            string isExport = request.IsPdfOrExcel.ToString().ToLower();
            string fileNameBase = "";

            try
            {
                var tempReportForTemplateLoad = new FastReport.Report();
                string filePath = Path.Combine($"Controllers\\FastReport\\{request.Controll!.Trim().ToLower()}.frx");
                if (request.IsReport != null && request.IsReport == true)
                {
                    filePath = Path.Combine($"Controllers\\FastReport\\Reports\\{request.Controll!.Trim().ToLower()}.frx");
                }
                bool hasFrx = System.IO.File.Exists(filePath);

                if (!hasFrx)
                {
                    response.Success = false;
                    response.Message = $"Không tìm thấy file báo cáo: {request.Controll!.Trim().ToLower()}.frx";
                    return (response);
                }

                List<string> frxDataSourceAliases = new List<string>();
                tempReportForTemplateLoad.Load(filePath);
                foreach (DataSourceBase ds in tempReportForTemplateLoad.Dictionary.DataSources)
                {
                    frxDataSourceAliases.Add(ds.Alias);
                }
                //// Lấy TextObject (note) nếu có
                //string noteText = "";
                //var textObj = tempReportForTemplateLoad.FindObject("Note") as FastReport.TextObject;
                //if (textObj != null)
                //{
                //    noteText = textObj.Text;
                //}
                tempReportForTemplateLoad.Dispose();

                List<FastReport.Report> reportsToExport = new List<FastReport.Report>();
                foreach (var table in request.Tables)
                {
                    var originalTableName = table.Key;
                    var TableDatas = new List<Dictionary<string, List<Dictionary<string, object>>>>();
                    var dataSetForCurrentReport = new DataSet("ReportData");
                    var currentReport = new FastReport.Report();
                    currentReport.Load(filePath);
                    if (request.IsReport == true)
                    {
                        var formConfig = Path.Combine("Controllers", "Form", "Report", originalTableName + ".json");
                        var jsonContent = await File.ReadAllTextAsync(formConfig);
                        var reportConfig = System.Text.Json.JsonSerializer.Deserialize<DynamicReportResponse>(jsonContent, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                        if (reportConfig?.DataProcessing?.Report == null || !reportConfig.DataProcessing.Report.Any())
                        {
                            response.Success = false;
                            response.Message = "Không tìm thấy cấu hình dataProcessing trong file report";
                            return response;
                        }
                        var queryConfig = reportConfig.DataProcessing.Report.First();
                        var query = queryConfig.Query;
                        var paramDict = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(table.Value.ToString()!);
                        var paramTable = new List<Dictionary<string, object>>();
                        if (paramDict != null)
                        {
                            foreach (var param in paramDict)
                            {
                                // Nếu query có dạng N'@param' thì ta replace luôn
                                query = query.Replace($"@{param.Key}", param.Value);
                            }
                            // Convert paramDict thành List<Dictionary<string, object>>
                            paramTable = new List<Dictionary<string, object>>
                                                {
                                                    paramDict.ToDictionary(kv => kv.Key, kv => (object)kv.Value)
                                                };
                        }

                        // Thực thi query
                        var data = await _dynamicReport.ExecuteQueryAsync(query);
                        // Tạo dictionary với key là tên bảng (ví dụ originalTableName)
                        var tableDict = new Dictionary<string, List<Dictionary<string, object>>>
                                                {
                                                    { originalTableName, data },
                                                    { "param", paramTable}
                                                };

                        // Add vào TableDatas
                        TableDatas.Add(tableDict);
                    }
                    else
                    {
                        var split = originalTableName.Split("$");
                        var suffix = "$" + split[1];
                        fileNameBase = split[0] + split[1]; //set file name
                                                            //get expected source from frx
                        var expectedSources = ExtractTableNameFromFrx(filePath);
                        var idValue = table.Value.ToString();
                        //get data from db
                        TableDatas = await _repository.GetTablesAsync(suffix, idValue, expectedSources);
                        //serialize to json 
                        ////đã có note -> lấy data từ redis
                        //var cachedData = await _redisService.GetStringAsync($"{originalTableName}");
                    }

                    foreach (var tableData in TableDatas)
                    {
                        if (tableData != null)
                        {
                            foreach (var kv in tableData)
                            {
                                var dataTable = FileHelpers.ConvertToDataTable(kv.Value);
                                dataTable.TableName = kv.Key.ToLower();
                                dataSetForCurrentReport.Tables.Add(dataTable);
                            }
                        }
                    }

                    // Log danh sách TableName trong DataSet
                    //Console.WriteLine("=== Danh sách TableName trong dataSetForCurrentReport.Tables ===");
                    //foreach (DataTable tbl in dataSetForCurrentReport.Tables)
                    //{
                    //    Console.WriteLine($"TableName: '{tbl.TableName}'");
                    //}

                    // Log danh sách TableDataSource (Alias) trong file .frx
                    //Console.WriteLine("=== Danh sách TableDataSource (Alias) trong file .frx ===");
                    //foreach (var alias in frxDataSourceAliases)
                    //{
                    //    Console.WriteLine($"Alias: '{alias}'");
                    //}
                    //regist dataset to fast report
                    currentReport.RegisterData(dataSetForCurrentReport, "ReportData", true);
                    // Enable all data sources in the report
                    foreach (DataTable tableCurrent in dataSetForCurrentReport.Tables)
                    {
                        var source = currentReport.GetDataSource(tableCurrent.TableName);
                        if (source != null)
                        {
                            source.Enabled = true;
                        }
                    }
                    reportsToExport.Add(currentReport);
                }

                var finalMs = new MemoryStream();

                if (isExport == "pdf")
                {
                    var pdfStreams = new List<MemoryStream>();

                    foreach (var r in reportsToExport)
                    {
                        var pdfExport = new PDFExport { AllowPrint = true };

                        using (var tempMs = new MemoryStream())
                        {
                            r.Prepare();
                            r.Export(pdfExport, tempMs);
                            tempMs.Position = 0;
                            pdfStreams.Add(new MemoryStream(tempMs.ToArray()));
                        }
                        r.Dispose();
                    }

                    using (var outputDocument = new PdfDocument())
                    {
                        foreach (var pdfStream in pdfStreams)
                        {
                            using (var inputDocument = PdfReader.Open(pdfStream, PdfDocumentOpenMode.Import))
                            {
                                for (int i = 0; i < inputDocument.PageCount; i++)
                                {
                                    outputDocument.AddPage(inputDocument.Pages[i]);
                                }
                            }
                            pdfStream.Dispose();
                        }

                        outputDocument.Save(finalMs);
                        finalMs.Position = 0;
                    }

                    response.Message = $"{fileNameBase}.pdf";
                }
                else if (isExport == "excel")
                {
                    var excelStreams = new List<MemoryStream>();

                    foreach (var r in reportsToExport)
                    {
                        var excelExport = new Excel2007Export();
                        using (var tempMs = new MemoryStream())
                        {
                            r.Prepare();
                            r.Export(excelExport, tempMs);
                            tempMs.Position = 0;
                            excelStreams.Add(new MemoryStream(tempMs.ToArray()));
                        }
                        r.Dispose();
                    }

                    using (var finalWorkbook = new XLWorkbook())
                    {
                        int sheetIndex = 1;

                        foreach (var excelStream in excelStreams)
                        {
                            using (var tempWorkbook = new XLWorkbook(excelStream))
                            {
                                var ws = tempWorkbook.Worksheets.First();
                                // Đặt tên mới ngay tại workbook tạm
                                string newName = $"{fileNameBase}{sheetIndex++}";
                                ws.Name = newName;

                                // Copy sang workbook cuối
                                finalWorkbook.AddWorksheet(ws);
                            }
                            excelStream.Dispose();
                        }

                        finalWorkbook.SaveAs(finalMs);
                        finalMs.Position = 0;
                    }

                    response.Message = $"{fileNameBase}.xlsx";
                }
                else if (isExport == "word")
                {
                    var wordStreams = new List<MemoryStream>();

                    foreach (var r in reportsToExport)
                    {
                        var wordExport = new FastReport.Export.OoXML.Word2007Export();
                        using (var tempMs = new MemoryStream())
                        {
                            r.Prepare();
                            r.Export(wordExport, tempMs);
                            tempMs.Position = 0;

                            // THAY THẾ: Tạo MemoryStream mới có khả năng mở rộng (Expandable MemoryStream)
                            var expandableMs = new MemoryStream();
                            tempMs.CopyTo(expandableMs);
                            expandableMs.Position = 0;

                            wordStreams.Add(expandableMs);
                        }
                        r.Dispose();
                    }

                    // Gộp nhiều file DOCX lại thành 1 bằng Open XML SDK
                    if (wordStreams.Count > 0)
                    {
                        finalMs = MergeWordDocuments(wordStreams);
                    }
                    else
                    {
                        finalMs = new MemoryStream();
                    }

                    response.Message = $"{fileNameBase}.docx";
                }
                else
                {
                    response.Success = false;
                    response.Message = "Invalid export type. Only 'pdf', 'excel', or 'word' allowed.";
                    return (response);
                }

                response.Data = finalMs;
                response.Success = true;
            }
            catch (Exception ex)
            {
                response.Success = false;
                response.Message = $"Lỗi Server: {ex.Message}";
                Console.WriteLine($"ExportPdfAsync Error: {ex}");
            }

            return (response);
        }

        public async Task<ServiceResponse<MemoryStream>> ExportDeliveryNoteTaxExcelAsync(ReportRequest request)
        {
            return await _taxExcelExportService.ExportTaxExcelAsync(request);
        }

        #region Export 
        public static MemoryStream MergeWordDocuments(List<MemoryStream> streams)
        {
            if (streams == null || streams.Count == 0) return new MemoryStream();

            MemoryStream mainStream = streams[0];

            using (WordprocessingDocument mainDocument = WordprocessingDocument.Open(mainStream, true))
            {
                // With this null-safe version:
                MainDocumentPart? mainPart = mainDocument.MainDocumentPart;
                if (mainPart == null)
                    throw new InvalidOperationException("MainDocumentPart is null.");
                // Sử dụng alias Wp cho Body
                Wp::Body? mainBody = mainPart.Document.Body;

                for (int i = 1; i < streams.Count; i++)
                {
                    MemoryStream currentStream = streams[i];
                    if (mainBody == null)
                        throw new InvalidOperationException("MainDocumentBody is null.");
                    // 1. Thêm Page Break (sử dụng alias Wp)
                    mainBody.Append(new Wp::Paragraph(
                        new Wp::Run(
                            new Wp::Break()
                            {
                                Type = Wp::BreakValues.Page // Sử dụng Wp::BreakValues
                            }
                        )
                    ));

                    // 2. Gắn nội dung của tài liệu tiếp theo
                    using (WordprocessingDocument srcDocument = WordprocessingDocument.Open(currentStream, false))
                    {
                        MainDocumentPart? srcPart = srcDocument.MainDocumentPart;
                        if (srcPart == null)
                            throw new InvalidOperationException("SrcDocumentPart is null.");
                        // Sử dụng alias Wp cho Body
                        Wp::Body? srcBody = srcPart.Document.Body;
                        if (srcBody == null)
                            throw new InvalidOperationException("SrcDocumentBody is null.");
                        foreach (var element in srcBody.Elements())
                        {
                            mainBody.Append(element.CloneNode(true));
                        }
                    }
                }
                mainPart.Document.Save();
            }

            mainStream.Position = 0;

            for (int i = 1; i < streams.Count; i++)
            {
                streams[i].Dispose();
            }

            return mainStream;
        }
        /// <summary>
        /// Hàm để lấy Data Table từ Frx
        /// </summary>
        /// <param name="filePath"></param>
        /// <returns></returns>
        private Dictionary<string, List<string>> ExtractTableNameFromFrx(string filePath)
        {
            var extractedData = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var doc = new System.Xml.XmlDocument();
                doc.Load(filePath);

                var dataSources = doc.SelectNodes("//TableDataSource");
                if (dataSources != null)
                {
                    foreach (System.Xml.XmlNode dsNode in dataSources)
                    {
                        string? sourceKey = dsNode.Attributes?["Name"]?.Value;
                        if (!string.IsNullOrEmpty(sourceKey))
                        {
                            List<string> columns = new List<string>();
                            var columnNodes = dsNode.SelectNodes("Column");
                            if (columnNodes != null)
                            {
                                foreach (System.Xml.XmlNode colNode in columnNodes)
                                {
                                    string? columnName = colNode.Attributes?["Name"]?.Value;
                                    if (!string.IsNullOrEmpty(columnName))
                                    {
                                        columns.Add(columnName);
                                    }
                                }
                            }
                            extractedData[sourceKey] = columns;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error extracting FRX data: {ex.Message}");
            }
            return extractedData;
        }

        #endregion

        #region Import
        // Hàm chuyển số cột sang chữ
        string GetColumnLetter(int col)
        {
            int div = col;
            string colLetter = "";
            while (div > 0)
            {
                int mod = (div - 1) % 26;
                colLetter = (char)(65 + mod) + colLetter;
                div = (div - mod - 1) / 26;
            }
            return colLetter;
        }

        private Task<FastReport.Report> CreateTemplateFromDefinition(SqlJsonDefination masterDef, List<SqlJsonDefination>? foreignDefs)
        {
            var report = new FastReport.Report();
            var page = new ReportPage();




            report.Pages.Add(page);

            // Band 1: Tên bảng
            var bandHeader = new DataBand
            {
                Name = "TableNameBand",
                Height = Units.Centimeters * 0.8f,
                Top = Units.Centimeters * 1
            };
            page.Bands.Add(bandHeader);

            // Band 2: Tên cột
            var bandColumn = new DataBand
            {
                Name = "ColumnBand",
                Height = Units.Centimeters * 0.8f,
                Top = bandHeader.Top + bandHeader.Height
            };
            page.Bands.Add(bandColumn);

            // Danh sách cột tổng gồm Master + Foreign
            var totalColumns = new List<(string TableName, ExcelIntegrationMap.ExcelColumnMapping ColumnMap)>();

            // Master fields
            foreach (var col in masterDef.ExcelIntegration.ColumnMapping)
            {
                totalColumns.Add((masterDef.Model, col));
            }

            // Foreign tables
            if (foreignDefs != null && foreignDefs.Count > 0)
            {
                foreach (var foreignTable in foreignDefs)
                {
                    if (foreignTable?.ExcelIntegration?.ColumnMapping != null)
                    {
                        foreach (var col in foreignTable.ExcelIntegration.ColumnMapping)
                        {
                            totalColumns.Add((foreignTable.Model, col));
                        }
                    }
                }
            }

            // Vẽ các cột
            float leftMargin = Units.Millimeters * 10; // 1cm
            float rightMargin = Units.Millimeters * 10; // 1cm
            float maxPageWidth = Units.Millimeters * 1200; // A4 dọc = 210mm | A3 (297) | a2 (420)

            float totalWidth = maxPageWidth - leftMargin - rightMargin;

            float charWidth = Units.Millimeters * 2.5f; // Giả sử mỗi ký tự tốn ~2.5mm (~0.25cm), tùy font

            // 1. Tính độ rộng cần thiết cho từng cột
            List<float> columnWidths = new();
            for (int i = 0; i < totalColumns.Count; i++)
            {
                var col = totalColumns[i];
                string colText = col.ColumnMap.Required == true ? $"{col.ColumnMap.ExcelColumn} *" : col.ColumnMap.ExcelColumn;
                string tableName = col.TableName;

                // Lấy độ dài lớn hơn giữa tên bảng và tên cột
                bool isHidden = col.ColumnMap.Hide == true;
                // Nếu hide thì width = rất nhỏ (vd: 0.1 mm)
                float width;
                if (isHidden)
                {
                    width = Units.Millimeters * 0.1f;
                }
                else
                {
                    // Lấy độ dài lớn hơn giữa tên bảng và tên cột
                    int textLen = Math.Max(tableName.Length, colText.Length);
                    width = textLen * charWidth;
                }

                columnWidths.Add(width);
            }

            // 2. Tính tổng width, nếu > tổng cho phép thì scale nhỏ lại
            float totalComputedWidth = columnWidths.Sum();
            float scale = totalComputedWidth > totalWidth ? totalWidth / totalComputedWidth : 1;
            page.PaperWidth = 2000f;
            page.PaperHeight = 1200f;
            page.Landscape = true; // nếu hỗ trợ

            // 3. Vẽ từng cột: header bảng
            float left = 0;
            string lastTableName = "";
            for (int i = 0; i < totalColumns.Count; i++)
            {
                var (tableName, _) = totalColumns[i];
                var col = totalColumns[i];
                string text = tableName != lastTableName ? tableName : col.ColumnMap.ExcelColumn;

                float width = columnWidths[i] * scale;

                var cell = new TextObject
                {
                    Left = left,
                    Top = 0,
                    Width = width,
                    Height = bandHeader.Height,
                    Text = text.ToUpper(),
                    HorzAlign = HorzAlign.Center,
                    VertAlign = VertAlign.Center,
                    Border = new FastReport.Border { Lines = BorderLines.All },
                    FillColor = Color.Green,
                    TextColor = tableName != lastTableName ? Color.Yellow : Color.White,
                };
                bandHeader.Objects.Add(cell);
                left += width;
                lastTableName = tableName;
            }

            // 4. Vẽ từng cột: header cột
            left = 0;
            for (int i = 0; i < totalColumns.Count; i++)
            {
                var col = totalColumns[i];
                string text = col.ColumnMap.Required == true ? $"{col.ColumnMap.FieldName} *" : col.ColumnMap.FieldName;
                float width = columnWidths[i] * scale;

                var cell = new TextObject
                {
                    Left = left,
                    Top = 0,
                    Width = width,
                    Height = bandColumn.Height,
                    Text = text,
                    HorzAlign = HorzAlign.Center,
                    VertAlign = VertAlign.Center,
                    Border = new FastReport.Border { Lines = BorderLines.All },
                    TextColor = col.ColumnMap.Required == true ? Color.Red : Color.Black
                };

                bandColumn.Objects.Add(cell);
                left += width;
            }
            return Task.FromResult(report);
        }
        #endregion

        #region Generate dynamic page 
        /// <summary>
		/// Hàm tạo dynamic page dựa trên dataset 
		/// </summary>
		/// <param name="report"></param>
		/// <param name="dataSet"></param>
		private void AddDynamicBandsAndTables(FastReport.Report report, DataSet dataSet)
        {
            // Xoá các trang cũ
            var clonedHeader = new PageHeaderBand();
            if (report.Pages.Count > 0)
            {
                var firstPage = report.Pages[0] as ReportPage;
                var originPageHeader = firstPage?.PageHeader;
                if (originPageHeader != null)
                {
                    clonedHeader = ClonePageHeader(originPageHeader);
                }
                for (int i = report.Pages.Count - 1; i >= 0; i--)
                {
                    report.Pages.RemoveAt(i);
                }
            }

            foreach (DataTable table in dataSet.Tables)
            {
                var page = new ReportPage
                {
                    Name = $"Page_{table.TableName}"
                };
                report.Pages.Add(page);

                string tableName = table.TableName;
                string dataBandName = $"Data_{tableName}";
                if (report.FindObject(dataBandName) != null) continue;

                // Tách hàm tính chiều rộng, trả về layout
                var layout = CalculateTableLayout(page, table);

                float top = 0;
                float rowHeight = Units.Centimeters * 0.9f;

                // --- GroupHeader ---
                if (clonedHeader != null)
                {
                    var headerClone = ClonePageHeader(clonedHeader);
                    var textObj = headerClone.Objects.OfType<TextObject>().FirstOrDefault();
                    if (textObj != null)
                        textObj.Text = table.TableName.ToUpper();
                    page.PageHeader = headerClone;
                    top += headerClone.Height;
                }

                // --- Header Band ---
                var headerBand = new GroupHeaderBand
                {
                    Name = $"Header_{tableName}",
                    Condition = "true", // Cần thiết để hiện header
                    Height = rowHeight,
                    CanGrow = true,
                    RepeatOnEveryPage = true
                };

                var headerTable = new TableObject
                {
                    Name = $"HeaderTable_{tableName}",
                    Width = layout.TotalWidth,
                    Height = rowHeight,
                    Left = layout.LeftOffset
                };

                var headerRow = new TableRow
                {
                    Height = rowHeight,
                    AutoSize = true
                };

                // STT column
                headerRow.AddChild(new FastReport.Table.TableCell
                {
                    Text = "STT",
                    Border = { Lines = BorderLines.All },
                    HorzAlign = HorzAlign.Center,
                    VertAlign = VertAlign.Center
                });

                // Các cột còn lại
                foreach (DataColumn col in table.Columns)
                {
                    headerRow.AddChild(new FastReport.Table.TableCell
                    {
                        Text = col.ColumnName,
                        Border = { Lines = BorderLines.All },
                        HorzAlign = HorzAlign.Center,
                        VertAlign = VertAlign.Center
                    });
                }

                headerTable.Columns.AddRange(layout.ColumnWidths.Select(w => new FastReport.Table.TableColumn { Width = w }).ToArray());
                headerTable.Rows.Add(headerRow);
                headerBand.Objects.Add(headerTable);

                // --- Data Band ---
                var dataBand = new DataBand
                {
                    Name = dataBandName,
                    DataSource = report.GetDataSource(tableName),
                    Height = rowHeight,
                    CanGrow = true
                };

                var dataTable = new TableObject
                {
                    Name = $"Table_{tableName}",
                    Width = layout.TotalWidth,
                    Height = rowHeight,
                    Left = layout.LeftOffset
                };

                var dataRow = new TableRow
                {
                    Height = rowHeight,
                    AutoSize = true,
                };

                dataRow.AddChild(new FastReport.Table.TableCell
                {
                    Text = "[Row#]",
                    Border = { Lines = BorderLines.All },
                    HorzAlign = HorzAlign.Center,
                    VertAlign = VertAlign.Center
                });

                foreach (DataColumn col in table.Columns)
                {
                    dataRow.AddChild(new FastReport.Table.TableCell
                    {
                        Text = $"[{tableName}.{col.ColumnName}]",
                        Border = { Lines = BorderLines.All },
                        HorzAlign = HorzAlign.Center,
                        VertAlign = VertAlign.Center,
                    });
                }

                dataTable.Columns.AddRange(layout.ColumnWidths.Select(w => new FastReport.Table.TableColumn { Width = w }).ToArray());
                dataTable.Rows.Add(dataRow);
                dataBand.Objects.Add(dataTable);

                // GẮN DATABAND VÀO HEADERBAND
                headerBand.AddChild(dataBand);

                // Cuối cùng gắn headerBand vào trang
                page.Bands.Add(headerBand);

            }
        }

        private class TableLayoutInfo
        {
            public List<float> ColumnWidths { get; set; } = new();
            public float TotalWidth { get; set; }
            public float LeftOffset { get; set; }
        }

        /// <summary>
        /// Hàm tính layout của table 
        /// </summary>
        /// <param name="page"></param>
        /// <param name="table"></param>
        /// <returns></returns>
        private TableLayoutInfo CalculateTableLayout(ReportPage page, DataTable table)
        {
            float sttWidth = Units.Centimeters * 2.0f;
            float minCol = Units.Centimeters * 2.0f;
            float maxCol = Units.Centimeters * 4.0f;
            float minMargin = Units.Centimeters * 1.0f;

            float pageWidth = Units.Millimeters * page.PaperWidth;
            float pageHeight = Units.Millimeters * page.PaperHeight;

            if (table.Columns.Count > 6)
            {
                page.Landscape = true;
                (pageWidth, pageHeight) = (pageHeight, pageWidth);
            }

            float leftMargin = Units.Millimeters * page.LeftMargin;
            float rightMargin = Units.Millimeters * page.RightMargin;
            float printableWidth = pageWidth - leftMargin - rightMargin;

            // Tính chiều dài theo tỷ lệ tên cột
            int maxLen = table.Columns.Cast<DataColumn>().Max(c => c.ColumnName.Length);
            List<float> columnWidths = new() { sttWidth }; // Cột STT là cột đầu tiên

            foreach (var col in table.Columns.Cast<DataColumn>())
            {
                float ratio = (float)col.ColumnName.Length / Math.Max(maxLen, 1);
                float colWidth = minCol + (maxCol - minCol) * ratio;
                columnWidths.Add(colWidth);
            }

            float rawWidth = columnWidths.Sum();

            // Scale nếu tổng > printable
            if (rawWidth > printableWidth - minMargin * 2)
            {
                float scale = (printableWidth - minMargin * 2) / rawWidth;
                for (int i = 0; i < columnWidths.Count; i++)
                    columnWidths[i] *= scale;

                rawWidth = columnWidths.Sum();
            }

            float leftOffset = leftMargin + (printableWidth - rawWidth) / 2; // Căn giữa

            return new TableLayoutInfo
            {
                ColumnWidths = columnWidths,
                TotalWidth = rawWidth,
                LeftOffset = leftOffset
            };
        }

        /// <summary>
        /// Hàm clone page header band từ một band gốc 
        /// </summary>
        /// <param name="source"></param>
        /// <returns></returns>
        PageHeaderBand ClonePageHeader(PageHeaderBand source)
        {
            var count = 0;
            var clone = new PageHeaderBand
            {
                Name = $"pageHeader_{source.Name}", // tránh trùng tên
                Height = source.Height,
                Top = source.Top,
                Width = source.Width
            };

            foreach (var obj in source.Objects)
            {
                if (obj is TextObject txt)
                {
                    var newText = new TextObject
                    {
                        Name = $"textObject_{source.Name}" + count++,
                        Bounds = txt.Bounds,
                        Text = txt.Text,
                        Font = txt.Font,
                        HorzAlign = txt.HorzAlign,
                        VertAlign = txt.VertAlign,
                        TextColor = txt.TextColor
                    };
                    clone.Objects.Add(newText);
                }
            }
            return clone;
        }
        #endregion

    }
}

