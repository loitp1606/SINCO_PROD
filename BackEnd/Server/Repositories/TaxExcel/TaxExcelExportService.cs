using OfficeOpenXml;
using reportSystem01.Shared;
using Sinco.Server.Repositories.Report;
using System.Text.Json;

namespace Sinco.Server.Repositories
{
    public class TaxExcelExportService : ITaxExcelExportService
    {
        private sealed class TaxExcelExportConfig
        {
            public string StoreProcedure { get; set; } = string.Empty;
            public string TemplateFile { get; set; } = string.Empty;
            public string FilePrefix { get; set; } = string.Empty;
            public bool UseStoreProcedure { get; set; } = true;
        }

        private sealed class TaxExportItem
        {
            public string IdGui { get; set; } = string.Empty;
            public string PeriodSuffix { get; set; } = string.Empty; // dạng: $yyyyMM
            public string? VoucherDateRaw { get; set; }
        }

        private static readonly Dictionary<string, TaxExcelExportConfig> TaxExcelExportConfigs =
            new(StringComparer.OrdinalIgnoreCase)
            {
                {
                    "deliverynote",
                    new TaxExcelExportConfig
                    {
                        StoreProcedure = "oot$exportVat",
                        TemplateFile = "XHD_Mau.xlsx",
                        FilePrefix = "deliverynote_tax"
                    }
                },
                {
                    "poin",
                    new TaxExcelExportConfig
                    {
                        StoreProcedure = "oot$exportVatPoin",
                        TemplateFile = "Mau_Phieunhapmua.xlsx",
                        FilePrefix = "poin_tax",
                        UseStoreProcedure = true
                    }
                },
                {
                    "receiptv2",
                    new TaxExcelExportConfig
                    {
                        StoreProcedure = "oot$exportVatReceiptV2",
                        TemplateFile = "Mau_Phieu_thu.xlsx",
                        FilePrefix = "receiptv2_tax",
                        UseStoreProcedure = true
                    }
                },
                {
                    "paymentslip",
                    new TaxExcelExportConfig
                    {
                        StoreProcedure = "oot$exportVatPaymentSlip",
                        TemplateFile = "Mau_Phieu_chi_tvt.xlsx",
                        FilePrefix = "paymentslip_tax",
                        UseStoreProcedure = true
                    }
                }
            };

        private readonly IDynamicReportService _dynamicReport;

        public TaxExcelExportService(IDynamicReportService dynamicReport)
        {
            _dynamicReport = dynamicReport;
        }

