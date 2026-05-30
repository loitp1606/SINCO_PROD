using reportSystem01.Shared;
using Sinco.Server.Models;
using System.Data;
using System.Data.SqlClient;
using System.Text.Json;

namespace Sinco.Server.Repositories.Report
{
    public class DynamicReportService : IDynamicReportService
    {
        private readonly string _connectionString;
        private readonly IConfiguration _configuration;
        private readonly ILogger<DynamicReportService> _logger;

        public DynamicReportService(IConfiguration configuration, ILogger<DynamicReportService> logger)
        {
            _configuration = configuration;
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string not found");
            _logger = logger;
        }

        public async Task<ServiceResponse<DynamicReportResponse>> ProcessReportAsync(DynamicReportRequest request)
        {
            var response = new ServiceResponse<DynamicReportResponse>();

            try
            {
                // Xác định đường dẫn file JSON
                var filePath = Path.Combine("Controllers", "Form", "Report", request.Controller);
                
                if (!File.Exists(filePath))
                {
                    response.Success = false;
                    response.Message = $"Không tìm thấy file report: {request.Controller}";
                    return response;
                }

                // Đọc và parse file JSON
                var jsonContent = await File.ReadAllTextAsync(filePath);
                var reportConfig = JsonSerializer.Deserialize<DynamicReportResponse>(jsonContent, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                if (reportConfig == null)
                {
                    response.Success = false;
                    response.Message = "Không thể đọc cấu hình report";
                    return response;
                }

                // Xử lý theo action
                if (request.Action.ToLower() == "loading")
                {
                    // Action loading: chỉ trả về cấu trúc, không có data
                    reportConfig.Data = new List<Dictionary<string, object>>();
                    reportConfig.Action = request.Action;
                    
                    response.Success = true;
                    response.Message = "Đã tải cấu hình report thành công";
                    response.Data = reportConfig;
                }
                else if (request.Action.ToLower() == "finding")
                {
                    // Action finding: thực thi stored procedure và trả về data
                    if (reportConfig.DataProcessing?.Report == null || !reportConfig.DataProcessing.Report.Any())
                    {
                        response.Success = false;
                        response.Message = "Không tìm thấy cấu hình dataProcessing trong file report";
                        return response;
                    }

                    // Lấy query đầu tiên (có thể mở rộng để xử lý nhiều query)
                    var queryConfig = reportConfig.DataProcessing.Report.First();
                    var query = queryConfig.Query;

                    // Replace các biến @param trong query bằng giá trị từ request.Param
                    // Vì query đã có format N'@param' rồi, chỉ cần replace @param thành giá trị
                    foreach (var param in request.Param)
                    {
                        query = query.Replace($"@{param.Key}", param.Value);
                    }

                    // Thực thi query
                    var data = await ExecuteQueryAsync(query);

                    // Gán data vào response
                    reportConfig.Data = data;
                    reportConfig.Total = data.Count;
                    reportConfig.Action = request.Action;

                    response.Success = true;
                    response.Message = $"Đã tìm được {data.Count} bản ghi";
                    response.Data = reportConfig;
                }
                else
                {
                    response.Success = false;
                    response.Message = $"Action '{request.Action}' không hợp lệ. Chỉ hỗ trợ 'loading' hoặc 'finding'";
                }

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi khi xử lý dynamic report");
                response.Success = false;
                response.Message = $"Lỗi: {ex.Message}";
                return response;
            }
        }

        public async Task<List<Dictionary<string, object>>> ExecuteQueryAsync(string query)
        {
            var result = new List<Dictionary<string, object>>();

            try
            {
                using var connection = new SqlConnection(_connectionString);
                await connection.OpenAsync();

                using var command = new SqlCommand(query, connection);
                command.CommandType = CommandType.Text;
                command.CommandTimeout = 120; // Timeout 2 phút

                using var reader = await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    var row = new Dictionary<string, object>();

                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        var columnName = reader.GetName(i);
                        var value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                        
                        // Chuyển đổi các kiểu dữ liệu đặc biệt để serialize JSON tốt hơn
                        if (value is DateTime dateValue)
                        {
                            value = dateValue.ToString("yyyy-MM-dd");
                        }
                        else if (value is decimal decimalValue)
                        {
                            value = decimalValue;
                        }

                        row[columnName] = value ?? string.Empty;
                    }

                    result.Add(row);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Lỗi khi thực thi query: {query}");
                throw;
            }

            return result;
        }
    }
}

