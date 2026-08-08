using OfficeOpenXml;
using reportSystem01.Shared;
using Sinco.Server.Repositories.Report;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Sinco.Server.Repositories
{
    public class TaxExcelExportService : ITaxExcelExportService
    {
        private const string ConfigDirectory = "Controllers/FastReport/TaxExportConfigs";
        private const string TemplateDirectory = "Controllers/FastReport/TaxTemplates";
        private const string DefaultDateFormat = "dd/MM/yyyy";

        private sealed class TaxExcelExportConfig
        {
            public string Code { get; set; } = string.Empty;
            public string Controller { get; set; } = string.Empty;
            public string StoreProcedure { get; set; } = string.Empty;
            public string TemplateFile { get; set; } = string.Empty;
            public string FilePrefix { get; set; } = string.Empty;
            public string GroupBy { get; set; } = string.Empty;
            public List<TaxExcelSheetConfig> Sheets { get; set; } = [];
        }

        private sealed class TaxExcelSheetConfig
        {
            public string Name { get; set; } = string.Empty;
            public int StartRow { get; set; } = 2;
            public int HeaderRow { get; set; }
            public string RowMode { get; set; } = "allRows";
            public List<string> OrderBy { get; set; } = [];
            public List<TaxExcelColumnConfig> Columns { get; set; } = [];
        }

        private sealed class TaxExcelColumnConfig
        {
            public string Column { get; set; } = string.Empty;
            public string Header { get; set; } = string.Empty;
            public List<string> Sources { get; set; } = [];
            public JsonElement? Value { get; set; }
            public string Type { get; set; } = "string";
            public string Format { get; set; } = string.Empty;
            public string ValueMode { get; set; } = string.Empty;
        }

        private sealed class TaxExportItem
        {
            public string IdGui { get; set; } = string.Empty;
            public string? VoucherDateRaw { get; set; }
        }

        private sealed class RowContext
        {
            public Dictionary<string, object> Row { get; init; } = new(StringComparer.OrdinalIgnoreCase);
            public List<Dictionary<string, object>> GroupRows { get; init; } = [];
        }

        private readonly IDynamicReportService _dynamicReport;
        private readonly IWebHostEnvironment _environment;
        private readonly JsonSerializerOptions _jsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public TaxExcelExportService(
            IDynamicReportService dynamicReport,
            IWebHostEnvironment environment
        )
        {
            _dynamicReport = dynamicReport;
            _environment = environment;
        }

        public async Task<ServiceResponse<MemoryStream>> ExportTaxExcelAsync(ReportRequest request)
        {
            var response = new ServiceResponse<MemoryStream>();

            try
            {
                var controllerName = NormalizeKey(request.Controll);
                var configCode = NormalizeKey(request.TaxExcelExportConfig);
                if (string.IsNullOrWhiteSpace(configCode))
                {
                    configCode = controllerName;
                }

                var config = LoadConfig(configCode);
                ValidateConfig(config, configCode, controllerName);

                if (request.Tables == null || request.Tables.Count == 0)
                {
                    return Failure("Không có dữ liệu để export mẫu PM Thuế.");
                }

                var exportItems = ExtractTaxExportItems(controllerName, request.Tables);
                if (exportItems.Count == 0)
                {
                    return Failure($"Không xác định được dữ liệu '{controllerName}' để export.");
                }

                var listGuiId = string.Join(",", exportItems.Select(x => x.IdGui));
                var listVoucherDate = string.Join(",", exportItems.Select(x => x.VoucherDateRaw ?? string.Empty));
                var spQuery =
                    $"exec {config.StoreProcedure} N'{EscapeSqlLiteral(listGuiId)}', " +
                    $"N'{EscapeSqlLiteral(listVoucherDate)}', " +
                    $"N'{EscapeSqlLiteral(request.UserID ?? string.Empty)}', " +
                    $"N'{EscapeSqlLiteral(request.Unit ?? string.Empty)}', " +
                    $"N'{EscapeSqlLiteral(request.Language ?? "vi")}'";

                var spRows = await _dynamicReport.ExecuteQueryAsync(spQuery);
                if (spRows == null || spRows.Count == 0)
                {
                    return Failure($"Store {config.StoreProcedure} không trả về dữ liệu.");
                }

                return ExportFromConfig(config, spRows);
            }
            catch (Exception ex)
            {
                return Failure($"Lỗi export Excel PM Thuế: {ex.Message}");
            }
        }

        private TaxExcelExportConfig LoadConfig(string configCode)
        {
            if (string.IsNullOrWhiteSpace(configCode)
                || !Regex.IsMatch(configCode, "^[a-z0-9_-]+$", RegexOptions.IgnoreCase))
            {
                throw new InvalidOperationException($"Mã cấu hình export '{configCode}' không hợp lệ.");
            }

            var configPath = Path.Combine(
                _environment.ContentRootPath,
                ConfigDirectory.Replace('/', Path.DirectorySeparatorChar),
                $"{configCode}.json"
            );

            if (!File.Exists(configPath))
            {
                throw new FileNotFoundException(
                    $"Chưa khai báo cấu hình Excel PM Thuế '{configCode}'.",
                    configPath
                );
            }

            var config = JsonSerializer.Deserialize<TaxExcelExportConfig>(
                File.ReadAllText(configPath),
                _jsonOptions
            );

            return config
                ?? throw new InvalidOperationException($"Không đọc được cấu hình '{configCode}'.");
        }

        private static void ValidateConfig(
            TaxExcelExportConfig config,
            string configCode,
            string controllerName
        )
        {
            if (!config.Code.Equals(configCode, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"Mã trong cấu hình '{config.Code}' không khớp file '{configCode}'."
                );
            }

            if (!config.Controller.Equals(controllerName, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"Cấu hình '{configCode}' không áp dụng cho controller '{controllerName}'."
                );
            }

            if (string.IsNullOrWhiteSpace(config.StoreProcedure)
                || !Regex.IsMatch(config.StoreProcedure, @"^[a-z0-9_$.\[\]]+$", RegexOptions.IgnoreCase))
            {
                throw new InvalidOperationException(
                    $"Store procedure trong cấu hình '{configCode}' không hợp lệ."
                );
            }

            if (string.IsNullOrWhiteSpace(config.TemplateFile)
                || !Path.GetFileName(config.TemplateFile).Equals(
                    config.TemplateFile,
                    StringComparison.Ordinal
                ))
            {
                throw new InvalidOperationException(
                    $"Tên template trong cấu hình '{configCode}' không hợp lệ."
                );
            }

            if (config.Sheets.Count == 0)
            {
                throw new InvalidOperationException(
                    $"Cấu hình '{configCode}' chưa khai báo sheet."
                );
            }

            foreach (var sheet in config.Sheets)
            {
                if (sheet.StartRow < 1)
                {
                    throw new InvalidOperationException(
                        $"Sheet '{sheet.Name}' có startRow không hợp lệ."
                    );
                }

                if (!sheet.RowMode.Equals("allRows", StringComparison.OrdinalIgnoreCase)
                    && !sheet.RowMode.Equals("firstOfGroup", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        $"Sheet '{sheet.Name}' có rowMode '{sheet.RowMode}' không được hỗ trợ."
                    );
                }

                foreach (var column in sheet.Columns)
                {
                    ParseColumnNumber(column.Column);
                    var type = column.Type.ToLowerInvariant();
                    if (type is not ("string" or "decimal" or "date" or "integer"))
                    {
                        throw new InvalidOperationException(
                            $"Sheet '{sheet.Name}', cột '{column.Column}' có type '{column.Type}' không hợp lệ."
                        );
                    }

                    if (!column.Value.HasValue && column.Sources.Count == 0)
                    {
                        throw new InvalidOperationException(
                            $"Sheet '{sheet.Name}', cột '{column.Column}' chưa khai source hoặc value."
                        );
                    }
                }
            }
        }

        private ServiceResponse<MemoryStream> ExportFromConfig(
            TaxExcelExportConfig config,
            List<Dictionary<string, object>> spRows
        )
        {
            ExcelPackage.License.SetNonCommercialPersonal("SaiGonSinco");

            var templatePath = Path.Combine(
                _environment.ContentRootPath,
                TemplateDirectory.Replace('/', Path.DirectorySeparatorChar),
                config.TemplateFile
            );

            using var package = File.Exists(templatePath)
                ? new ExcelPackage(new FileInfo(templatePath))
                : new ExcelPackage();

            foreach (var sheetConfig in config.Sheets)
            {
                var worksheet = ResolveWorksheet(package, sheetConfig.Name);
                WriteHeaders(worksheet, sheetConfig);

                var contexts = BuildRowContexts(config, sheetConfig, spRows);
                SortRows(contexts, sheetConfig.OrderBy);

                var rowNumber = sheetConfig.StartRow;
                foreach (var context in contexts)
                {
                    foreach (var columnConfig in sheetConfig.Columns)
                    {
                        var columnNumber = ParseColumnNumber(columnConfig.Column);
                        var cell = worksheet.Cells[rowNumber, columnNumber];
                        cell.Value = ResolveColumnValue(columnConfig, context);
                        if (!string.IsNullOrWhiteSpace(columnConfig.Format))
                        {
                            cell.Style.Numberformat.Format = columnConfig.Format;
                        }
                    }

                    rowNumber++;
                }
            }

            var stream = new MemoryStream(package.GetAsByteArray());
            stream.Position = 0;
            return new ServiceResponse<MemoryStream>
            {
                Success = true,
                Data = stream,
                Message = $"{config.FilePrefix}_{DateTime.Now:yyyyMMddHHmmss}.xlsx"
            };
        }

        private static ExcelWorksheet ResolveWorksheet(ExcelPackage package, string sheetName)
        {
            if (!string.IsNullOrWhiteSpace(sheetName))
            {
                return package.Workbook.Worksheets[sheetName]
                    ?? package.Workbook.Worksheets.Add(sheetName);
            }

            return package.Workbook.Worksheets.FirstOrDefault()
                ?? package.Workbook.Worksheets.Add("Sheet1");
        }

        private static void WriteHeaders(
            ExcelWorksheet worksheet,
            TaxExcelSheetConfig sheetConfig
        )
        {
            if (sheetConfig.HeaderRow < 1) return;

            foreach (var column in sheetConfig.Columns.Where(c => !string.IsNullOrWhiteSpace(c.Header)))
            {
                var cell = worksheet.Cells[
                    sheetConfig.HeaderRow,
                    ParseColumnNumber(column.Column)
                ];
                if (cell.Value == null)
                {
                    cell.Value = column.Header;
                }
            }
        }

        private static List<RowContext> BuildRowContexts(
            TaxExcelExportConfig config,
            TaxExcelSheetConfig sheet,
            List<Dictionary<string, object>> rows
        )
        {
            if (string.IsNullOrWhiteSpace(config.GroupBy))
            {
                return rows
                    .Select(row => new RowContext { Row = row, GroupRows = [row] })
                    .ToList();
            }

            var groups = rows
                .GroupBy(
                    row => GetString(row, config.GroupBy),
                    StringComparer.OrdinalIgnoreCase
                )
                .Select(group => group.ToList())
                .ToList();

            if (sheet.RowMode.Equals("firstOfGroup", StringComparison.OrdinalIgnoreCase))
            {
                return groups
                    .Where(group => group.Count > 0)
                    .Select(group => new RowContext
                    {
                        Row = group[0],
                        GroupRows = group
                    })
                    .ToList();
            }

            return groups
                .SelectMany(group => group.Select(row => new RowContext
                {
                    Row = row,
                    GroupRows = group
                }))
                .ToList();
        }

        private static void SortRows(List<RowContext> contexts, List<string> orderBy)
        {
            if (orderBy.Count == 0) return;

            contexts.Sort((left, right) =>
            {
                foreach (var key in orderBy)
                {
                    var comparison = CompareValues(
                        GetValue(left.Row, key),
                        GetValue(right.Row, key)
                    );
                    if (comparison != 0) return comparison;
                }

                return 0;
            });
        }

        private static int CompareValues(object? left, object? right)
        {
            if (left == null || left == DBNull.Value)
            {
                return right == null || right == DBNull.Value ? 0 : -1;
            }
            if (right == null || right == DBNull.Value) return 1;

            if (decimal.TryParse(left.ToString(), out var leftNumber)
                && decimal.TryParse(right.ToString(), out var rightNumber))
            {
                return leftNumber.CompareTo(rightNumber);
            }

            if (DateTime.TryParse(left.ToString(), out var leftDate)
                && DateTime.TryParse(right.ToString(), out var rightDate))
            {
                return leftDate.CompareTo(rightDate);
            }

            return string.Compare(
                left.ToString(),
                right.ToString(),
                StringComparison.OrdinalIgnoreCase
            );
        }

        private static object ResolveColumnValue(
            TaxExcelColumnConfig column,
            RowContext context
        )
        {
            if (column.Value.HasValue)
            {
                return ConvertJsonValue(column.Value.Value);
            }

            if (column.ValueMode.Equals("firstNonZeroInGroup", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var row in context.GroupRows)
                {
                    var groupValue = ResolveFromSources(column, row);
                    if (TryConvertDecimal(groupValue, out var number) && number != 0m)
                    {
                        return number;
                    }
                }

                return 0m;
            }

            return ConvertByType(
                ResolveFromSources(column, context.Row),
                column.Type,
                column.Format
            );
        }

        private static object? ResolveFromSources(
            TaxExcelColumnConfig column,
            Dictionary<string, object> row
        )
        {
            foreach (var source in column.Sources)
            {
                var value = GetValue(row, source);
                if (value == null || value == DBNull.Value) continue;

                if (column.Type.Equals("string", StringComparison.OrdinalIgnoreCase)
                    && string.IsNullOrWhiteSpace(value.ToString()))
                {
                    continue;
                }

                if (column.Type.Equals("decimal", StringComparison.OrdinalIgnoreCase)
                    || column.Type.Equals("integer", StringComparison.OrdinalIgnoreCase))
                {
                    if (TryConvertDecimal(value, out _)) return value;
                    continue;
                }

                return value;
            }

            return null;
        }

        private static object ConvertByType(object? value, string type, string format)
        {
            if (value == null || value == DBNull.Value)
            {
                return type.Equals("decimal", StringComparison.OrdinalIgnoreCase)
                    || type.Equals("integer", StringComparison.OrdinalIgnoreCase)
                        ? 0m
                        : string.Empty;
            }

            switch (type.ToLowerInvariant())
            {
                case "decimal":
                    return TryConvertDecimal(value, out var number) ? number : 0m;
                case "integer":
                    return TryConvertDecimal(value, out var integer)
                        ? decimal.Truncate(integer)
                        : 0m;
                case "date":
                    return FormatDateValue(value, format);
                default:
                    return value.ToString() ?? string.Empty;
            }
        }

        private static string FormatDateValue(object value, string format)
        {
            var outputFormat = string.IsNullOrWhiteSpace(format)
                ? DefaultDateFormat
                : format;

            if (value is DateTime dateTime)
            {
                return dateTime.ToString(outputFormat, CultureInfo.InvariantCulture);
            }

            var raw = value.ToString()?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(raw)) return string.Empty;

            string[] acceptedFormats =
            [
                "dd/MM/yyyy",
                "d/M/yyyy",
                "yyyy-MM-dd",
                "yyyy-MM-dd HH:mm:ss",
                "yyyy-MM-ddTHH:mm:ss",
                "yyyy-MM-ddTHH:mm:ss.FFFFFFFK"
            ];

            if (DateTime.TryParseExact(
                    raw,
                    acceptedFormats,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AllowWhiteSpaces,
                    out var parsedDate)
                || DateTime.TryParse(
                    raw,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AllowWhiteSpaces,
                    out parsedDate))
            {
                return parsedDate.ToString(outputFormat, CultureInfo.InvariantCulture);
            }

            return raw;
        }

        private static bool TryConvertDecimal(object? value, out decimal number)
        {
            if (value is decimal decimalValue)
            {
                number = decimalValue;
                return true;
            }

            return decimal.TryParse(
                value?.ToString(),
                NumberStyles.Any,
                CultureInfo.InvariantCulture,
                out number
            ) || decimal.TryParse(value?.ToString(), out number);
        }

        private static object ConvertJsonValue(JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString() ?? string.Empty,
                JsonValueKind.Number when element.TryGetInt64(out var integer) => integer,
                JsonValueKind.Number when element.TryGetDecimal(out var number) => number,
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Null => string.Empty,
                _ => element.ToString()
            };
        }

        private static int ParseColumnNumber(string column)
        {
            if (string.IsNullOrWhiteSpace(column))
            {
                throw new InvalidOperationException("Tên cột Excel không được để trống.");
            }

            var result = 0;
            foreach (var character in column.Trim().ToUpperInvariant())
            {
                if (character < 'A' || character > 'Z')
                {
                    throw new InvalidOperationException($"Cột Excel '{column}' không hợp lệ.");
                }

                result = checked(result * 26 + character - 'A' + 1);
            }

            return result;
        }

        private static List<TaxExportItem> ExtractTaxExportItems(
            string controllerName,
            Dictionary<string, object> tables
        )
        {
            var items = new List<TaxExportItem>();
            foreach (var table in tables)
            {
                if (!table.Key.StartsWith(controllerName, StringComparison.OrdinalIgnoreCase)
                    || table.Value == null)
                {
                    continue;
                }

                if (table.Value is JsonElement element)
                {
                    ExtractItemsFromJsonElement(element, items);
                    continue;
                }

                var raw = table.Value.ToString();
                if (!string.IsNullOrWhiteSpace(raw) && !raw.TrimStart().StartsWith("["))
                {
                    items.Add(new TaxExportItem { IdGui = raw });
                }
            }

            return items
                .Where(item => !string.IsNullOrWhiteSpace(item.IdGui))
                .GroupBy(item => item.IdGui, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToList();
        }

        private static void ExtractItemsFromJsonElement(
            JsonElement element,
            List<TaxExportItem> items
        )
        {
            if (element.ValueKind == JsonValueKind.String)
            {
                var id = element.GetString();
                if (!string.IsNullOrWhiteSpace(id))
                {
                    items.Add(new TaxExportItem { IdGui = id });
                }
                return;
            }

            if (element.ValueKind != JsonValueKind.Array) return;
            foreach (var row in element.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object) continue;
                var id = GetJsonProperty(row, "idGui")?.ToString();
                if (string.IsNullOrWhiteSpace(id)) continue;

                items.Add(new TaxExportItem
                {
                    IdGui = id,
                    VoucherDateRaw = GetJsonProperty(row, "voucherDate")?.ToString()
                });
            }
        }

        private static JsonElement? GetJsonProperty(JsonElement element, string propertyName)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name.Equals(propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    return property.Value;
                }
            }

            return null;
        }

        private static string GetString(Dictionary<string, object> row, string key)
        {
            var value = GetValue(row, key);
            return value == null || value == DBNull.Value
                ? string.Empty
                : value.ToString() ?? string.Empty;
        }

        private static object? GetValue(Dictionary<string, object> row, string key)
        {
            foreach (var item in row)
            {
                if (item.Key.Equals(key, StringComparison.OrdinalIgnoreCase))
                {
                    return item.Value;
                }
            }

            return null;
        }

        private static string NormalizeKey(string? value)
        {
            var normalized = (value ?? string.Empty).Trim();
            if (normalized.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized[..^5];
            }

            return normalized.ToLowerInvariant();
        }

        private static string EscapeSqlLiteral(string input)
        {
            return (input ?? string.Empty).Replace("'", "''");
        }

        private static ServiceResponse<MemoryStream> Failure(string message)
        {
            return new ServiceResponse<MemoryStream>
            {
                Success = false,
                Message = message
            };
        }
    }
}