        public async Task<ServiceResponse<MemoryStream>> ExportTaxExcelAsync(ReportRequest request)
        {
            var response = new ServiceResponse<MemoryStream>();

            try
            {
                var controllerName = (request.Controll ?? string.Empty).Trim().ToLower();
                if (!TaxExcelExportConfigs.TryGetValue(controllerName, out var taxConfig))
                {
                    response.Success = false;
                    response.Message = $"Loại export 'excel-tax' chưa cấu hình cho controller '{controllerName}'.";
                    return response;
                }

                if (request.Tables == null || request.Tables.Count == 0)
                {
                    response.Success = false;
                    response.Message = "Không có dữ liệu để export mẫu PM Thuế.";
                    return response;
                }

                var exportItems = ExtractTaxExportItems(controllerName, request.Tables);
                if (exportItems.Count == 0)
                {
                    response.Success = false;
                    response.Message = $"Không xác định được dữ liệu '{controllerName}' để export.";
                    return response;
                }

                if (!taxConfig.UseStoreProcedure)
                {
                    response.Success = false;
                    response.Message = $"Controller '{controllerName}' chưa cấu hình xuất theo store.";
                    return response;
                }

                var listGuiId = string.Join(",", exportItems.Select(x => x.IdGui));
                var listVoucherDate = string.Join(",", exportItems.Select(x => x.VoucherDateRaw ?? string.Empty));
                var userID = request.UserID ?? string.Empty;
                var unit = request.Unit ?? string.Empty;
                var language = request.Language ?? "vi";

                var spQuery =
                    $"exec {taxConfig.StoreProcedure} N'{EscapeSqlLiteral(listGuiId)}', " +
                    $"N'{EscapeSqlLiteral(listVoucherDate)}', " +
                    $"N'{EscapeSqlLiteral(userID)}', " +
                    $"N'{EscapeSqlLiteral(unit)}', " +
                    $"N'{EscapeSqlLiteral(language)}'";
                var spRows = await _dynamicReport.ExecuteQueryAsync(spQuery);
                if (spRows == null || spRows.Count == 0)
                {
                    response.Success = false;
                    response.Message = $"Store {taxConfig.StoreProcedure} không trả về dữ liệu.";
                    return response;
                }

                if (controllerName == "poin")
                {
                    return ExportPoinTaxExcelFromStoreRows(taxConfig, spRows);
                }
                if (controllerName == "receiptv2")
                {
                    return ExportReceiptV2TaxExcelFromStoreRows(taxConfig, spRows);
                }
                if (controllerName == "paymentslip")
                {
                    return ExportPaymentSlipTaxExcelFromStoreRows(taxConfig, spRows);
                }

                ExcelPackage.License.SetNonCommercialPersonal("SaiGonSinco");
                var templatePath = Path.Combine("Controllers", "FastReport", "TaxTemplates", taxConfig.TemplateFile);
                using var package = File.Exists(templatePath)
                    ? new ExcelPackage(new FileInfo(templatePath))
                    : new ExcelPackage();

                var ws = package.Workbook.Worksheets.FirstOrDefault() ?? package.Workbook.Worksheets.Add("Sheet1");
                EnsureTaxHeader(ws);
                var headers = GetTaxHeaders();

                int rowIndex = 2;
                foreach (var row in spRows)
                {
                    for (int colIndex = 0; colIndex < headers.Length; colIndex++)
                    {
                        var header = headers[colIndex];
                        if (row.TryGetValue(header, out var value))
                        {
                            ws.Cells[rowIndex, colIndex + 1].Value = value;
                        }
                    }
                    rowIndex++;
                }

                var finalMs = new MemoryStream(package.GetAsByteArray());
                finalMs.Position = 0;

                response.Success = true;
                response.Data = finalMs;
                response.Message = $"{taxConfig.FilePrefix}_{DateTime.Now:yyyyMMddHHmmss}.xlsx";
                return response;
            }
            catch (Exception ex)
            {
                response.Success = false;
                response.Message = $"Lỗi export Excel PM Thuế: {ex.Message}";
                return response;
            }
        }

        private ServiceResponse<MemoryStream> ExportPoinTaxExcelFromStoreRows(
            TaxExcelExportConfig taxConfig,
            List<Dictionary<string, object>> spRows
        )
        {
            var response = new ServiceResponse<MemoryStream>();
            try
            {
                ExcelPackage.License.SetNonCommercialPersonal("SaiGonSinco");
                var templatePath = Path.Combine("Controllers", "FastReport", "TaxTemplates", taxConfig.TemplateFile);
                using var package = File.Exists(templatePath)
                    ? new ExcelPackage(new FileInfo(templatePath))
                    : new ExcelPackage();

                var wsCt = package.Workbook.Worksheets["CT"]
                           ?? package.Workbook.Worksheets.FirstOrDefault()
                           ?? package.Workbook.Worksheets.Add("CT");
                var wsPh = package.Workbook.Worksheets["PH"]
                           ?? package.Workbook.Worksheets.Skip(1).FirstOrDefault()
                           ?? package.Workbook.Worksheets.Add("PH");

                int rowPh = 2;
                int rowCt = 2;
                var grouped = spRows
                    .GroupBy(r => GetStringAny(r, "idGui", "IdGui"), StringComparer.OrdinalIgnoreCase)
                    .ToList();

                foreach (var group in grouped)
                {
                    var master = group.FirstOrDefault();
                    if (master == null) continue;

                    var voucherDate = GetDateStringAny(master, "voucherDate");
                    var voucherNumber = GetStringAny(master, "voucherNumber");
                    var vendorCode = GetStringAny(master, "vendorCode");
                    var vendorName = GetStringAny(master, "vendorName");
                    var vendorAddress = GetStringAny(master, "vendorAddress");
                    var note = GetStringAny(master, "note");
                    var paymentMethod = GetStringAny(master, "paymentMethod");
                    var invoiceForm = GetStringAny(master, "invoiceForm");
                    var invoiceSerial = GetStringAny(master, "invoiceSerial");
                    var invoiceDate = GetDateStringAny(master, "invoiceDate");
                    var invoiceNumber = GetStringAny(master, "invoiceNumber");
                    var taxCode = GetStringAny(master, "taxCode");

                    var totalAmount = GetDecimalAny(master, "totalAmount", "total_amount", "total_payment", "totalAmountMaster");
                    var totalTax = GetDecimalAny(master, "totalTax", "total_tax", "taxAmountMaster");
                    var taxRate = GetDecimalAny(master, "taxRate", "tax_rate", "taxPercent");
                    if (taxRate == 0m)
                    {
                        taxRate = group
                            .Select(d => GetDecimalAny(d, "taxRate", "tax_rate", "taxPercent"))
                            .FirstOrDefault(v => v != 0m);
                    }

                    wsPh.Cells[rowPh, 1].Value = voucherDate;
                    wsPh.Cells[rowPh, 2].Value = voucherNumber;
                    wsPh.Cells[rowPh, 3].Value = vendorCode;
                    wsPh.Cells[rowPh, 4].Value = string.Empty;
                    wsPh.Cells[rowPh, 5].Value = note;
                    wsPh.Cells[rowPh, 6].Value = totalAmount;
                    wsPh.Cells[rowPh, 7].Value = taxRate;
                    wsPh.Cells[rowPh, 8].Value = totalTax;
                    wsPh.Cells[rowPh, 9].Value = paymentMethod;
                    wsPh.Cells[rowPh, 10].Value = 1;
                    wsPh.Cells[rowPh, 11].Value = invoiceForm;
                    wsPh.Cells[rowPh, 12].Value = invoiceSerial;
                    wsPh.Cells[rowPh, 13].Value = invoiceDate;
                    wsPh.Cells[rowPh, 14].Value = invoiceNumber;
                    wsPh.Cells[rowPh, 15].Value = vendorCode;
                    wsPh.Cells[rowPh, 16].Value = vendorName;
                    wsPh.Cells[rowPh, 17].Value = vendorAddress;
                    wsPh.Cells[rowPh, 18].Value = taxCode;
                    rowPh++;

                    foreach (var detail in group.OrderBy(d => GetDecimalAny(d, "line_nbr", "lineNbr", "soTT")))
                    {
                        wsCt.Cells[rowCt, 1].Value = voucherNumber;
                        wsCt.Cells[rowCt, 2].Value = GetStringAny(detail, "itemCode", "item_id");
                        wsCt.Cells[rowCt, 3].Value = GetStringAny(detail, "itemName", "itemNameVAT", "item_name");
                        wsCt.Cells[rowCt, 4].Value = GetDecimalAny(detail, "quantity");
                        wsCt.Cells[rowCt, 5].Value = GetDecimalAny(detail, "price", "unitPrice");
                        wsCt.Cells[rowCt, 6].Value = GetDecimalAny(detail, "amount", "lineAmount");
                        wsCt.Cells[rowCt, 7].Value = GetStringAny(detail, "warehouseCode", "locationCode", "warehouse");
                        rowCt++;
                    }
                }

                var finalMs = new MemoryStream(package.GetAsByteArray());
                finalMs.Position = 0;

                response.Success = true;
                response.Data = finalMs;
                response.Message = $"{taxConfig.FilePrefix}_{DateTime.Now:yyyyMMddHHmmss}.xlsx";
                return response;
            }
            catch (Exception ex)
            {
                response.Success = false;
                response.Message = $"Lỗi export Excel PM Thuế (poin): {ex.Message}";
                return response;
            }
        }

        private ServiceResponse<MemoryStream> ExportReceiptV2TaxExcelFromStoreRows(
            TaxExcelExportConfig taxConfig,
            List<Dictionary<string, object>> spRows
        )
        {
            var response = new ServiceResponse<MemoryStream>();
            try
            {
                ExcelPackage.License.SetNonCommercialPersonal("SaiGonSinco");
                var templatePath = Path.Combine("Controllers", "FastReport", "TaxTemplates", taxConfig.TemplateFile);
                using var package = File.Exists(templatePath)
                    ? new ExcelPackage(new FileInfo(templatePath))
                    : new ExcelPackage();

                var wsCt = package.Workbook.Worksheets["CT"]
                           ?? package.Workbook.Worksheets.FirstOrDefault()
                           ?? package.Workbook.Worksheets.Add("CT");

                int rowCt = 2;
                foreach (var row in spRows.OrderBy(d => GetStringAny(d, "idGui")).ThenBy(d => GetDecimalAny(d, "line_nbr")))
                {
                    wsCt.Cells[rowCt, 1].Value = GetDateStringAny(row, "voucherDate"); // Ngày CT
                    wsCt.Cells[rowCt, 2].Value = GetStringAny(row, "voucherNumber"); // Số phiếu Thu
                    wsCt.Cells[rowCt, 3].Value = GetStringAny(row, "customerCode"); // Mã khách
                    wsCt.Cells[rowCt, 4].Value = GetStringAny(row, "collectorName"); // Người nhận
                    wsCt.Cells[rowCt, 5].Value = GetStringAny(row, "reason"); // Diễn giải phiếu
                    wsCt.Cells[rowCt, 6].Value = GetStringAny(row, "detailNote", "note"); // Diễn giải chi tiết phiếu
                    wsCt.Cells[rowCt, 7].Value = GetStringAny(row, "cashAccount"); // TK Tiền mặt
                    wsCt.Cells[rowCt, 8].Value = GetStringAny(row, "offsetAccount"); // TK đối ứng
                    wsCt.Cells[rowCt, 9].Value = GetDecimalAny(row, "amountVnd", "amount"); // Tiền VND
                    wsCt.Cells[rowCt, 10].Value = GetDecimalAny(row, "amountCur"); // Tiền NT
                    wsCt.Cells[rowCt, 11].Value = GetDecimalAny(row, "exchangeRate"); // Tỷ giá
                    wsCt.Cells[rowCt, 12].Value = GetStringAny(row, "costCode"); // Mã vụ việc
                    wsCt.Cells[rowCt, 13].Value = GetStringAny(row, "unitCode"); // Mã đơn vị cơ sở
                    wsCt.Cells[rowCt, 14].Value = GetStringAny(row, "currencyCode"); // Mã ngoại tệ
                    rowCt++;
                }

                var finalMs = new MemoryStream(package.GetAsByteArray());
                finalMs.Position = 0;

                response.Success = true;
                response.Data = finalMs;
                response.Message = $"{taxConfig.FilePrefix}_{DateTime.Now:yyyyMMddHHmmss}.xlsx";
                return response;
            }
            catch (Exception ex)
            {
                response.Success = false;
                response.Message = $"Lỗi export Excel PM Thuế (receiptv2): {ex.Message}";
                return response;
            }
        }

        private ServiceResponse<MemoryStream> ExportPaymentSlipTaxExcelFromStoreRows(
            TaxExcelExportConfig taxConfig,
            List<Dictionary<string, object>> spRows
        )
        {
            var response = new ServiceResponse<MemoryStream>();
            try
            {
                ExcelPackage.License.SetNonCommercialPersonal("SaiGonSinco");
                var templatePath = Path.Combine("Controllers", "FastReport", "TaxTemplates", taxConfig.TemplateFile);
                using var package = File.Exists(templatePath)
                    ? new ExcelPackage(new FileInfo(templatePath))
                    : new ExcelPackage();

                var wsCt = package.Workbook.Worksheets["CT"]
                           ?? package.Workbook.Worksheets.FirstOrDefault()
                           ?? package.Workbook.Worksheets.Add("CT");

                int rowCt = 2;
                foreach (var row in spRows.OrderBy(d => GetStringAny(d, "idGui")).ThenBy(d => GetDecimalAny(d, "line_nbr")))
                {
                    // Chỉ đổ cột đỏ theo yêu cầu mẫu PM Thuế; cột đen để trống.
                    wsCt.Cells[rowCt, 1].Value = GetDateStringAny(row, "voucherDate"); // Ngày CT (đỏ)
                    wsCt.Cells[rowCt, 2].Value = string.Empty; // Số phiếu chi (đen)
                    wsCt.Cells[rowCt, 3].Value = GetStringAny(row, "supplierCode"); // Mã khách (đỏ)
                    wsCt.Cells[rowCt, 4].Value = string.Empty; // Người nhận (đen)
                    wsCt.Cells[rowCt, 5].Value = GetStringAny(row, "reason"); // Diễn giải phiếu (đỏ)
                    wsCt.Cells[rowCt, 6].Value = GetStringAny(row, "detailNote", "note"); // Diễn giải chi tiết phiếu (đỏ)
                    wsCt.Cells[rowCt, 7].Value = string.Empty; // TK Tiền mặt (đen)
                    wsCt.Cells[rowCt, 8].Value = string.Empty; // TK đối ứng (đen)
                    wsCt.Cells[rowCt, 9].Value = GetDecimalAny(row, "amountVnd", "amount"); // Tiền VND (đỏ)
                    wsCt.Cells[rowCt, 10].Value = string.Empty; // Mã vụ việc (đen)
                    wsCt.Cells[rowCt, 11].Value = string.Empty; // Mã đơn vị cơ sở (đen)
                    wsCt.Cells[rowCt, 12].Value = string.Empty; // Kèm theo HĐ (đen)
                    wsCt.Cells[rowCt, 13].Value = string.Empty; // TK Thuế GTGT (đen)
                    wsCt.Cells[rowCt, 14].Value = GetStringAny(row, "invoiceSerial"); // Số seri (đỏ)
                    wsCt.Cells[rowCt, 15].Value = GetStringAny(row, "invoiceNumber"); // Số HĐ (đỏ)
                    wsCt.Cells[rowCt, 16].Value = GetDateStringAny(row, "invoiceDate"); // Ngày HĐ (đỏ)
                    wsCt.Cells[rowCt, 17].Value = GetStringAny(row, "maKhVat", "supplierCode"); // Mã KH VAT (đỏ)
                    wsCt.Cells[rowCt, 18].Value = GetStringAny(row, "supplierName"); // Tên (đỏ)
                    wsCt.Cells[rowCt, 19].Value = GetStringAny(row, "supplierAddress"); // Địa chỉ (đỏ)
                    wsCt.Cells[rowCt, 20].Value = GetStringAny(row, "taxCode"); // MST (đỏ)
                    wsCt.Cells[rowCt, 21].Value = GetDecimalAny(row, "tienVndVat", "amountVnd"); // Tiền VND (đỏ)
                    wsCt.Cells[rowCt, 22].Value = GetDecimalAny(row, "taxRate", "tax_rate"); // Thuế suất (đỏ)
                    wsCt.Cells[rowCt, 23].Value = GetDecimalAny(row, "taxAmount", "tax"); // Thuế (đỏ)
                    rowCt++;
                }

                var finalMs = new MemoryStream(package.GetAsByteArray());
                finalMs.Position = 0;

                response.Success = true;
                response.Data = finalMs;
                response.Message = $"{taxConfig.FilePrefix}_{DateTime.Now:yyyyMMddHHmmss}.xlsx";
                return response;
            }
            catch (Exception ex)
            {
                response.Success = false;
                response.Message = $"Lỗi export Excel PM Thuế (paymentslip): {ex.Message}";
                return response;
            }
        }

        private List<TaxExportItem> ExtractTaxExportItems(
            string controllerName,
            Dictionary<string, object> tables
        )
        {
            return controllerName switch
            {
                "deliverynote" => ExtractVoucherExportItems(tables, "deliverynote"),
                "poin" => ExtractVoucherExportItems(tables, "poin"),
                "receiptv2" => ExtractVoucherExportItems(tables, "receiptv2"),
                "paymentslip" => ExtractVoucherExportItems(tables, "paymentslip"),
                _ => new List<TaxExportItem>()
            };
        }

        private static List<TaxExportItem> ExtractVoucherExportItems(
            Dictionary<string, object> tables,
            string tablePrefix
        )
        {
            var items = new List<TaxExportItem>();

            foreach (var kv in tables)
            {
                var key = (kv.Key ?? string.Empty).ToLower();
                if (!key.StartsWith(tablePrefix)) continue;

                var value = kv.Value;
                if (value == null) continue;

                if (value is JsonElement element)
                {
                    if (element.ValueKind == JsonValueKind.String)
                    {
                        var text = element.GetString();
                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            items.Add(new TaxExportItem
                            {
                                IdGui = text,
                                PeriodSuffix = ExtractPeriodSuffixFromTableKey(key)
                            });
                        }
                    }
                    else if (element.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in element.EnumerateArray())
                        {
                            if (item.ValueKind != JsonValueKind.Object) continue;
                            if (!item.TryGetProperty("idGui", out var idProp)) continue;

                            var text = idProp.GetString();
                            if (string.IsNullOrWhiteSpace(text)) continue;

                            var suffix = GetVoucherPeriodSuffix(item);
                            if (string.IsNullOrWhiteSpace(suffix))
                            {
                                suffix = ExtractPeriodSuffixFromTableKey(key);
                            }

                            items.Add(new TaxExportItem
                            {
                                IdGui = text,
                                PeriodSuffix = suffix,
                                VoucherDateRaw = item.TryGetProperty("voucherDate", out var vcDate) ? vcDate.ToString() : null
                            });
                        }
                    }
                    continue;
                }

                var raw = value.ToString();
                if (!string.IsNullOrWhiteSpace(raw) && !raw.TrimStart().StartsWith("["))
                {
                    items.Add(new TaxExportItem
                    {
                        IdGui = raw,
                        PeriodSuffix = ExtractPeriodSuffixFromTableKey(key)
                    });
                }
            }

            return items
                .Where(v => !string.IsNullOrWhiteSpace(v.IdGui))
                .GroupBy(v => v.IdGui, StringComparer.OrdinalIgnoreCase)
                .Select(g =>
                {
                    var firstWithPeriod = g.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x.PeriodSuffix));
                    return firstWithPeriod ?? g.First();
                })
                .ToList();
        }

        private static string ExtractPeriodSuffixFromTableKey(string key)
        {
            if (string.IsNullOrWhiteSpace(key)) return string.Empty;

            var parts = key.Split('$', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) return string.Empty;

            var period = parts[1];
            return period.Length == 6 && period.All(char.IsDigit)
                ? "$" + period
                : string.Empty;
        }

        private static string GetVoucherPeriodSuffix(JsonElement item)
        {
            if (item.ValueKind != JsonValueKind.Object) return string.Empty;

            if (item.TryGetProperty("voucherDate", out var voucherDate)
                && voucherDate.ValueKind == JsonValueKind.String)
            {
                var raw = voucherDate.GetString();
                if (!string.IsNullOrWhiteSpace(raw) && DateTime.TryParse(raw, out var dt))
                {
                    return "$" + dt.ToString("yyyyMM");
                }
            }

            return string.Empty;
        }

        private static string EscapeSqlLiteral(string input)
        {
            return (input ?? string.Empty).Replace("'", "''");
        }

        private static string[] GetTaxHeaders()
        {
            return
            [
                "MaHD","NgayHoaDon","MaKhachHang","TenNguoiMua","TenDonVi","MaSoThue","DiaChiKhachHang","SoDienThoai",
                "SoBangKe","NgayBangKe","SOTKKHACH","TENNHKHACH","HinhThucThanhToan","ThueSuat","ThueSuatKhac","MaHang",
                "TenHangHoa","DVT","SoLuong","DonGia","ThanhTien","TienTe","SoTT","TinhChat","Email","Ghichu"
            ];
        }

        private static void EnsureTaxHeader(ExcelWorksheet ws)
        {
            if (ws.Cells[1, 1].Value != null) return;

            var headers = GetTaxHeaders();
            for (int i = 0; i < headers.Length; i++)
            {
                ws.Cells[1, i + 1].Value = headers[i];
            }
        }

        private static string GetStringAny(Dictionary<string, object> row, params string[] keys)
        {
            foreach (var key in keys)
            {
                var value = GetValue(row, key);
                if (value != null && value != DBNull.Value)
                {
                    var text = value.ToString();
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        return text;
                    }
                }
            }

            return string.Empty;
        }

        private static decimal GetDecimalAny(Dictionary<string, object> row, params string[] keys)
        {
            foreach (var key in keys)
            {
                var value = GetValue(row, key);
                if (value == null || value == DBNull.Value) continue;
                if (decimal.TryParse(value.ToString(), out var result))
                {
                    return result;
                }
            }

            return 0m;
        }

        private static string GetDateStringAny(Dictionary<string, object> row, params string[] keys)
        {
            foreach (var key in keys)
            {
                var value = GetValue(row, key);
                if (value == null || value == DBNull.Value) continue;

                if (value is DateTime dt)
                {
                    return dt.ToString("dd/MM/yyyy");
                }

                if (DateTime.TryParse(value.ToString(), out var parsed))
                {
                    return parsed.ToString("dd/MM/yyyy");
                }

                var raw = value.ToString();
                if (!string.IsNullOrWhiteSpace(raw))
                {
                    return raw;
                }
            }

            return string.Empty;
        }

        private static object? GetValue(Dictionary<string, object> row, string key)
        {
            foreach (var kv in row)
            {
                if (kv.Key.Equals(key, StringComparison.OrdinalIgnoreCase))
                {
                    return kv.Value;
                }
            }

            return null;
        }
    }
}
