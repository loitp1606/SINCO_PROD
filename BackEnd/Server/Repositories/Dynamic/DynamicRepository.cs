using Dapper;
using Microsoft.Data.SqlClient;
using Sinco.Server.Models;
using Sinco.Server.Repositories.AttachedFile;
using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using reportSystem01.Shared;

namespace Sinco.Server.Repositories.Dynamic
{
    public class DynamicRepository : IDynamicRepository
    {
        private sealed class LookupFilterMetadata
        {
            public string TableName { get; init; } = string.Empty;
            public string PrimaryField { get; init; } = string.Empty;
            public List<string> SearchFields { get; init; } = new();
        }

        private readonly string _connectionString;
        private readonly ILogger<DynamicRepository> _logger;
        private readonly IAttachedFileRepository _attachedFileRepository;

        public DynamicRepository(IConfiguration configuration, ILogger<DynamicRepository> logger, IAttachedFileRepository attachedFileRepository)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection");
            _logger = logger;
            _attachedFileRepository = attachedFileRepository;
        }

        public async Task<DynamicQueryResponse<Dictionary<string, object>>> GetDynamicListAsync(DynamicQueryRequest request)
        {
            try
            {
                var response = new DynamicQueryResponse<Dictionary<string, object>>
                {
                    Page = request.Page,
                    PageSize = request.PageSize,
                    Data = new List<Dictionary<string, object>>()
                };

                // Tách xử lý dựa vào type
                if (string.IsNullOrEmpty(request.FormId.Type))
                {
                    throw new ArgumentException("Type không được để trống");
                }

                if (request.FormId.Type.ToLower() == "list")
                {
                    return await GetListDataAsync(request, response);
                }
                else if (request.FormId.Type.ToLower() == "voucher")
                {
                    return await GetVoucherDataAsync(request, response);
                }
                else
                {
                    throw new ArgumentException($"Type '{request.FormId.Type}' không được hỗ trợ");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting dynamic list for form {FormId}", request.FormId.TableName);
                throw;
            }
        }

        public async Task<DynamicQueryResponse<Dictionary<string, object>>> GetDynamicFilterListAsync(DynamicFilterRequest request)
        {
            try
            {
                var response = new DynamicQueryResponse<Dictionary<string, object>>
                {
                    Page = request.Page,
                    PageSize = request.PageSize,
                    Data = new List<Dictionary<string, object>>()
                };

                // Tách xử lý dựa vào type
                if (string.IsNullOrEmpty(request.FormId.Type))
                {
                    throw new ArgumentException("Type không được để trống");
                }

                if (request.FormId.Type.ToLower() == "list")
                {
                    return await GetFilteredListDataAsync(request, response);
                }
                else if (request.FormId.Type.ToLower() == "voucher")
                {
                    return await GetFilteredVoucherDataAsync(request, response);
                }
                else
                {
                    throw new ArgumentException($"Type '{request.FormId.Type}' không được hỗ trợ");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting dynamic filter list for form {FormId}", request.FormId.TableName);
                throw;
            }
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetFilteredListDataAsync(
            DynamicFilterRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Build the base query
                        var query = $"SELECT * FROM {request.FormId.TableName} AS [src]";
                        var countQuery = $"SELECT COUNT(*) FROM {request.FormId.TableName} AS [src]";
                        var whereClause = new List<string>();
                        var filterValues = new Dictionary<string, object>();

                        // Add filter conditions với operators
                        if (request.Filter != null && request.Filter.Any())
                        {
                            var parameterIndex = 0;
                            foreach (var filterItem in request.Filter)
                            {
                                // Validate operator
                                if (!filterItem.IsValidOperator())
                                {
                                    throw new ArgumentException($"Toán tử '{filterItem.Operator}' không hợp lệ cho trường '{filterItem.Field}'");
                                }

                                var paramName = $"filter{parameterIndex}";
                                whereClause.Add(BuildSqlCondition(filterItem, paramName, "src"));
                                filterValues[paramName] = filterItem.GetParameterValue();
                                parameterIndex++;
                            }
                        }

                        // Add WHERE clause if there are any conditions
                        if (whereClause.Any())
                        {
                            var whereString = string.Join(" AND ", whereClause);
                            query += $" WHERE {whereString} and status <> '*'";
                            countQuery += $" WHERE {whereString} and status <> '*'";
                        }
                        else
                        {
                            query += $" WHERE status <> '*'";
                            countQuery += $" WHERE status <> '*'";
                        }

                        // Add sorting if specified
                        string orderByClause = "";
                        if (!string.IsNullOrEmpty(request.FormId.Sort))
                        {
                            orderByClause = $" ORDER BY {request.FormId.Sort}";
                        }

                        // Add pagination using OFFSET-FETCH
                        var paginatedQuery = $@"
                            SELECT *
                            FROM ({query}) AS BaseQuery
                            {orderByClause}
                            OFFSET @Offset ROWS
                            FETCH NEXT @PageSize ROWS ONLY";

                        // Calculate offset
                        var offset = (request.Page - 1) * request.PageSize;

                        // Get total count
                        using (var countCommand = new SqlCommand(countQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                countCommand.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            response.Total = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
                        }

                        // Get data
                        using (var command = new SqlCommand(paginatedQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                command.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            command.Parameters.AddWithValue("@Offset", offset);
                            command.Parameters.AddWithValue("@PageSize", request.PageSize);

                            using (var reader = await command.ExecuteReaderAsync())
                            {
                                while (await reader.ReadAsync())
                                {
                                    var row = new Dictionary<string, object>();
                                    for (int i = 0; i < reader.FieldCount; i++)
                                    {
                                        row[reader.GetName(i)] = GetReaderValue(reader, i);
                                    }
                                    response.Data.Add(row);
                                }
                            }
                        }

                        transaction.Commit();
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }

            // Thêm thông tin form vào response
            var formInfo = request.FormId;
            response.Controller = formInfo.Controller;
            response.TableName = formInfo.TableName;
            response.PrimaryKey = formInfo.PrimaryKey;
            response.Language = formInfo.Language;
            response.Unit = formInfo.Unit;
            response.IdVC = formInfo.IdVC;
            response.Type = formInfo.Type;
            response.Action = formInfo.Action;
            response.Sort = formInfo.Sort;
            response.UserId = formInfo.UserId;
            response.isFileHandle = formInfo.isFileHandle;
            return response;
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetFilteredVoucherDataAsync(
            DynamicFilterRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            if (string.IsNullOrEmpty(request.FormId.Action))
            {
                throw new ArgumentException("Action không được để trống cho type voucher");
            }

            if (request.FormId.Action.ToLower() == "loading")
            {
                return await GetFilteredVoucherLoadingDataAsync(request, response);
            }
            else if (request.FormId.Action.ToLower() == "finding")
            {
                return await GetFilteredVoucherFindingDataAsync(request, response);
            }
            else
            {
                throw new ArgumentException($"Action '{request.FormId.Action}' không được hỗ trợ cho type voucher");
            }
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetFilteredVoucherLoadingDataAsync(
            DynamicFilterRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Lấy dữ liệu trong vòng 6 tháng gần nhất
                        var queries = new List<string>();
                        var countQueries = new List<string>();
                        var filterValues = new Dictionary<string, object>();

                        // Add filter conditions với operators
                        var whereClause = new List<string>();
                        if (request.Filter != null && request.Filter.Any())
                        {
                            var parameterIndex = 0;
                            foreach (var filterItem in request.Filter)
                            {
                                // Validate operator
                                if (!filterItem.IsValidOperator())
                                {
                                    throw new ArgumentException($"Toán tử '{filterItem.Operator}' không hợp lệ cho trường '{filterItem.Field}'");
                                }

                                var paramName = $"filter{parameterIndex}";
                                whereClause.Add(BuildSqlCondition(filterItem, paramName, "src"));
                                filterValues[paramName] = filterItem.GetParameterValue();
                                parameterIndex++;
                            }
                        }

                        var whereString = whereClause.Any() ? string.Join(" AND ", whereClause) : "";
                        var dateBeginLoading = DateTime.Now.AddMonths(3);

                        // Tạo union query cho 9 tháng (6 tháng về sau và 3 tháng lên trước)
                        for (int i = 0; i < 9; i++)
                        {

                            var dateOffset = dateBeginLoading.AddMonths(-i);
                            var tableName = $"{request.FormId.TableName}${dateOffset:yyyyMM}";

                            _logger.LogInformation("Getting filtered voucher loading data from table: {TableName}", tableName);

                            var baseQuery = $"SELECT * FROM {tableName} AS [src]";
                            var baseCountQuery = $"SELECT COUNT(*) FROM {tableName} AS [src]";

                            if (!string.IsNullOrEmpty(whereString))
                            {
                                baseQuery += $" WHERE {whereString} and status <> '*' and unitCode = '{request.FormId.Unit}'";
                                baseCountQuery += $" WHERE {whereString} and status <> '*' and unitCode = '{request.FormId.Unit}'";
                            }
                            else
                            {
                                baseQuery += $" WHERE status <> '*' and unitCode = '{request.FormId.Unit}'";
                                baseCountQuery += $" WHERE status <> '*' and unitCode = '{request.FormId.Unit}'";
                            }

                            queries.Add($"({baseQuery})");
                            countQueries.Add($"({baseCountQuery})");
                        }

                        var unionQuery = string.Join(" UNION ALL ", queries);
                        var unionCountQuery = string.Join(" + ", countQueries.Select(q => $"({q})"));

                        // Add sorting if specified
                        string orderByClause = "";
                        if (!string.IsNullOrEmpty(request.FormId.Sort))
                        {
                            orderByClause = $" ORDER BY {request.FormId.Sort}";
                        }

                        // Add pagination
                        var paginatedQuery = $@"
                            SELECT *
                            FROM ({unionQuery}) AS UnionQuery
                            {orderByClause}
                            OFFSET @Offset ROWS
                            FETCH NEXT @PageSize ROWS ONLY";

                        // Calculate offset
                        var offset = (request.Page - 1) * request.PageSize;

                        // Get total count
                        var finalCountQuery = $"SELECT {unionCountQuery}";
                        using (var countCommand = new SqlCommand(finalCountQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                countCommand.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            response.Total = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
                        }

                        // Get data
                        using (var command = new SqlCommand(paginatedQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                command.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            command.Parameters.AddWithValue("@Offset", offset);
                            command.Parameters.AddWithValue("@PageSize", request.PageSize);

                            using (var reader = await command.ExecuteReaderAsync())
                            {
                                while (await reader.ReadAsync())
                                {
                                    var row = new Dictionary<string, object>();
                                    for (int i = 0; i < reader.FieldCount; i++)
                                    {
                                        row[reader.GetName(i)] = GetReaderValue(reader, i);
                                    }
                                    response.Data.Add(row);
                                }
                            }
                        }

                        transaction.Commit();
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }

            // Thêm thông tin form vào response
            var formInfo = request.FormId;
            response.Controller = formInfo.Controller;
            response.TableName = formInfo.TableName;
            response.PrimaryKey = formInfo.PrimaryKey;
            response.Language = formInfo.Language;
            response.Unit = formInfo.Unit;
            response.IdVC = formInfo.IdVC;
            response.Type = formInfo.Type;
            response.Action = formInfo.Action;
            response.Sort = formInfo.Sort;
            response.UserId = formInfo.UserId;
            response.isFileHandle = formInfo.isFileHandle;
            return response;
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetFilteredVoucherFindingDataAsync(
            DynamicFilterRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Lấy dữ liệu trong vòng 3 tháng gần nhất
                        var queries = new List<string>();
                        var countQueries = new List<string>();
                        var filterValues = new Dictionary<string, object>();

                        // Add filter conditions với operators
                        var whereClause = new List<string>();
                        if (request.Filter != null && request.Filter.Any())
                        {
                            var parameterIndex = 0;
                            foreach (var filterItem in request.Filter)
                            {
                                // Validate operator
                                if (!filterItem.IsValidOperator())
                                {
                                    throw new ArgumentException($"Toán tử '{filterItem.Operator}' không hợp lệ cho trường '{filterItem.Field}'");
                                }

                                var paramName = $"filter{parameterIndex}";
                                whereClause.Add(BuildSqlCondition(filterItem, paramName, "src"));
                                filterValues[paramName] = filterItem.GetParameterValue();
                                parameterIndex++;
                            }
                        }

                        var whereString = whereClause.Any() ? string.Join(" AND ", whereClause) : "";

                        // Tạo union query cho 3 tháng
                        for (int i = 0; i < 3; i++)
                        {
                            var dateOffset = DateTime.Now.AddMonths(-i);
                            var tableName = $"{request.FormId.TableName}${dateOffset:yyyyMM}";

                            var baseQuery = $"SELECT * FROM {tableName} AS [src]";
                            var baseCountQuery = $"SELECT COUNT(*) FROM {tableName} AS [src]";

                            if (!string.IsNullOrEmpty(whereString))
                            {
                                baseQuery += $" WHERE {whereString} and status <> '*' and unitCode = '{request.FormId.Unit}'";
                                baseCountQuery += $" WHERE {whereString} and status <> '*' and unitCode = '{request.FormId.Unit}'";
                            }
                            else
                            {
                                baseQuery += $" WHERE status <> '*' and unitCode = '{request.FormId.Unit}'";
                                baseCountQuery += $" WHERE status <> '*' and unitCode = '{request.FormId.Unit}'";
                            }

                            queries.Add($"({baseQuery})");
                            countQueries.Add($"({baseCountQuery})");
                        }

                        var unionQuery = string.Join(" UNION ALL ", queries);
                        var unionCountQuery = string.Join(" + ", countQueries.Select(q => $"({q})"));

                        // Add sorting if specified
                        string orderByClause = "";
                        if (!string.IsNullOrEmpty(request.FormId.Sort))
                        {
                            orderByClause = $" ORDER BY {request.FormId.Sort}";
                        }

                        // Add pagination
                        var paginatedQuery = $@"
                            SELECT *
                            FROM ({unionQuery}) AS UnionQuery
                            {orderByClause}
                            OFFSET @Offset ROWS
                            FETCH NEXT @PageSize ROWS ONLY";

                        // Calculate offset
                        var offset = (request.Page - 1) * request.PageSize;

                        // Get total count
                        var finalCountQuery = $"SELECT {unionCountQuery}";
                        using (var countCommand = new SqlCommand(finalCountQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                countCommand.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            response.Total = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
                        }

                        // Get data
                        using (var command = new SqlCommand(paginatedQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                command.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            command.Parameters.AddWithValue("@Offset", offset);
                            command.Parameters.AddWithValue("@PageSize", request.PageSize);

                            using (var reader = await command.ExecuteReaderAsync())
                            {
                                while (await reader.ReadAsync())
                                {
                                    var row = new Dictionary<string, object>();
                                    for (int i = 0; i < reader.FieldCount; i++)
                                    {
                                        row[reader.GetName(i)] = GetReaderValue(reader, i);
                                    }
                                    response.Data.Add(row);
                                }
                            }
                        }

                        transaction.Commit();
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }

            // Thêm thông tin form vào response
            var formInfo = request.FormId;
            response.Controller = formInfo.Controller;
            response.TableName = formInfo.TableName;
            response.PrimaryKey = formInfo.PrimaryKey;
            response.Language = formInfo.Language;
            response.Unit = formInfo.Unit;
            response.IdVC = formInfo.IdVC;
            response.Type = formInfo.Type;
            response.Action = formInfo.Action;
            response.Sort = formInfo.Sort;
            response.UserId = formInfo.UserId;
            response.isFileHandle = formInfo.isFileHandle;
            return response;
        }

        private string BuildSqlCondition(FilterItem filterItem, string parameterName, string baseTableName)
        {
            if (!string.IsNullOrWhiteSpace(filterItem.LookupController))
            {
                return BuildLookupSqlCondition(filterItem, parameterName, baseTableName);
            }

            return filterItem.ToSqlCondition(parameterName);
        }

        private string BuildLookupSqlCondition(FilterItem filterItem, string parameterName, string baseTableName)
        {
            var metadata = LoadLookupFilterMetadata(filterItem.LookupController!);
            var safeBaseTable = EnsureSafeIdentifier(baseTableName);
            var safeField = EnsureSafeIdentifier(filterItem.Field);
            var safeLookupTable = EnsureSafeIdentifier(metadata.TableName);
            var safePrimaryField = EnsureSafeIdentifier(metadata.PrimaryField);

            var searchableFields = metadata.SearchFields
                .Where(field => !string.IsNullOrWhiteSpace(field))
                .Select(EnsureSafeIdentifier)
                .Where(field => !string.Equals(field, safePrimaryField, StringComparison.OrdinalIgnoreCase))
                .ToList();

            // Always include primary lookup field (code) so one input can match both code and name.
            searchableFields.Insert(0, safePrimaryField);

            var searchableConditions = searchableFields
                .Select(field => $"CAST(lookup_filter.[{field}] AS NVARCHAR(MAX)) LIKE @{parameterName}")
                .ToList();

            return $@"EXISTS (
                SELECT 1
                FROM [{safeLookupTable}] AS lookup_filter
                WHERE lookup_filter.[{safePrimaryField}] = [{safeBaseTable}].[{safeField}]
                  AND ({string.Join(" OR ", searchableConditions)})
            )";
        }

        private LookupFilterMetadata LoadLookupFilterMetadata(string controller)
        {
            var normalizedController = controller.Trim();
            var fileName = $"Lookup{char.ToUpper(normalizedController[0]) + normalizedController.Substring(1)}.json";
            var filePath = Path.Combine(Directory.GetCurrentDirectory(), "Controllers", "Form", "Lookup", fileName);

            if (!File.Exists(filePath))
            {
                throw new FileNotFoundException($"Không tìm thấy file cấu hình lookup: {filePath}");
            }

            using var jsonDoc = JsonDocument.Parse(File.ReadAllText(filePath));
            var root = jsonDoc.RootElement;

            var tableName = root.GetProperty("formId").GetString() ?? throw new InvalidOperationException("Lookup formId not found");
            var primaryFields = root.GetProperty("primaryKey").EnumerateArray()
                .Select(item => item.GetString())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .ToList();

            var fields = root.GetProperty("fields").EnumerateArray()
                .Select(item => item.GetProperty("field").GetString())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .ToList()!;

            var primaryField = primaryFields.FirstOrDefault() ?? fields.FirstOrDefault() ?? throw new InvalidOperationException("Lookup primary field not found");

            var preferredSearchFields = fields
                .Where(field =>
                {
                    var normalized = field!.ToLowerInvariant();
                    return normalized.Contains("name")
                        || normalized.Contains("ten")
                        || normalized.EndsWith("_name")
                        || normalized.Contains("code")
                        || normalized.StartsWith("ma_")
                        || normalized.EndsWith("_code");
                })
                .Cast<string>()
                .ToList();

            var searchFields = preferredSearchFields.Any()
                ? preferredSearchFields
                : fields.Where(field => !string.Equals(field, primaryField, StringComparison.OrdinalIgnoreCase))
                    .Cast<string>()
                    .ToList();

            return new LookupFilterMetadata
            {
                TableName = tableName,
                PrimaryField = primaryField,
                SearchFields = searchFields
            };
        }

        private string EnsureSafeIdentifier(string identifier)
        {
            if (string.IsNullOrWhiteSpace(identifier) || !Regex.IsMatch(identifier, @"^[A-Za-z0-9_]+$"))
            {
                throw new ArgumentException($"Identifier không hợp lệ: {identifier}");
            }

            return identifier;
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetListDataAsync(
            DynamicQueryRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Build the base query
                        var query = $"SELECT * FROM {request.FormId.TableName}";
                        var countQuery = $"SELECT COUNT(*) FROM {request.FormId.TableName}";
                        var whereClause = new List<string>();
                        var filterValues = new Dictionary<string, string>();

                        // Add filter conditions if any
                        if (request.Filter.HasValue)
                        {
                            foreach (var prop in request.Filter.Value.EnumerateObject())
                            {
                                whereClause.Add($"{prop.Name} = @{prop.Name}");
                                filterValues[prop.Name] = prop.Value.GetString();
                            }
                        }

                        // Add WHERE clause if there are any conditions
                        if (whereClause.Any())
                        {
                            var whereString = string.Join(" AND ", whereClause);
                            query += $" WHERE {whereString} and status <> '*'";
                            countQuery += $" WHERE {whereString} and status <> '*'";
                        }
                        else
                        {
                            query += $" WHERE status <> '*'";
                            countQuery += $" WHERE status <> '*'";
                        }

                        // Add sorting if specified
                        string orderByClause = "";
                        if (!string.IsNullOrEmpty(request.FormId.Sort))
                        {
                            orderByClause = $" ORDER BY {request.FormId.Sort}";
                        }

                        // Add pagination using OFFSET-FETCH
                        var paginatedQuery = $@"
                            SELECT *
                            FROM ({query}) AS BaseQuery
                            {orderByClause}
                            OFFSET @Offset ROWS
                            FETCH NEXT @PageSize ROWS ONLY";

                        // Calculate offset
                        var offset = (request.Page - 1) * request.PageSize;

                        // Get total count
                        using (var countCommand = new SqlCommand(countQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                countCommand.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            response.Total = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
                        }

                        // Get data
                        using (var command = new SqlCommand(paginatedQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                command.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            command.Parameters.AddWithValue("@Offset", offset);
                            command.Parameters.AddWithValue("@PageSize", request.PageSize);

                            using (var reader = await command.ExecuteReaderAsync())
                            {
                                while (await reader.ReadAsync())
                                {
                                    var row = new Dictionary<string, object>();
                                    for (int i = 0; i < reader.FieldCount; i++)
                                    {
                                        row[reader.GetName(i)] = GetReaderValue(reader, i);
                                    }
                                    response.Data.Add(row);
                                }
                            }
                        }

                        transaction.Commit();
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }

            // Thêm thông tin form vào response
            var formInfo = request.FormId;
            response.Controller = formInfo.Controller;
            response.TableName = formInfo.TableName;
            response.PrimaryKey = formInfo.PrimaryKey;
            response.Language = formInfo.Language;
            response.Unit = formInfo.Unit;
            response.IdVC = formInfo.IdVC;
            response.Type = formInfo.Type;
            response.Action = formInfo.Action;
            response.Sort = formInfo.Sort;
            response.UserId = formInfo.UserId;

            return response;
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetVoucherDataAsync(
            DynamicQueryRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            if (string.IsNullOrEmpty(request.FormId.Action))
            {
                throw new ArgumentException("Action không được để trống cho type voucher");
            }

            if (request.FormId.Action.ToLower() == "loading")
            {
                return await GetVoucherLoadingDataAsync(request, response);
            }
            else if (request.FormId.Action.ToLower() == "finding")
            {
                return await GetVoucherFindingDataAsync(request, response);
            }
            else
            {
                throw new ArgumentException($"Action '{request.FormId.Action}' không được hỗ trợ cho type voucher");
            }
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetVoucherLoadingDataAsync(
            DynamicQueryRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Lấy dữ liệu trong vòng 3 tháng gần nhất
                        var queries = new List<string>();
                        var countQueries = new List<string>();
                        var filterValues = new Dictionary<string, string>();

                        // Add filter conditions if any
                        if (request.Filter.HasValue)
                        {
                            foreach (var prop in request.Filter.Value.EnumerateObject())
                            {
                                filterValues[prop.Name] = prop.Value.GetString();
                            }
                        }

                        // Tạo union query cho 3 tháng
                        for (int i = 0; i < 3; i++)
                        {
                            var dateOffset = DateTime.Now.AddMonths(-i);
                            var tableName = $"{request.FormId.TableName}${dateOffset:yyyyMM}";

                            _logger.LogInformation("Getting voucher loading data from table: {TableName}", tableName);

                            var baseQuery = $"SELECT * FROM {tableName}";
                            var baseCountQuery = $"SELECT COUNT(*) FROM {tableName}";
                            var whereClause = new List<string>();

                            // Add filter conditions if any
                            if (filterValues.Any())
                            {
                                foreach (var filter in filterValues)
                                {
                                    whereClause.Add($"{filter.Key} = @{filter.Key}");
                                }
                            }

                            // Add WHERE clause if there are any conditions
                            if (whereClause.Any())
                            {
                                var whereString = string.Join(" AND ", whereClause);
                                baseQuery += $" WHERE {whereString} and status <> '*'";
                                baseCountQuery += $" WHERE {whereString} and status <> '*'";
                            }
                            else
                            {
                                baseQuery += $" WHERE status <> '*'";
                                baseCountQuery += $" WHERE status <> '*'";
                            }

                            queries.Add($"({baseQuery})");
                            countQueries.Add($"({baseCountQuery})");
                        }

                        var unionQuery = string.Join(" UNION ALL ", queries);
                        var unionCountQuery = string.Join(" + ", countQueries.Select(q => $"({q})"));

                        // Add sorting if specified
                        string orderByClause = "";
                        if (!string.IsNullOrEmpty(request.FormId.Sort))
                        {
                            orderByClause = $" ORDER BY {request.FormId.Sort}";
                        }

                        // Add pagination
                        var paginatedQuery = $@"
                            SELECT *
                            FROM ({unionQuery}) AS UnionQuery
                            {orderByClause}
                            OFFSET @Offset ROWS
                            FETCH NEXT @PageSize ROWS ONLY";

                        // Calculate offset
                        var offset = (request.Page - 1) * request.PageSize;

                        // Get total count
                        var finalCountQuery = $"SELECT {unionCountQuery}";
                        using (var countCommand = new SqlCommand(finalCountQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                countCommand.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            response.Total = Convert.ToInt32(await countCommand.ExecuteScalarAsync());
                        }

                        // Get data
                        using (var command = new SqlCommand(paginatedQuery, connection, transaction))
                        {
                            foreach (var filter in filterValues)
                            {
                                command.Parameters.AddWithValue($"@{filter.Key}", filter.Value);
                            }
                            command.Parameters.AddWithValue("@Offset", offset);
                            command.Parameters.AddWithValue("@PageSize", request.PageSize);

                            using (var reader = await command.ExecuteReaderAsync())
                            {
                                while (await reader.ReadAsync())
                                {
                                    var row = new Dictionary<string, object>();
                                    for (int i = 0; i < reader.FieldCount; i++)
                                    {
                                        row[reader.GetName(i)] = GetReaderValue(reader, i);
                                    }
                                    response.Data.Add(row);
                                }
                            }
                        }

                        transaction.Commit();
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }

            // Thêm thông tin form vào response
            var formInfo = request.FormId;
            response.Controller = formInfo.Controller;
            response.TableName = formInfo.TableName;
            response.PrimaryKey = formInfo.PrimaryKey;
            response.Language = formInfo.Language;
            response.Unit = formInfo.Unit;
            response.IdVC = formInfo.IdVC;
            response.Type = formInfo.Type;
            response.Action = formInfo.Action;
            response.Sort = formInfo.Sort;
            response.UserId = formInfo.UserId;

            return response;
        }

        private async Task<DynamicQueryResponse<Dictionary<string, object>>> GetVoucherFindingDataAsync(
            DynamicQueryRequest request,
            DynamicQueryResponse<Dictionary<string, object>> response)
        {
            // Validate filter for finding action
            if (!request.Filter.HasValue)
            {
                throw new ArgumentException("Filter không được để trống cho action finding");
            }

            var filterDict = new Dictionary<string, string>();
            string dateFrom = null;
            string dateTo = null;

            // Parse filter
            foreach (var prop in request.Filter.Value.EnumerateObject())
            {
                var value = prop.Value.GetString();
                filterDict[prop.Name] = value;

                if (prop.Name.ToLower() == "datefrom")
                {
                    dateFrom = value;
                }
                else if (prop.Name.ToLower() == "dateto")
                {
                    dateTo = value;
                }
            }

            // Validate required fields for finding
            if (!filterDict.ContainsKey("status"))
            {
                throw new ArgumentException("Filter phải chứa trường 'status' cho action finding");
            }

            if (string.IsNullOrEmpty(dateFrom) || string.IsNullOrEmpty(dateTo))
            {
                throw new ArgumentException("Filter phải chứa trường 'dateFrom' và 'dateTo' cho action finding");
            }

            // Parse dates
            if (!DateTime.TryParse(dateFrom, out DateTime fromDate) || !DateTime.TryParse(dateTo, out DateTime toDate))
            {
                throw new ArgumentException("Định dạng dateFrom hoặc dateTo không hợp lệ");
            }

            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        var allData = new List<Dictionary<string, object>>();
                        var totalCount = 0;

                        // Lặp qua các tháng từ dateFrom đến dateTo
                        var currentMonth = new DateTime(fromDate.Year, fromDate.Month, 1);
                        var endMonth = new DateTime(toDate.Year, toDate.Month, 1);

                        while (currentMonth <= endMonth)
                        {
                            var tableName = $"{request.FormId.TableName}${currentMonth:yyyyMM}";

                            _logger.LogInformation("Getting voucher finding data from table: {TableName}", tableName);

                            // Check if table exists
                            var checkTableQuery = @"
                                SELECT COUNT(*) 
                                FROM INFORMATION_SCHEMA.TABLES 
                                WHERE TABLE_NAME = @TableName";

                            using (var checkCommand = new SqlCommand(checkTableQuery, connection, transaction))
                            {
                                checkCommand.Parameters.AddWithValue("@TableName", tableName);
                                var tableExists = Convert.ToInt32(await checkCommand.ExecuteScalarAsync()) > 0;

                                if (tableExists)
                                {
                                    // Build query with date range filter
                                    var whereClause = new List<string>();
                                    var parameters = new List<SqlParameter>();

                                    // Add status filter
                                    whereClause.Add("status = @status");
                                    parameters.Add(new SqlParameter("@status", filterDict["status"]));

                                    // Add date range filter (assuming there's a date column, adjust as needed)
                                    // You may need to adjust the date column name based on your table structure
                                    if (currentMonth == new DateTime(fromDate.Year, fromDate.Month, 1))
                                    {
                                        // First month: from dateFrom to end of month
                                        whereClause.Add("CAST(vcdate AS DATE) >= @dateFrom");
                                        parameters.Add(new SqlParameter("@dateFrom", fromDate.Date));
                                    }

                                    if (currentMonth == new DateTime(toDate.Year, toDate.Month, 1))
                                    {
                                        // Last month: from start of month to dateTo
                                        whereClause.Add("CAST(vcdate AS DATE) <= @dateTo");
                                        parameters.Add(new SqlParameter("@dateTo", toDate.Date));
                                    }

                                    // Add other filter conditions
                                    foreach (var filter in filterDict.Where(f =>
                                        f.Key.ToLower() != "status" &&
                                        f.Key.ToLower() != "datefrom" &&
                                        f.Key.ToLower() != "dateto"))
                                    {
                                        whereClause.Add($"{filter.Key} = @{filter.Key}");
                                        parameters.Add(new SqlParameter($"@{filter.Key}", filter.Value));
                                    }

                                    var whereString = string.Join(" AND ", whereClause);
                                    var query = $"SELECT * FROM {tableName} WHERE {whereString} and status <> '*'";
                                    var countQuery = $"SELECT COUNT(*) FROM {tableName} WHERE {whereString} and status <> '*'";

                                    // Get count for this table
                                    using (var countCommand = new SqlCommand(countQuery, connection, transaction))
                                    {
                                        countCommand.Parameters.AddRange(parameters.ToArray());
                                        totalCount += Convert.ToInt32(await countCommand.ExecuteScalarAsync());
                                    }

                                    // Get data for this table
                                    using (var dataCommand = new SqlCommand(query, connection, transaction))
                                    {
                                        dataCommand.Parameters.AddRange(parameters.ToArray());
                                        using (var reader = await dataCommand.ExecuteReaderAsync())
                                        {
                                            while (await reader.ReadAsync())
                                            {
                                                var row = new Dictionary<string, object>();
                                                for (int i = 0; i < reader.FieldCount; i++)
                                                {
                                                    row[reader.GetName(i)] = GetReaderValue(reader, i);
                                                }
                                                allData.Add(row);
                                            }
                                        }
                                    }
                                }
                            }

                            currentMonth = currentMonth.AddMonths(1);
                        }

                        // Apply sorting if specified
                        if (!string.IsNullOrEmpty(request.FormId.Sort))
                        {
                            var sortField = request.FormId.Sort;
                            var ascending = true;

                            if (sortField.ToUpper().EndsWith(" DESC"))
                            {
                                sortField = sortField.Substring(0, sortField.Length - 5).Trim();
                                ascending = false;
                            }
                            else if (sortField.ToUpper().EndsWith(" ASC"))
                            {
                                sortField = sortField.Substring(0, sortField.Length - 4).Trim();
                            }

                            allData = ascending
                                ? allData.OrderBy(x => x.ContainsKey(sortField) ? x[sortField] : null).ToList()
                                : allData.OrderByDescending(x => x.ContainsKey(sortField) ? x[sortField] : null).ToList();
                        }

                        // Apply pagination
                        var offset = (request.Page - 1) * request.PageSize;
                        var pagedData = allData.Skip(offset).Take(request.PageSize).ToList();

                        response.Data = pagedData;
                        response.Total = totalCount;

                        transaction.Commit();
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        throw;
                    }
                }
            }

            // Thêm thông tin form vào response
            var formInfo = request.FormId;
            response.Controller = formInfo.Controller;
            response.TableName = formInfo.TableName;
            response.PrimaryKey = formInfo.PrimaryKey;
            response.Language = formInfo.Language;
            response.Unit = formInfo.Unit;
            response.IdVC = formInfo.IdVC;
            response.Type = formInfo.Type;
            response.Action = formInfo.Action;
            response.Sort = formInfo.Sort;
            response.UserId = formInfo.UserId;

            return response;
        }

        public async Task<Dictionary<string, object>> GetDynamicByIdAsync(string formId, string[] primaryKeys, string[] values)
        {
            try
            {
                using (var connection = new SqlConnection(_connectionString))
                {
                    await connection.OpenAsync();
                    using (var transaction = connection.BeginTransaction())
                    {
                        try
                        {
                            var where = new List<string>();
                            for (int i = 0; i < primaryKeys.Length; i++)
                            {
                                where.Add($"{primaryKeys[i]} = @pk{i}");
                            }
                            var whereClause = string.Join(" AND ", where);
                            var query = $"SELECT * FROM {formId} WHERE {whereClause}";
                            using (var command = new SqlCommand(query, connection, transaction))
                            {
                                for (int i = 0; i < primaryKeys.Length; i++)
                                {
                                    command.Parameters.AddWithValue($"@pk{i}", values[i]);
                                }
                                using (var reader = await command.ExecuteReaderAsync())
                                {
                                    if (await reader.ReadAsync())
                                    {
                                        var row = new Dictionary<string, object>();
                                        for (int i = 0; i < reader.FieldCount; i++)
                                        {
                                            row[reader.GetName(i)] = GetReaderValue(reader, i);
                                        }
                                        transaction.Commit();
                                        return row;
                                    }
                                }
                            }
                            transaction.Commit();
                            return null;
                        }
                        catch (Exception ex)
                        {
                            transaction.Rollback();
                            throw;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting dynamic item for form {FormId} with primaryKeys {PrimaryKeys}", formId, string.Join(", ", primaryKeys));
                throw;
            }
        }

        public async Task<DynamicSaveResponse> SaveDynamicAsync(DynamicSaveRequest request)
        {
            DynamicSaveResponse result;

            if (request.Type == "voucher")
            {
                result = await SaveVoucherAsync(request);
            }
            else // list hoặc các loại khác
            {
                result = await SaveListAsync(request);
            }

            // Xử lý file attachments sau khi save thành công
            if (result.Success && request.FileAttachments != null)
            {
                try
                {
                    await ProcessFileAttachmentsAsync(request, result);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing file attachments for form {FormId}", request.FormId);
                    // Không fail toàn bộ transaction vì dữ liệu chính đã được lưu
                    // Chỉ log error và thông báo
                    result.Message += $" (Có lỗi khi xử lý file đính kèm: {ex.Message})";
                }
            }

            return result;
        }

        private async Task<DynamicSaveResponse> SaveVoucherAsync(DynamicSaveRequest request)
        {
            var data = request.Data;
            string idGui = null;
            if (data.TryGetProperty("idGui", out var idGuiProp))
            {
                idGui = idGuiProp.GetString()?.Trim();
            }
            else if (data.ValueKind == JsonValueKind.Object)
            {
                var idGuiProperty = data.EnumerateObject()
                    .FirstOrDefault(p => string.Equals(p.Name, "idGui", StringComparison.OrdinalIgnoreCase));
                if (!string.IsNullOrEmpty(idGuiProperty.Name))
                {
                    idGui = idGuiProperty.Value.GetString()?.Trim();
                }
            }

            // Sinh idGui nếu cần
            var normalizedAction = request.Action?.Trim().ToLowerInvariant();
            var isInsertAction =
                normalizedAction == "insert" ||
                normalizedAction == "create" ||
                normalizedAction == "add" ||
                normalizedAction == "new";

            if (isInsertAction && string.IsNullOrEmpty(idGui))
            {
                var newId = Guid.NewGuid().ToString("N");
                var dataDict = JsonSerializer.Deserialize<Dictionary<string, object>>(data.GetRawText())
                    ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                dataDict["idGui"] = newId;
                var newDataJson = JsonSerializer.Serialize(dataDict);
                request.Data = JsonSerializer.Deserialize<JsonElement>(newDataJson);
                idGui = newId;
            }

            var formId = request.FormId;
            var vcDate = request.VCDate;
            string yyyymm = "000000";
            if (!string.IsNullOrEmpty(vcDate) && DateTime.TryParse(vcDate, out var dt))
                yyyymm = dt.ToString("yyyyMM");

            var tableMaster000000 = $"{formId}$000000";
            var tableMasterYyyymm = $"{formId}${yyyymm}";

            // Variables for handling date change scenario
            string oldYyyymm = null;
            string oldTableMasterYyyymm = null;
            bool isDateChanged = false;

            using (var connection = new SqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    var response = new DynamicSaveResponse();
                    var errors = new List<ValidationError>();
                    try
                    {
                        // Validate required fields (reuse from SaveListAsync)
                        if (string.IsNullOrEmpty(request.FormId))
                            errors.Add(new ValidationError { Field = "formId", Message = "Mã form không được để trống" });
                        if (string.IsNullOrEmpty(request.Action))
                            errors.Add(new ValidationError { Field = "action", Message = "Hành động không được để trống" });
                        if (request.PrimaryKey == null || request.PrimaryKey.Length == 0)
                            errors.Add(new ValidationError { Field = "primaryKey", Message = "Khóa chính không được để trống" });
                        if (string.IsNullOrEmpty(request.Type))
                            errors.Add(new ValidationError { Field = "type", Message = "Loại dữ liệu không được để trống" });
                        if (string.IsNullOrEmpty(request.VCDate))
                            errors.Add(new ValidationError { Field = "VCDate", Message = "Ngày chứng từ không được để trống" });
                        if (errors.Any())
                        {
                            response.Success = false;
                            response.Errors = errors;
                            return response;
                        }

                        // Tự động tăng số cho các field cần thiết (chỉ cho type = voucher)
                        var autoIncrementResult = await AutoIncrementFieldNumberAsync(request, connection, transaction);
                        if (!autoIncrementResult)
                        {
                            _logger.LogWarning("Auto increment failed for form {FormId}, but continuing with save", request.FormId);
                        }

                        // Lấy giá trị primary key từ data
                        var primaryKeyValues = request.PrimaryKey.Select(k => request.Data.GetProperty(k).GetString()).ToArray();

                        // Check for date change scenario when action is update
                        if (request.Action.ToLower() == "update" && !string.IsNullOrEmpty(idGui))
                        {
                            try
                            {
                                // Get original voucher data from master table to check old date
                                var getOriginalQuery = $"SELECT voucherDate FROM {tableMaster000000} WHERE idGui = @idGui";
                                using (var getOriginalCmd = new SqlCommand(getOriginalQuery, connection, transaction))
                                {
                                    getOriginalCmd.Parameters.AddWithValue("@idGui", idGui);
                                    var originalVoucherDate = await getOriginalCmd.ExecuteScalarAsync();

                                    if (originalVoucherDate != null && originalVoucherDate != DBNull.Value)
                                    {
                                        var originalDateStr = originalVoucherDate.ToString();
                                        if (DateTime.TryParse(originalDateStr, out var originalDate))
                                        {
                                            oldYyyymm = originalDate.ToString("yyyyMM");
                                            oldTableMasterYyyymm = $"{formId}${oldYyyymm}";
                                            isDateChanged = oldYyyymm != yyyymm;

                                            _logger.LogInformation("Date change check: Original={0}, New={1}, Changed={2}",
                                                oldYyyymm, yyyymm, isDateChanged);
                                        }
                                    }
                                }
                            }
                            catch (Exception ex)
                            {
                                _logger.LogWarning(ex, "Could not retrieve original voucher date for idGui: {0}", idGui);
                            }
                        }

                        var checkSaveProc = $"OOT$CheckSave${formId}";
                        // check truoc khi luu OOT$CheckSave$<formId>
                        try
                        {

                            using (var checkCmd = new SqlCommand(checkSaveProc, connection, transaction))
                            {
                                checkCmd.CommandType = CommandType.StoredProcedure;
                                // 1. Chuyển jsonMaster thành DataTable (Key-Value pairs)
                                DataTable masterTable = new DataTable();
                                masterTable.Columns.Add("Key", typeof(string));
                                masterTable.Columns.Add("Value", typeof(string));

                                foreach (var prop in request.Data.EnumerateObject().Where(p => p.Name != "details"))
                                {
                                    // FIX: GetJsonElementValue luôn return string, thêm ?? "null" phòng hờ
                                    string value = GetJsonElementValueV2(prop.Value) ?? "null";
                                    masterTable.Rows.Add(prop.Name, value);

                                    // Debug log (comment out sau khi fix)
                                    // _logger.LogDebug("Master prop: {Key} = {Value} (Kind: {Kind})", prop.Name, value, prop.Value.ValueKind);
                                }

                                var masterParam = new SqlParameter("@Master", SqlDbType.Structured)
                                {
                                    TypeName = "dbo.MasterDataType", // Table type: Key NVARCHAR(255), Value NVARCHAR(MAX)
                                    Value = masterTable
                                };
                                checkCmd.Parameters.Add(masterParam);

                                // 2. Chuyển details thành DataTable (RowId, Key, Value)
                                DataTable detailsTable = new DataTable();
                                detailsTable.Columns.Add("RowId", typeof(int));
                                detailsTable.Columns.Add("Key", typeof(string));
                                detailsTable.Columns.Add("Value", typeof(string));

                                if (request.Data.TryGetProperty("details", out var detailsForCheck) && detailsForCheck.ValueKind == JsonValueKind.Array)
                                {
                                    int rowId = 0;
                                    foreach (var section in detailsForCheck.EnumerateArray())
                                    {
                                        if (section.TryGetProperty("data", out var detailDataCheck))
                                        {
                                            // Kiểm tra ValueKind của detailDataCheck
                                            if (detailDataCheck.ValueKind == JsonValueKind.Object)
                                            {
                                                // Shred object
                                                foreach (var prop in detailDataCheck.EnumerateObject())
                                                {
                                                    // FIX: Tương tự, luôn non-null
                                                    string value = GetJsonElementValueV2(prop.Value) ?? "null";
                                                    detailsTable.Rows.Add(rowId, prop.Name, value);

                                                    // Debug log
                                                    // _logger.LogDebug("Detail prop (Object): RowId={RowId}, {Key} = {Value} (Kind: {Kind})", rowId, prop.Name, value, prop.Value.ValueKind);
                                                }
                                            }
                                            else if (detailDataCheck.ValueKind == JsonValueKind.Array)
                                            {
                                                // Shred array: Loop từng item (giả sử mỗi item là object)
                                                int subIndex = 0; // Để phân biệt nếu cần
                                                foreach (var item in detailDataCheck.EnumerateArray())
                                                {
                                                    if (item.ValueKind == JsonValueKind.Object)
                                                    {
                                                        foreach (var prop in item.EnumerateObject())
                                                        {
                                                            string value = GetJsonElementValueV2(prop.Value) ?? "null";
                                                            // Sử dụng rowId * 100 + subIndex để unique nếu array lớn (tùy chỉnh theo nhu cầu)
                                                            int uniqueRowId = rowId * 100 + subIndex;
                                                            detailsTable.Rows.Add(uniqueRowId, prop.Name, value);

                                                            // Debug log
                                                            // _logger.LogDebug("Detail prop (Array): UniqueRowId={UniqueRowId}, {Key} = {Value} (Kind: {Kind})", uniqueRowId, prop.Name, value, prop.Value.ValueKind);
                                                        }
                                                        subIndex++;
                                                    }
                                                    else
                                                    {
                                                        _logger.LogWarning("Item trong data array không phải object (Kind: {Kind}), bỏ qua.", item.ValueKind);
                                                    }
                                                }
                                            }
                                            else
                                            {
                                                _logger.LogWarning("detailDataCheck không phải Object hoặc Array (Kind: {Kind}), bỏ qua.", detailDataCheck.ValueKind);
                                            }
                                            rowId++; // Tăng cho section tiếp theo
                                        }
                                        else
                                        {
                                            _logger.LogWarning("Section không có property 'data', bỏ qua.");
                                        }
                                    }
                                }

                                var detailsParam = new SqlParameter("@Details", SqlDbType.Structured)
                                {
                                    TypeName = "dbo.DetailDataType", // Table type: RowId INT, Key NVARCHAR(255), Value NVARCHAR(MAX)
                                    Value = detailsTable
                                };
                                checkCmd.Parameters.Add(detailsParam);
                                // 3. Truyền các biến bổ sung từ request
                                checkCmd.Parameters.Add(new SqlParameter("@action", SqlDbType.NVarChar, 20) { Value = request.Action ?? (object)DBNull.Value });
                                checkCmd.Parameters.Add(new SqlParameter("@type", SqlDbType.NVarChar, 50) { Value = request.Type ?? (object)DBNull.Value });
                                checkCmd.Parameters.Add(new SqlParameter("@userId", SqlDbType.NVarChar, 50) { Value = request.UserId ?? (object)DBNull.Value });
                                checkCmd.Parameters.Add(new SqlParameter("@unit", SqlDbType.NVarChar, 50) { Value = request.Unit ?? (object)DBNull.Value });
                                checkCmd.Parameters.Add(new SqlParameter("@language", SqlDbType.NVarChar, 10) { Value = request.Language ?? (object)DBNull.Value });

                                // 4. Output: kết quả kiểm tra
                                var resultParam = new SqlParameter("@Result", SqlDbType.Int) { Direction = ParameterDirection.Output };
                                var messageParam = new SqlParameter("@Message", SqlDbType.NVarChar, 4000) { Direction = ParameterDirection.Output };
                                checkCmd.Parameters.Add(resultParam);
                                checkCmd.Parameters.Add(messageParam);

                                await checkCmd.ExecuteNonQueryAsync();

                                if ((int?)resultParam.Value == 0)
                                {
                                    transaction.Rollback();
                                    return new DynamicSaveResponse
                                    {
                                        Success = false,
                                        Message = messageParam.Value?.ToString() ?? "Bị từ chối bởi store check",
                                        Errors = new List<ValidationError>
                                        {
                                            new ValidationError { Field = "system", Message = messageParam.Value?.ToString() ?? "Lỗi không xác định từ store kiểm tra" }
                                        }
                                    };
                                }
                            }
                        }
                        catch (SqlException ex) when (ex.Number == 2812) // store không tồn tại
                        {
                            _logger.LogWarning($"Stored procedure {checkSaveProc} not found. Skipping pre-check.");
                        }

                        // Xử lý các bước trước khi đổi giá trị
                        if (request.DataProcessing?.Actions?.Post != null)
                        {
                            foreach (var step in request.DataProcessing.Actions.Post)
                            {
                                if (string.Equals(step?.Type, "sql01", StringComparison.OrdinalIgnoreCase))
                                {
                                    await ExecuteProcessingStepAsync(step.Query, request.Data, connection, transaction, idGui, request);
                                }
                            }
                        }


                        // Handle date change scenario for voucher updates
                        if (isDateChanged && request.Action.ToLower() == "update")
                        {
                            _logger.LogInformation("Handling date change: deleting from {0}, inserting to {1}", oldTableMasterYyyymm, tableMasterYyyymm);

                            // 1. Delete from old partition table (keep idGui)
                            var deleteFromOldPartition = $"DELETE FROM {oldTableMasterYyyymm} WHERE idGui = @idGui";
                            using (var deleteCmd = new SqlCommand(deleteFromOldPartition, connection, transaction))
                            {
                                deleteCmd.Parameters.AddWithValue("@idGui", idGui);
                                await deleteCmd.ExecuteNonQueryAsync();
                            }

                            // 2. Update master table (000000) with new data
                            await SaveToTableAsync(tableMaster000000, request.Data, request.PrimaryKey, connection, transaction, request.Unit, request.UserId, request.IdVC);

                            // 3. Insert to new partition table (preserve idGui, don't regenerate)
                            await SaveToTableVoucherAsync(tableMasterYyyymm, request.Data, request.PrimaryKey, connection, transaction, request.Unit, request.UserId, request.IdVC, false);
                        }
                        else
                        {
                            // Normal save logic for non-date-change scenarios
                            await SaveToTableAsync(tableMaster000000, request.Data, request.PrimaryKey, connection, transaction, request.Unit, request.UserId, request.IdVC);
                            await SaveToTableAsync(tableMasterYyyymm, request.Data, request.PrimaryKey, connection, transaction, request.Unit, request.UserId, request.IdVC);
                        }

                        // Xử lý detail (theo kiểu SaveListAsync, cho 2 bảng detail phân kỳ)
                        if (request.Data.TryGetProperty("details", out var detailsElement) && detailsElement.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var detailSection in detailsElement.EnumerateArray())
                            {
                                var controllerDetail = detailSection.GetProperty("controllerDetail").GetString();
                                var formIdDetail = detailSection.GetProperty("formIdDetail").GetString();
                                var foreignKey = detailSection.GetProperty("foreignKey").GetString();
                                var detailData = detailSection.GetProperty("data");

                                // Tên bảng detail gốc và phân kỳ
                                var tableDetail000000 = $"{formIdDetail}$000000";
                                var tableDetailYyyymm = $"{formIdDetail}${yyyymm}";

                                // Lấy giá trị khóa chính master để map vào detail
                                var masterPkValues = request.PrimaryKey.Select(k => request.Data.GetProperty(k).GetString()).ToArray();
                                var foreignKeyFields = foreignKey.Split(',').Select(fk => fk.Trim()).ToArray();

                                // Handle detail deletion and insertion based on date change scenario
                                if (request.Action.ToLower() == "update")
                                {
                                    if (isDateChanged)
                                    {
                                        // Khi ngày đổi sang tháng/năm khác: xóa từ partition cũ
                                        var oldTableDetailYyyymm = $"{formIdDetail}${oldYyyymm}";

                                        _logger.LogInformation("Date changed for detail - deleting from old partition: {0}", oldTableDetailYyyymm);

                                        // Xóa detail từ partition cũ
                                        var whereClauseOld = new List<string>();
                                        var deleteParamsOld = new List<SqlParameter>();
                                        for (int i = 0; i < foreignKeyFields.Length && i < masterPkValues.Length; i++)
                                        {
                                            whereClauseOld.Add($"{foreignKeyFields[i]} = @oldfk{i}");
                                            deleteParamsOld.Add(new SqlParameter($"@oldfk{i}", masterPkValues[i]));
                                        }

                                        if (whereClauseOld.Any())
                                        {
                                            try
                                            {
                                                var deleteOldQuery = $"DELETE FROM {oldTableDetailYyyymm} WHERE {string.Join(" AND ", whereClauseOld)}";
                                                using (var deleteOldCmd = new SqlCommand(deleteOldQuery, connection, transaction))
                                                {
                                                    deleteOldCmd.Parameters.AddRange(deleteParamsOld.ToArray());
                                                    var deletedRows = await deleteOldCmd.ExecuteNonQueryAsync();
                                                    _logger.LogInformation("Deleted {0} rows from old detail partition {1}", deletedRows, oldTableDetailYyyymm);
                                                }
                                            }
                                            catch (SqlException ex) when (ex.Number == 208) // Table doesn't exist
                                            {
                                                _logger.LogWarning("Old detail partition table {0} doesn't exist, skipping delete", oldTableDetailYyyymm);
                                            }
                                        }

                                        // Xóa detail từ bảng master (000000) để cập nhật lại
                                        var whereClauseMaster = new List<string>();
                                        var deleteParamsMaster = new List<SqlParameter>();
                                        for (int i = 0; i < foreignKeyFields.Length && i < masterPkValues.Length; i++)
                                        {
                                            whereClauseMaster.Add($"{foreignKeyFields[i]} = @masterfk{i}");
                                            deleteParamsMaster.Add(new SqlParameter($"@masterfk{i}", masterPkValues[i]));
                                        }

                                        if (whereClauseMaster.Any())
                                        {
                                            var deleteMasterQuery = $"DELETE FROM {tableDetail000000} WHERE {string.Join(" AND ", whereClauseMaster)}";
                                            using (var deleteMasterCmd = new SqlCommand(deleteMasterQuery, connection, transaction))
                                            {
                                                deleteMasterCmd.Parameters.AddRange(deleteParamsMaster.ToArray());
                                                var deletedMasterRows = await deleteMasterCmd.ExecuteNonQueryAsync();
                                                _logger.LogInformation("Deleted {0} rows from master detail table {1}", deletedMasterRows, tableDetail000000);
                                            }
                                        }
                                    }
                                    else
                                    {
                                        // Trường hợp update bình thường: xóa từ cả 2 bảng hiện tại
                                        _logger.LogInformation("Normal update - deleting from current detail tables");
                                        foreach (var tableDetail in new[] { tableDetail000000, tableDetailYyyymm })
                                        {
                                            var whereClause = new List<string>();
                                            var deleteParams = new List<SqlParameter>();
                                            for (int i = 0; i < foreignKeyFields.Length && i < masterPkValues.Length; i++)
                                            {
                                                whereClause.Add($"{foreignKeyFields[i]} = @fk{i}_{tableDetail}");
                                                deleteParams.Add(new SqlParameter($"@fk{i}_{tableDetail}", masterPkValues[i]));
                                            }
                                            if (whereClause.Any())
                                            {
                                                var deleteQuery = $"DELETE FROM {tableDetail} WHERE {string.Join(" AND ", whereClause)}";
                                                using (var deleteCmd = new SqlCommand(deleteQuery, connection, transaction))
                                                {
                                                    deleteCmd.Parameters.AddRange(deleteParams.ToArray());
                                                    var deletedRows = await deleteCmd.ExecuteNonQueryAsync();
                                                    _logger.LogInformation("Deleted {0} rows from detail table {1}", deletedRows, tableDetail);
                                                }
                                            }
                                        }
                                    }
                                }

                                // Insert detail mới vào các bảng cần thiết
                                var detailTablesToInsert = new List<string> { tableDetail000000, tableDetailYyyymm };
                                _logger.LogInformation("Inserting detail data to tables: {0}", string.Join(", ", detailTablesToInsert));

                                foreach (var tableDetail in detailTablesToInsert)
                                {
                                    if (detailData.ValueKind == JsonValueKind.Array)
                                    {
                                        foreach (var row in detailData.EnumerateArray())
                                        {
                                            // Build columns, parameters
                                            var columns = new List<string>();
                                            var parameters = new List<string>();
                                            var paramList = new List<SqlParameter>();

                                            // Xử lý null thông minh cho detail data
                                            var detailParams = await ProcessDataWithNullHandlingAsync(row, tableDetail, connection, transaction);
                                            foreach (var param in detailParams)
                                            {
                                                var columnName = param.ParameterName.TrimStart('@');

                                                columns.Add(columnName);
                                                parameters.Add(param.ParameterName);
                                                paramList.Add(param);
                                            }
                                            // Map foreign key fields từ master nếu chưa có trong row
                                            for (int i = 0; i < foreignKeyFields.Length && i < masterPkValues.Length; i++)
                                            {
                                                if (!columns.Contains(foreignKeyFields[i]))
                                                {
                                                    columns.Add(foreignKeyFields[i]);
                                                    parameters.Add($"@fk{i}");
                                                    paramList.Add(new SqlParameter($"@fk{i}", masterPkValues[i]));
                                                }
                                            }

                                            // Thêm các trường audit cho detail table
                                            //var auditColumns = new[] { "user_id0", "user_id2", "datetime0", "datetime2", "unitCode", "voucherCode" };
                                            //var auditParameters = new[] { "@user_id0", "@user_id2", "@datetime0", "@datetime2", "@unitCode", "@voucherCode" };
                                            //var auditParams = new[]
                                            //{
                                            //    new SqlParameter("@user_id0", request.UserId ?? (object)DBNull.Value),
                                            //    new SqlParameter("@user_id2", request.UserId ?? (object)DBNull.Value),
                                            //    new SqlParameter("@datetime0", DateTime.Now),
                                            //    new SqlParameter("@datetime2", DateTime.Now),
                                            //    new SqlParameter("@unitCode", request.Unit ?? (object)DBNull.Value),
                                            //    new SqlParameter("@voucherCode", request.IdVC ?? (object)DBNull.Value)
                                            //};

                                            //// Chỉ thêm audit columns nếu chúng chưa tồn tại
                                            //for (int j = 0; j < auditColumns.Length; j++)
                                            //{
                                            //    if (!columns.Contains(auditColumns[j]))
                                            //    {
                                            //        columns.Add(auditColumns[j]);
                                            //        parameters.Add(auditParameters[j]);
                                            //        paramList.Add(auditParams[j]);
                                            //    }
                                            //}

                                            var insertQuery = $"INSERT INTO {tableDetail} ({string.Join(", ", columns)}) VALUES ({string.Join(", ", parameters)})";
                                            using (var insertCmd = new SqlCommand(insertQuery, connection, transaction))
                                            {
                                                insertCmd.Parameters.AddRange(paramList.ToArray());
                                                //insertCmd.Parameters.AddWithValue("@idGui", idGui);
                                                try
                                                {
                                                    await insertCmd.ExecuteNonQueryAsync();
                                                    _logger.LogInformation("Successfully inserted detail row to {0}", tableDetail);
                                                }
                                                catch (Exception ex)
                                                {
                                                    _logger.LogError(ex, "Failed to insert detail row to {0}", tableDetail);
                                                    throw;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Xử lý các bước post nếu có
                        if (request.DataProcessing?.Actions?.Post != null)
                        {
                            foreach (var step in request.DataProcessing.Actions.Post)
                            {
                                if (string.Equals(step?.Type, "sql02", StringComparison.OrdinalIgnoreCase))
                                {
                                    await ExecuteProcessingStepAsync(step.Query, request.Data, connection, transaction, idGui, request);
                                }
                            }
                        }

                        // Cập nhật VoucherSequence sau khi lưu chứng từ thành công
                        var savedDataDict = new Dictionary<string, object>();
                        foreach (var prop in request.Data.EnumerateObject())
                        {
                            savedDataDict[prop.Name] = prop.Value.GetRawText();
                        }
                        await UpdateVoucherSequenceAfterSaveAsync(request.FormId, savedDataDict, connection, transaction);

                        transaction.Commit();
                        response.Success = true;
                        response.Message = "Lưu chứng từ thành công";
                        response.Id = idGui;
                        return response;
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();
                        _logger.LogError(ex, "Lỗi khi lưu voucher");
                        response.Success = false;
                        response.Message = "Đã xảy ra lỗi khi lưu chứng từ";
                        response.Id = idGui;
                        response.Errors = new List<ValidationError> { new ValidationError { Field = "system", Message = ex.Message } };
                        return response;
                    }
                }
            }
        }

        private async Task SaveToTableAsync(
            string tableName,
            JsonElement data,
            string[] primaryKey,
            SqlConnection connection,
            SqlTransaction transaction, string Unit, string userID, string IdVC)
        {
            if (data.ValueKind == JsonValueKind.Array)
            {
                // Batch insert cho mảng object
                foreach (var row in data.EnumerateArray())
                {
                    await SaveToTableAsync(tableName, row, primaryKey, connection, transaction, Unit, userID, IdVC);
                }
                return;
            }

            // Lấy danh sách cột và giá trị với xử lý null thông minh
            var columns = new List<string>();
            var parameters = new List<string>();
            var commandParameters = await ProcessDataWithNullHandlingAsync(data, tableName, connection, transaction);
            var pkValues = new List<object>();

            // Tách ra columns và parameters từ commandParameters
            foreach (var param in commandParameters)
            {
                var columnName = param.ParameterName.TrimStart('@');
                columns.Add(columnName);
                parameters.Add(param.ParameterName);
            }

            // Nếu có primaryKey, kiểm tra tồn tại để insert/update
            bool isUpdate = false;
            if (primaryKey != null && primaryKey.Length > 0)
            {
                var where = new List<string>();
                for (int i = 0; i < primaryKey.Length; i++)
                {
                    where.Add($"{primaryKey[i]} = @pk{i}");
                    var pkVal = data.TryGetProperty(primaryKey[i], out var pkProp)
                        ? GetJsonElementValue(pkProp)
                        : DBNull.Value;
                    pkValues.Add(pkVal);
                }
                var whereClause = string.Join(" AND ", where);

                // Check tồn tại
                var checkQuery = $"SELECT COUNT(*) FROM {tableName} WHERE {whereClause}";
                using (var checkCmd = new SqlCommand(checkQuery, connection, transaction))
                {
                    for (int i = 0; i < pkValues.Count; i++)
                        checkCmd.Parameters.AddWithValue($"@pk{i}", pkValues[i] ?? DBNull.Value);

                    isUpdate = Convert.ToInt32(await checkCmd.ExecuteScalarAsync()) > 0;
                }

                if (isUpdate)
                {
                    // UPDATE
                    var setClauses = columns.Where(c => !primaryKey.Contains(c)).Select(c => $"{c} = @{c}").ToList();
                    var updateQuery = $"UPDATE {tableName} SET {string.Join(", ", setClauses)}, user_id2 = {userID}, datetime2 = getdate() WHERE {whereClause}";
                    using (var updateCmd = new SqlCommand(updateQuery, connection, transaction))
                    {
                        updateCmd.Parameters.AddRange(commandParameters.ToArray());
                        for (int i = 0; i < pkValues.Count; i++)
                            updateCmd.Parameters.AddWithValue($"@pk{i}", pkValues[i] ?? DBNull.Value);
                        await updateCmd.ExecuteNonQueryAsync();
                    }
                    return;
                }
            }

            // INSERT
            var insertQuery = $"INSERT INTO {tableName} ({string.Join(", ", columns)}, user_id0, user_id2, datetime0, datetime2, unitCode, voucherCode) VALUES ({string.Join(", ", parameters)}, {userID}, {userID}, getdate(), getdate(), '{Unit}', '{IdVC}')";
            using (var insertCmd = new SqlCommand(insertQuery, connection, transaction))
            {
                insertCmd.Parameters.AddRange(commandParameters.ToArray());
                await insertCmd.ExecuteNonQueryAsync();
            }
        }

        private async Task SaveToTableVoucherAsync(
            string tableName,
            JsonElement data,
            string[] primaryKey,
            SqlConnection connection,
            SqlTransaction transaction,
            string Unit,
            string userID,
            string IdVC,
            bool forceInsert = true)
        {
            if (data.ValueKind == JsonValueKind.Array)
            {
                // Batch insert cho mảng object
                foreach (var row in data.EnumerateArray())
                {
                    await SaveToTableVoucherAsync(tableName, row, primaryKey, connection, transaction, Unit, userID, IdVC, forceInsert);
                }
                return;
            }

            // Lấy danh sách cột và giá trị với xử lý null thông minh
            var columns = new List<string>();
            var parameters = new List<string>();
            var commandParameters = await ProcessDataWithNullHandlingAsync(data, tableName, connection, transaction);

            // Tách ra columns và parameters từ commandParameters
            foreach (var param in commandParameters)
            {
                var columnName = param.ParameterName.TrimStart('@');
                columns.Add(columnName);
                parameters.Add(param.ParameterName);
            }

            if (forceInsert)
            {
                // Force INSERT - used for date change scenarios to preserve idGui
                var insertQuery = $"INSERT INTO {tableName} ({string.Join(", ", columns)}, user_id0, user_id2, datetime0, datetime2, unitCode, voucherCode) VALUES ({string.Join(", ", parameters)}, {userID}, {userID}, getdate(), getdate(), '{Unit}', '{IdVC}')";
                using (var insertCmd = new SqlCommand(insertQuery, connection, transaction))
                {
                    insertCmd.Parameters.AddRange(commandParameters.ToArray());
                    await insertCmd.ExecuteNonQueryAsync();
                }
            }
            else
            {
                // Use normal SaveToTableAsync logic
                await SaveToTableAsync(tableName, data, primaryKey, connection, transaction, Unit, userID, IdVC);
            }
        }


        private async Task<DynamicSaveResponse> SaveListAsync(DynamicSaveRequest request)
        {
            var response = new DynamicSaveResponse();
            var errors = new List<ValidationError>();

            try
            {
                using (var connection = new SqlConnection(_connectionString))
                {
                    await connection.OpenAsync();
                    using (var transaction = connection.BeginTransaction())
                    {
                        try
                        {
                            // Validate required fields
                            if (string.IsNullOrEmpty(request.FormId))
                            {
                                errors.Add(new ValidationError { Field = "formId", Message = "Mã form không được để trống" });
                            }

                            if (string.IsNullOrEmpty(request.Action))
                            {
                                errors.Add(new ValidationError { Field = "action", Message = "Hành động không được để trống" });
                            }

                            if (request.PrimaryKey == null || request.PrimaryKey.Length == 0)
                            {
                                errors.Add(new ValidationError { Field = "primaryKey", Message = "Khóa chính không được để trống" });
                            }

                            if (string.IsNullOrEmpty(request.Type))
                            {
                                errors.Add(new ValidationError { Field = "type", Message = "Loại dữ liệu không được để trống" });
                            }

                            if (errors.Any())
                            {
                                response.Success = false;
                                response.Errors = errors;
                                return response;
                            }

                            // Tự động tăng số cho các field cần thiết (chỉ cho type = voucher)
                            var autoIncrementResult = await AutoIncrementFieldNumberAsync(request, connection, transaction);
                            if (!autoIncrementResult)
                            {
                                _logger.LogWarning("Auto increment failed for form {FormId}, but continuing with save", request.FormId);
                            }

                            // Lấy giá trị primary key từ data
                            var primaryKeyValues = request.PrimaryKey.Select(k => request.Data.GetProperty(k).GetString()).ToArray();

                            // Xác định tên bảng dựa vào type
                            string tableName = request.FormId;
                            string detailTableName = "";
                            if (request.Type.ToLower() == "voucher")
                            {
                                if (string.IsNullOrEmpty(request.VCDate))
                                {
                                    errors.Add(new ValidationError { Field = "VCDate", Message = "Ngày chứng từ không được để trống" });
                                    response.Success = false;
                                    response.Errors = errors;
                                    return response;
                                }

                                // Chuyển đổi VCDate thành định dạng yyyyMM
                                if (DateTime.TryParse(request.VCDate, out DateTime vcDate))
                                {
                                    tableName = $"{request.FormId}${vcDate:yyyyMM}";
                                }
                                else
                                {
                                    errors.Add(new ValidationError { Field = "VCDate", Message = "Định dạng ngày chứng từ không hợp lệ" });
                                    response.Success = false;
                                    response.Errors = errors;
                                    return response;
                                }
                            }

                            // Lấy giá trị primary key từ data

                            var checkSaveProc = $"OOT$CheckSaveList${tableName}";
                            // check truoc khi luu OOT$CheckSave$<formId>
                            try
                            {

                                using (var checkCmd = new SqlCommand(checkSaveProc, connection, transaction))
                                {
                                    checkCmd.CommandType = CommandType.StoredProcedure;

                                    // 1. Truyền json master (bỏ details)
                                    string jsonMaster = JsonSerializer.Serialize(
                                        request.Data.EnumerateObject()
                                            .Where(p => p.Name != "details")
                                            .ToDictionary(p => p.Name, p => GetJsonElementValue(p.Value))
                                    );
                                    checkCmd.Parameters.Add(new SqlParameter("@jsonMaster", SqlDbType.NVarChar) { Value = jsonMaster });

                                    // 2. Truyền từng json detail nếu có
                                    if (request.Data.TryGetProperty("details", out var detailsForCheck) && detailsForCheck.ValueKind == JsonValueKind.Array)
                                    {
                                        int index = 0;
                                        foreach (var section in detailsForCheck.EnumerateArray())
                                        {
                                            if (section.TryGetProperty("data", out var detailDataCheck))
                                            {
                                                string jsonDetail = detailDataCheck.GetRawText();
                                                checkCmd.Parameters.Add(new SqlParameter($"@jsonDetail{index}", SqlDbType.NVarChar) { Value = jsonDetail });
                                                index++;
                                            }
                                        }
                                    }

                                    // 3. Truyền các biến bổ sung từ request
                                    checkCmd.Parameters.Add(new SqlParameter("@action", SqlDbType.NVarChar, 20) { Value = request.Action ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@type", SqlDbType.NVarChar, 50) { Value = request.Type ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@userId", SqlDbType.NVarChar, 50) { Value = request.UserId ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@unit", SqlDbType.NVarChar, 50) { Value = request.Unit ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@language", SqlDbType.NVarChar, 10) { Value = request.Language ?? (object)DBNull.Value });

                                    // 4. Output: kết quả kiểm tra
                                    var resultParam = new SqlParameter("@Result", SqlDbType.Int) { Direction = ParameterDirection.Output };
                                    var messageParam = new SqlParameter("@Message", SqlDbType.NVarChar, 4000) { Direction = ParameterDirection.Output };
                                    checkCmd.Parameters.Add(resultParam);
                                    checkCmd.Parameters.Add(messageParam);

                                    await checkCmd.ExecuteNonQueryAsync();

                                    if ((int?)resultParam.Value == 0)
                                    {
                                        transaction.Rollback();
                                        return new DynamicSaveResponse
                                        {
                                            Success = false,
                                            Message = messageParam.Value?.ToString() ?? "Bị từ chối bởi store check",
                                            Errors = new List<ValidationError>
                                        {
                                            new ValidationError { Field = "system", Message = messageParam.Value?.ToString() ?? "Lỗi không xác định từ store kiểm tra" }
                                        }
                                        };
                                    }
                                }
                            }
                            catch (SqlException ex) when (ex.Number == 2812) // store không tồn tại
                            {
                                _logger.LogWarning($"Stored procedure {checkSaveProc} not found. Skipping pre-check.");
                            }
                            catch (SqlException ex) when (
                                ex.Message.Contains("Conversion failed when converting the nvarchar value", StringComparison.OrdinalIgnoreCase) &&
                                ex.Message.Contains("to data type int", StringComparison.OrdinalIgnoreCase))
                            {
                                // Some legacy OOT$CheckSaveList procedures still parse numeric detail fields as INT.
                                // Skip pre-check in this specific conversion case so save flow can continue with actual table schema.
                                _logger.LogWarning(ex, "Skip pre-check {CheckProc} due to legacy INT conversion in check procedure.", checkSaveProc);
                            }
                            // Xử lý các bước trước khi lưu
                            if (request.DataProcessing?.Actions?.Post != null)
                            {
                                foreach (var step in request.DataProcessing.Actions.Post)
                                {
                                    if (string.Equals(step?.Type, "sql01", StringComparison.OrdinalIgnoreCase))
                                    {
                                        await ExecuteProcessingStepAsync(step.Query, request.Data, connection, transaction, null, request);
                                    }
                                }
                            }

                            // Build WHERE cho các thao tác kiểm tra tồn tại, update, delete
                            var where = new List<string>();
                            for (int i = 0; i < request.PrimaryKey.Length; i++)
                            {
                                where.Add($"{request.PrimaryKey[i]} = @pk{i}");
                            }
                            var whereClause = string.Join(" AND ", where);

                            if (request.Action.ToLower() == "insert")
                            {
                                // Check if record exists
                                var checkQuery = $"SELECT COUNT(*) FROM {tableName} WHERE {whereClause}";
                                using (var checkCommand = new SqlCommand(checkQuery, connection, transaction))
                                {
                                    for (int i = 0; i < request.PrimaryKey.Length; i++)
                                    {
                                        checkCommand.Parameters.AddWithValue($"@pk{i}", primaryKeyValues[i]);
                                    }
                                    var exists = Convert.ToInt32(await checkCommand.ExecuteScalarAsync()) > 0;
                                    if (exists)
                                    {
                                        errors.Add(new ValidationError { Field = string.Join(",", request.PrimaryKey), Message = $"Khóa chính đã tồn tại" });
                                        response.Success = false;
                                        response.Errors = errors;
                                        return response;
                                    }
                                }

                                // Build INSERT query for master data với xử lý null thông minh
                                var commandParameters = await ProcessDataWithNullHandlingAsync(request.Data, tableName, connection, transaction);
                                var columns = new List<string>();
                                var parameters = new List<string>();

                                // Tách ra columns và parameters từ commandParameters
                                foreach (var param in commandParameters)
                                {
                                    var columnName = param.ParameterName.TrimStart('@');
                                    columns.Add(columnName);
                                    parameters.Add(param.ParameterName);
                                }

                                var insertQuery = $"INSERT INTO {tableName} ({string.Join(", ", columns)}, user_id0, user_id2, datetime0, datetime2) VALUES ({string.Join(", ", parameters)}, {request.UserId}, {request.UserId}, getdate(), getdate())";

                                using (var command = new SqlCommand(insertQuery, connection, transaction))
                                {
                                    command.Parameters.AddRange(commandParameters.ToArray());
                                    await command.ExecuteNonQueryAsync();
                                }
                            }
                            else if (request.Action.ToLower() == "update")
                            {
                                // Check if record exists
                                var checkQuery = $"SELECT COUNT(*) FROM {tableName} WHERE {whereClause}";
                                using (var checkCommand = new SqlCommand(checkQuery, connection, transaction))
                                {
                                    for (int i = 0; i < request.PrimaryKey.Length; i++)
                                    {
                                        checkCommand.Parameters.AddWithValue($"@pk{i}", primaryKeyValues[i]);
                                    }
                                    var exists = Convert.ToInt32(await checkCommand.ExecuteScalarAsync()) > 0;
                                    if (!exists)
                                    {
                                        errors.Add(new ValidationError { Field = string.Join(",", request.PrimaryKey), Message = $"Khóa chính không tồn tại" });
                                        response.Success = false;
                                        response.Errors = errors;
                                        return response;
                                    }
                                }

                                // Build UPDATE query với xử lý null thông minh
                                var setClauses = new List<string>();
                                var allCommandParameters = await ProcessDataWithNullHandlingAsync(request.Data, tableName, connection, transaction);
                                var commandParameters = new List<SqlParameter>();

                                foreach (var param in allCommandParameters)
                                {
                                    var columnName = param.ParameterName.TrimStart('@');
                                    if (!request.PrimaryKey.Contains(columnName))
                                    {
                                        setClauses.Add($"{columnName} = {param.ParameterName}");
                                        commandParameters.Add(param);
                                    }
                                }
                                // Add PK params
                                for (int i = 0; i < request.PrimaryKey.Length; i++)
                                {
                                    commandParameters.Add(new SqlParameter($"@pk{i}", primaryKeyValues[i]));
                                }
                                var updateQuery = $"UPDATE {tableName} SET {string.Join(", ", setClauses)}, user_id2 = {request.UserId}, [datetime2] = getdate() WHERE {whereClause}";

                                using (var command = new SqlCommand(updateQuery, connection, transaction))
                                {
                                    command.Parameters.AddRange(commandParameters.ToArray());
                                    await command.ExecuteNonQueryAsync();
                                }
                            }
                            else if (request.Action.ToLower() == "update_primary_key")
                            {
                                // Handle primary key update - this is a complex operation
                                // For update_primary_key, we need to get old primary key values from the context
                                // Since primaryKeyValues are NEW values from request.Data, we need to extract OLD values

                                // The old primary key values should come from the original request context
                                // For now, we'll modify the logic to handle this properly
                                await HandlePrimaryKeyUpdateWithContextAsync(request, tableName, whereClause, primaryKeyValues, connection, transaction, errors);

                                if (errors.Any())
                                {
                                    response.Success = false;
                                    response.Errors = errors;
                                    return response;
                                }
                            }
                            // Process details if any (skip for update_primary_key as it's handled in HandlePrimaryKeyUpdateWithContextAsync)
                            if (request.Action.ToLower() != "update_primary_key" &&
                                request.Data.TryGetProperty("details", out var detailsElement) && detailsElement.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var detailElement in detailsElement.EnumerateArray())
                                {
                                    var detail = new DetailData
                                    {
                                        ControllerDetail = detailElement.GetProperty("controllerDetail").GetString(),
                                        FormIdDetail = detailElement.GetProperty("formIdDetail").GetString(),
                                        ForeignKey = detailElement.GetProperty("foreignKey").GetString(),
                                        Data = detailElement.GetProperty("data")
                                    };

                                    // Determine detail table name with partition for voucher type
                                    detailTableName = detail.FormIdDetail;
                                    if (request.Type.ToLower() == "voucher" && DateTime.TryParse(request.VCDate, out DateTime detailVcDate))
                                    {
                                        detailTableName = $"{detail.FormIdDetail}${detailVcDate:yyyyMM}";
                                    }

                                    // For update action, first delete existing detail records
                                    if (request.Action.ToLower() == "update")
                                    {
                                        // Delete existing detail records from the partitioned table
                                        // Build WHERE clause for detail deletion based on foreign key mapping
                                        var detailWhereClause = new List<string>();
                                        var detailDeleteParameters = new List<SqlParameter>();

                                        // Parse foreign key mapping (e.g., "itemCode, line_nbr")
                                        var foreignKeyFields = detail.ForeignKey.Split(',').Select(fk => fk.Trim()).ToArray();

                                        // Map foreign key fields to primary key values
                                        for (int i = 0; i < foreignKeyFields.Length; i++)
                                        {
                                            var foreignKeyField = foreignKeyFields[i];

                                            // Check if this foreign key field matches any primary key field
                                            var primaryKeyIndex = Array.IndexOf(request.PrimaryKey, foreignKeyField);
                                            if (primaryKeyIndex >= 0)
                                            {
                                                // Use the corresponding primary key value
                                                detailWhereClause.Add($"{foreignKeyField} = @fk{i}");
                                                detailDeleteParameters.Add(new SqlParameter($"@fk{i}", primaryKeyValues[primaryKeyIndex]));
                                            }
                                            else
                                            {
                                                // If foreign key field is not in primary key, we need to handle it differently
                                                // For now, we'll skip it and let the detail data handle it
                                                _logger.LogWarning("Foreign key field {ForeignKeyField} not found in primary key for detail deletion", foreignKeyField);
                                            }
                                        }

                                        if (detailWhereClause.Any())
                                        {
                                            var deleteQuery = $"DELETE FROM {detailTableName} WHERE {string.Join(" AND ", detailWhereClause)}";
                                            using (var deleteCommand = new SqlCommand(deleteQuery, connection, transaction))
                                            {
                                                deleteCommand.Parameters.AddRange(detailDeleteParameters.ToArray());
                                                await deleteCommand.ExecuteNonQueryAsync();
                                            }
                                        }
                                    }

                                    // Insert new detail records - batch insert approach
                                    var detailRows = detail.GetDetailRows().ToList();
                                    if (detailRows.Any())
                                    {
                                        // Get all unique column names from all detail rows
                                        var allDetailColumns = new HashSet<string>();
                                        foreach (var detailRow in detailRows)
                                        {
                                            foreach (var prop in detailRow.EnumerateObject())
                                            {
                                                allDetailColumns.Add(prop.Name);
                                            }
                                        }

                                        // Ensure primary key columns are included
                                        foreach (var pk in request.PrimaryKey)
                                        {
                                            allDetailColumns.Add(pk);
                                        }

                                        var detailColumns = allDetailColumns.ToList();

                                        // Build batch insert query
                                        var batchInsertQuery = $"INSERT INTO {detailTableName} ({string.Join(", ", detailColumns)}) VALUES ";
                                        var valueClauses = new List<string>();
                                        var allParameters = new List<SqlParameter>();
                                        var paramIndex = 0;

                                        foreach (var detailRow in detailRows)
                                        {
                                            var rowValues = new List<string>();

                                            foreach (var column in detailColumns)
                                            {
                                                // Check if this column is a primary key that needs to be added
                                                if (request.PrimaryKey.Contains(column))
                                                {
                                                    var pkIndex = Array.IndexOf(request.PrimaryKey, column);
                                                    if (pkIndex >= 0)
                                                    {
                                                        // Use the primary key value from master
                                                        rowValues.Add($"@pk{paramIndex}");
                                                        allParameters.Add(new SqlParameter($"@pk{paramIndex}", primaryKeyValues[pkIndex]));
                                                    }
                                                    else
                                                    {
                                                        // If primary key not found, use null
                                                        rowValues.Add($"@pk{paramIndex}");
                                                        allParameters.Add(new SqlParameter($"@pk{paramIndex}", DBNull.Value));
                                                    }
                                                }
                                                else if (detailRow.TryGetProperty(column, out var propValue))
                                                {
                                                    // Use value from detail row
                                                    rowValues.Add($"@pk{paramIndex}");
                                                    allParameters.Add(new SqlParameter($"@pk{paramIndex}", GetJsonElementValue(propValue) ?? DBNull.Value));
                                                }
                                                else
                                                {
                                                    // Column not found in detail row, use null
                                                    rowValues.Add($"@pk{paramIndex}");
                                                    allParameters.Add(new SqlParameter($"@pk{paramIndex}", DBNull.Value));
                                                }
                                                paramIndex++;
                                            }

                                            valueClauses.Add($"({string.Join(", ", rowValues)})");
                                        }

                                        batchInsertQuery += string.Join(", ", valueClauses);

                                        // Execute batch insert
                                        using (var detailCommand = new SqlCommand(batchInsertQuery, connection, transaction))
                                        {
                                            detailCommand.Parameters.AddRange(allParameters.ToArray());
                                            await detailCommand.ExecuteNonQueryAsync();
                                        }
                                    }
                                }
                            }

                            // Xử lý các bước post nếu có
                            if (request.DataProcessing?.Actions?.Post != null)
                            {
                                foreach (var step in request.DataProcessing.Actions.Post)
                                {
                                    if (string.Equals(step?.Type, "sql02", StringComparison.OrdinalIgnoreCase))
                                    {
                                        await ExecuteProcessingStepAsync(step.Query, request.Data, connection, transaction, null, request);
                                    }
                                }
                            }

                            transaction.Commit();

                            response.Success = true;
                            response.Message = "Lưu dữ liệu thành công";
                            response.Id = string.Join(",", primaryKeyValues);
                        }
                        catch (Exception ex)
                        {
                            transaction.Rollback();
                            throw;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi khi lưu dữ liệu động cho form {FormId}", request.FormId);
                response.Success = false;
                response.Message = "Đã xảy ra lỗi khi lưu dữ liệu";
                errors.Add(new ValidationError { Field = "system", Message = ex.Message });
                response.Errors = errors;
            }
            return response;
        }

        // Helper method to get value from JsonElement with proper type handling
        private async Task ExecuteProcessingStepAsync(
            string rawQuery,
            JsonElement data,
            SqlConnection connection,
            SqlTransaction transaction,
            string? generatedIdGui = null,
            DynamicSaveRequest? request = null)
        {
            if (string.IsNullOrWhiteSpace(rawQuery))
            {
                return;
            }

            var dataValues = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            foreach (var prop in data.EnumerateObject())
            {
                if (prop.NameEquals("details"))
                {
                    continue;
                }

                dataValues[prop.Name] = GetJsonElementValue(prop.Value);
            }

            if (!string.IsNullOrWhiteSpace(generatedIdGui))
            {
                dataValues["idGui"] = generatedIdGui;
            }

            // Bổ sung context từ root request để SQL post-action dùng được @unit/@userId...
            if (request != null)
            {
                if (!string.IsNullOrWhiteSpace(request.UserId))
                {
                    dataValues["userId"] = request.UserId;
                }

                if (!string.IsNullOrWhiteSpace(request.Unit))
                {
                    dataValues["unit"] = request.Unit;

                    // Alias thường dùng ở SQL và cột dữ liệu
                    if (!dataValues.ContainsKey("unitCode") || dataValues["unitCode"] == null || string.IsNullOrWhiteSpace(dataValues["unitCode"]?.ToString()))
                    {
                        dataValues["unitCode"] = request.Unit;
                    }
                }

                if (!string.IsNullOrWhiteSpace(request.Language))
                {
                    dataValues["language"] = request.Language;
                }

                if (!string.IsNullOrWhiteSpace(request.IdVC))
                {
                    dataValues["idVC"] = request.IdVC;

                    if (!dataValues.ContainsKey("voucherCode") || dataValues["voucherCode"] == null || string.IsNullOrWhiteSpace(dataValues["voucherCode"]?.ToString()))
                    {
                        dataValues["voucherCode"] = request.IdVC;
                    }
                }

                if (!string.IsNullOrWhiteSpace(request.VCDate))
                {
                    dataValues["VCDate"] = request.VCDate;
                }
            }

            // Replace quoted placeholders directly: N'@idGui' / '@idGui' => N'actual-value' / 'actual-value'
            // This keeps compatibility with existing JSON config style.
            var normalizedQuery = Regex.Replace(
                rawQuery,
                @"(N)?'@([A-Za-z_][A-Za-z0-9_]*)'",
                match =>
                {
                    var hasNPrefix = string.Equals(match.Groups[1].Value, "N", StringComparison.OrdinalIgnoreCase);
                    var paramName = match.Groups[2].Value;

                    dataValues.TryGetValue(paramName, out var value);
                    if (value == null || value == DBNull.Value)
                    {
                        return "NULL";
                    }

                    var literal = value.ToString()?.Replace("'", "''") ?? string.Empty;
                    return hasNPrefix ? $"N'{literal}'" : $"'{literal}'";
                },
                RegexOptions.IgnoreCase
            );

            // Bind remaining unquoted @params (if any)
            var tokenMatches = Regex.Matches(normalizedQuery, @"(?<!@)@([A-Za-z_][A-Za-z0-9_]*)");

            using (var command = new SqlCommand(normalizedQuery, connection, transaction))
            {
                var addedParams = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (Match match in tokenMatches)
                {
                    if (!match.Success)
                    {
                        continue;
                    }

                    var name = match.Groups[1].Value;
                    if (string.IsNullOrWhiteSpace(name) || addedParams.Contains(name))
                    {
                        continue;
                    }

                    dataValues.TryGetValue(name, out var value);
                    command.Parameters.AddWithValue($"@{name}", value ?? DBNull.Value);
                    addedParams.Add(name);
                }

                await command.ExecuteNonQueryAsync();
            }
        }

        private object GetJsonElementValue(JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.String:
                    return element.GetString();
                case JsonValueKind.Number:
                    if (element.TryGetInt32(out int intValue))
                        return intValue;
                    if (element.TryGetInt64(out long longValue))
                        return longValue;
                    if (element.TryGetDouble(out double doubleValue))
                        return doubleValue;
                    if (element.TryGetDecimal(out decimal decimalValue))
                        return decimalValue;
                    return element.GetString(); // fallback to string
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.False:
                    return false;
                case JsonValueKind.Null:
                    return null;
                default:
                    return element.GetString(); // fallback to string for other types
            }
        }

        private string GetJsonElementValueV2(JsonElement element)
        {
            try
            {
                object rawValue = null;

                switch (element.ValueKind)
                {
                    case JsonValueKind.String:
                        rawValue = element.GetString();
                        break;
                    case JsonValueKind.Number:
                        if (element.TryGetInt32(out int intValue))
                            rawValue = intValue;
                        else if (element.TryGetInt64(out long longValue))
                            rawValue = longValue;
                        else if (element.TryGetDouble(out double doubleValue))
                            rawValue = doubleValue;
                        else if (element.TryGetDecimal(out decimal decimalValue))
                            rawValue = decimalValue;
                        else
                            rawValue = element.GetRawText(); // Fallback raw cho number lạ
                        break;
                    case JsonValueKind.True:
                        rawValue = true;
                        break;
                    case JsonValueKind.False:
                        rawValue = false;
                        break;
                    case JsonValueKind.Null:
                        rawValue = null;
                        break;
                    case JsonValueKind.Object:
                    case JsonValueKind.Array:
                        rawValue = element.GetRawText(); // Raw JSON string, an toàn không throw
                        break;
                    default:
                        rawValue = element.GetRawText(); // An toàn cho undefined/other
                        break;
                }

                // Luôn convert sang string non-null để tránh NullRef ở .ToString()
                return rawValue?.ToString() ?? "null";
            }
            catch (Exception ex)
            {
                // Log nếu có exception (ví dụ: GetString() fail ở case lạ)
                _logger?.LogError(ex, "Lỗi trong GetJsonElementValue cho ValueKind {Kind}", element.ValueKind);
                return "error"; // Fallback string
            }
        }

        /// <summary>
        /// Xử lý giá trị null dựa trên kiểu dữ liệu của cột trong database
        /// Cột string null -> lưu rỗng ("")
        /// Cột số null -> lưu 0
        /// </summary>
        /// <param name="columnName">Tên cột</param>
        /// <param name="jsonValue">Giá trị từ JSON</param>
        /// <param name="tableName">Tên bảng</param>
        /// <param name="connection">Kết nối SQL</param>
        /// <param name="transaction">Transaction SQL</param>
        /// <returns>Giá trị đã được xử lý null</returns>
        private async Task<object> ProcessNullValueByColumnTypeAsync(
            string columnName,
            JsonElement jsonValue,
            string tableName,
            SqlConnection connection,
            SqlTransaction transaction)
        {
            // Nếu không phải null thì trả về giá trị bình thường
            if (jsonValue.ValueKind != JsonValueKind.Null)
            {
                return GetJsonElementValue(jsonValue) ?? DBNull.Value;
            }

            try
            {
                // Lấy thông tin kiểu dữ liệu của cột từ INFORMATION_SCHEMA.COLUMNS
                var columnInfoQuery = @"
                    SELECT DATA_TYPE, IS_NULLABLE 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_NAME = @TableName AND COLUMN_NAME = @ColumnName";

                using (var cmd = new SqlCommand(columnInfoQuery, connection, transaction))
                {
                    cmd.Parameters.AddWithValue("@TableName", tableName);
                    cmd.Parameters.AddWithValue("@ColumnName", columnName);

                    using (var reader = await cmd.ExecuteReaderAsync())
                    {
                        if (await reader.ReadAsync())
                        {
                            var dataType = reader["DATA_TYPE"].ToString().ToLower();
                            var isNullable = reader["IS_NULLABLE"].ToString().ToUpper() == "YES";

                            // Nếu cột không cho phép null, xử lý theo kiểu dữ liệu
                            if (!isNullable)
                            {
                                return GetDefaultValueForDataType(dataType);
                            }

                            // Nếu cột cho phép null, xử lý theo yêu cầu:
                            // - String: lưu rỗng
                            // - Number: lưu 0
                            return GetNullHandlingValueForDataType(dataType);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Không thể lấy thông tin cột {ColumnName} từ bảng {TableName}. Sử dụng DBNull.Value", columnName, tableName);
            }

            // Fallback: trả về DBNull.Value nếu không lấy được thông tin cột
            return DBNull.Value;
        }

        /// <summary>
        /// Xử lý nhiều cột cùng lúc để tối ưu performance
        /// </summary>
        /// <param name="data">Dữ liệu JSON</param>
        /// <param name="tableName">Tên bảng</param>
        /// <param name="connection">Kết nối SQL</param>
        /// <param name="transaction">Transaction SQL</param>
        /// <returns>Dictionary chứa các SqlParameter đã được xử lý null</returns>
        private async Task<List<SqlParameter>> ProcessDataWithNullHandlingAsync(
            JsonElement data,
            string tableName,
            SqlConnection connection,
            SqlTransaction transaction)
        {
            var parameters = new List<SqlParameter>();

            // Lấy thông tin tất cả các cột của bảng một lần
            var columnInfoMap = await GetTableColumnInfoAsync(tableName, connection, transaction);

            foreach (var prop in data.EnumerateObject())
            {
                if (prop.Name == "details") continue; // Bỏ qua field details

                object paramValue;

                // Nếu giá trị null và có thông tin cột
                if (prop.Value.ValueKind == JsonValueKind.Null && columnInfoMap.ContainsKey(prop.Name.ToLower()))
                {
                    var columnInfo = columnInfoMap[prop.Name.ToLower()];

                    // Nếu cột không cho phép null
                    if (!columnInfo.IsNullable)
                    {
                        paramValue = GetDefaultValueForDataType(columnInfo.DataType);
                    }
                    else
                    {
                        // Xử lý null theo yêu cầu: string -> rỗng, number -> 0
                        paramValue = GetNullHandlingValueForDataType(columnInfo.DataType);
                    }
                }
                else
                {
                    paramValue = GetJsonElementValue(prop.Value) ?? DBNull.Value;
                }

                parameters.Add(new SqlParameter($"@{prop.Name}", paramValue));
            }

            return parameters;
        }

        /// <summary>
        /// Lấy thông tin tất cả các cột của bảng
        /// </summary>
        private async Task<Dictionary<string, (string DataType, bool IsNullable)>> GetTableColumnInfoAsync(
            string tableName,
            SqlConnection connection,
            SqlTransaction transaction)
        {
            var result = new Dictionary<string, (string DataType, bool IsNullable)>();

            var query = @"
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = @TableName";

            using (var cmd = new SqlCommand(query, connection, transaction))
            {
                cmd.Parameters.AddWithValue("@TableName", tableName);

                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        var columnName = reader["COLUMN_NAME"].ToString().ToLower();
                        var dataType = reader["DATA_TYPE"].ToString().ToLower();
                        var isNullable = reader["IS_NULLABLE"].ToString().ToUpper() == "YES";

                        result[columnName] = (dataType, isNullable);
                    }
                }
            }

            return result;
        }

        /// <summary>
        /// Trả về giá trị mặc định cho kiểu dữ liệu (khi cột không cho phép null)
        /// </summary>
        private object GetDefaultValueForDataType(string dataType)
        {
            return dataType.ToLower() switch
            {
                // Kiểu số
                "int" or "integer" or "bigint" or "smallint" or "tinyint" => 0,
                "decimal" or "numeric" or "money" or "smallmoney" => 0.0m,
                "float" or "real" => 0.0,
                "bit" => false,

                // Kiểu chuỗi
                "varchar" or "nvarchar" or "char" or "nchar" or "text" or "ntext" => "",

                // Kiểu ngày tháng
                "datetime" or "datetime2" or "date" or "time" or "smalldatetime" => DateTime.MinValue,
                "datetimeoffset" => DateTimeOffset.MinValue,

                // Kiểu GUID
                "uniqueidentifier" => Guid.Empty,

                // Mặc định
                _ => ""
            };
        }

        /// <summary>
        /// Xử lý giá trị null theo yêu cầu: string -> rỗng, number -> 0
        /// </summary>
        private object GetNullHandlingValueForDataType(string dataType)
        {
            return dataType.ToLower() switch
            {
                // Kiểu số: null -> 0
                "int" or "integer" or "bigint" or "smallint" or "tinyint" => 0,
                "decimal" or "numeric" or "money" or "smallmoney" => 0.0m,
                "float" or "real" => 0.0,
                "bit" => false,

                // Kiểu chuỗi: null -> rỗng
                "varchar" or "nvarchar" or "char" or "nchar" or "text" or "ntext" => "",

                // Các kiểu khác: giữ nguyên DBNull
                _ => DBNull.Value
            };
        }

        /// <summary>
        /// Function demo để test xử lý null values
        /// Có thể gọi từ controller để kiểm tra
        /// </summary>
        /// <param name="formId">Tên bảng (ví dụ: "goodsReceipt")</param>
        /// <param name="testData">Dữ liệu JSON test có chứa null values</param>
        /// <returns>Kết quả xử lý null</returns>
        public async Task<Dictionary<string, object>> TestNullHandlingAsync(string formId, JsonElement testData)
        {
            var result = new Dictionary<string, object>();

            try
            {
                using (var connection = new SqlConnection(_connectionString))
                {
                    await connection.OpenAsync();
                    using (var transaction = connection.BeginTransaction())
                    {
                        // Lấy tên bảng thực tế (có thể có partition)
                        var tableName = $"{formId}$000000"; // Sử dụng partition mặc định

                        // Lấy thông tin cột
                        var columnInfo = await GetTableColumnInfoAsync(tableName, connection, transaction);

                        result["TableName"] = tableName;
                        result["ColumnInfo"] = columnInfo;
                        result["ProcessedData"] = new Dictionary<string, object>();

                        // Xử lý từng field trong test data
                        foreach (var prop in testData.EnumerateObject())
                        {
                            if (prop.Name == "details") continue;

                            var processedValue = prop.Value.ValueKind == JsonValueKind.Null &&
                                                columnInfo.ContainsKey(prop.Name.ToLower())
                                ? (columnInfo[prop.Name.ToLower()].IsNullable
                                    ? GetNullHandlingValueForDataType(columnInfo[prop.Name.ToLower()].DataType)
                                    : GetDefaultValueForDataType(columnInfo[prop.Name.ToLower()].DataType))
                                : GetJsonElementValue(prop.Value);

                            ((Dictionary<string, object>)result["ProcessedData"])[prop.Name] = new
                            {
                                OriginalValue = prop.Value.ValueKind == JsonValueKind.Null ? "NULL" : prop.Value.ToString(),
                                ProcessedValue = processedValue,
                                DataType = columnInfo.ContainsKey(prop.Name.ToLower())
                                    ? columnInfo[prop.Name.ToLower()].DataType
                                    : "UNKNOWN",
                                IsNullable = columnInfo.ContainsKey(prop.Name.ToLower())
                                    ? columnInfo[prop.Name.ToLower()].IsNullable
                                    : false
                            };
                        }

                        transaction.Rollback(); // Không commit, chỉ test
                    }
                }
            }
            catch (Exception ex)
            {
                result["Error"] = ex.Message;
                _logger.LogError(ex, "Error testing null handling for form {FormId}", formId);
            }

            return result;
        }

        // Helper method to get value from SqlDataReader with null handling
        private object GetReaderValue(SqlDataReader reader, int index)
        {
            if (reader.IsDBNull(index))
            {
                // Get the data type to determine default value
                var dataType = reader.GetFieldType(index);
                if (dataType == typeof(string) || dataType == typeof(char))
                {
                    return string.Empty;
                }
                else if (dataType == typeof(int) || dataType == typeof(long) ||
                         dataType == typeof(short) || dataType == typeof(byte))
                {
                    return 0;
                }
                else if (dataType == typeof(decimal) || dataType == typeof(double) ||
                         dataType == typeof(float))
                {
                    return 0.0m;
                }
                else if (dataType == typeof(DateTime))
                {
                    return DateTime.MinValue;
                }
                else if (dataType == typeof(bool))
                {
                    return false;
                }
                else
                {
                    return null;
                }
            }
            return reader.GetValue(index);
        }

        public async Task<DynamicDeleteResponse> DeleteDynamicAsync(DynamicDeleteRequest request)
        {
            var response = new DynamicDeleteResponse();
            var errors = new List<ValidationError>();

            try
            {
                using (var connection = new SqlConnection(_connectionString))
                {
                    await connection.OpenAsync();
                    using (var transaction = connection.BeginTransaction())
                    {
                        try
                        {
                            // Validate required fields
                            if (string.IsNullOrEmpty(request.FormId))
                            {
                                errors.Add(new ValidationError { Field = "formId", Message = "Mã form không được để trống" });
                            }

                            if (string.IsNullOrEmpty(request.Action))
                            {
                                errors.Add(new ValidationError { Field = "action", Message = "Hành động không được để trống" });
                            }

                            if (request.PrimaryKey == null || request.PrimaryKey.Length == 0)
                            {
                                errors.Add(new ValidationError { Field = "primaryKey", Message = "Khóa chính không được để trống" });
                            }

                            if (request.Value == null || request.Value.Length == 0)
                            {
                                errors.Add(new ValidationError { Field = "value", Message = "Giá trị không được để trống" });
                            }

                            if (request.ListTable == null || !request.ListTable.Any())
                            {
                                errors.Add(new ValidationError { Field = "listTable", Message = "Danh sách bảng không được để trống" });
                            }

                            if (errors.Any())
                            {
                                response.Success = false;
                                response.Errors = errors;
                                return response;
                            }

                            // Xác định tên bảng dựa vào type
                            string tableName = request.FormId;

                            var beforeDelete = $"OOT$beforeDelete${request.FormId}";

                            try
                            {

                                using (var checkCmd = new SqlCommand(beforeDelete, connection, transaction))
                                {
                                    checkCmd.CommandType = CommandType.StoredProcedure;
                                    for (int i = 0; i < request.PrimaryKey.Length; i++)
                                    {
                                        checkCmd.Parameters.AddWithValue($"@{request.PrimaryKey[i]}", request.Value[i]);
                                        //checkCmd.Parameters.Add(new SqlParameter($"@pk{i}", SqlDbType.NVarChar) { Value = request.Value[i] });
                                    }

                                    // 3. Truyền các biến bổ sung từ request
                                    checkCmd.Parameters.Add(new SqlParameter("@action", SqlDbType.NVarChar, 20) { Value = request.Action ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@type", SqlDbType.NVarChar, 50) { Value = request.Type ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@userId", SqlDbType.NVarChar, 50) { Value = request.UserId ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@unit", SqlDbType.NVarChar, 50) { Value = request.Unit ?? (object)DBNull.Value });
                                    checkCmd.Parameters.Add(new SqlParameter("@language", SqlDbType.NVarChar, 10) { Value = request.Language ?? (object)DBNull.Value });

                                    // 4. Output: kết quả kiểm tra
                                    var resultParam = new SqlParameter("@Result", SqlDbType.Int) { Direction = ParameterDirection.Output };
                                    var messageParam = new SqlParameter("@Message", SqlDbType.NVarChar, 4000) { Direction = ParameterDirection.Output };
                                    checkCmd.Parameters.Add(resultParam);
                                    checkCmd.Parameters.Add(messageParam);

                                    await checkCmd.ExecuteNonQueryAsync();
                                    if ((int?)resultParam.Value == 0)
                                    {
                                        transaction.Rollback();
                                        errors.Add(new ValidationError { Field = "formId", Message = messageParam.Value.ToString() });
                                        response.Success = false;
                                        response.Errors = errors;
                                        return response;
                                    }

                                }
                            }
                            catch (SqlException ex) when (ex.Number == 2812) // store không tồn tại
                            {
                                _logger.LogWarning($"Stored procedure {beforeDelete} not found. Skipping pre-check.");
                            }

                            if (request.Type?.ToLower() == "voucher")
                            {
                                if (string.IsNullOrEmpty(request.VCDate))
                                {
                                    errors.Add(new ValidationError { Field = "VCDate", Message = "Ngày chứng từ không được để trống" });
                                    response.Success = false;
                                    response.Errors = errors;
                                    return response;
                                }

                                // Chuyển đổi VCDate thành định dạng yyyyMM
                                if (DateTime.TryParse(request.VCDate, out DateTime vcDate))
                                {
                                    tableName = $"{request.FormId}${vcDate:yyyyMM}";
                                }
                                else
                                {
                                    errors.Add(new ValidationError { Field = "VCDate", Message = "Định dạng ngày chứng từ không hợp lệ" });
                                    response.Success = false;
                                    response.Errors = errors;
                                    return response;
                                }
                            }


                            // Delete data from each table

                            var where = new List<string>();
                            var tableDelete = "";
                            for (int i = 0; i < request.PrimaryKey.Length; i++)
                            {
                                where.Add($"{request.PrimaryKey[i]} = @pk{i}");
                            }
                            if (request.Type?.ToLower() == "voucher")
                            {
                                // Chuyển đổi VCDate thành định dạng yyyyMM
                                if (DateTime.TryParse(request.VCDate, out DateTime vcDate))
                                {
                                    tableDelete = $"{request.FormId}${vcDate:yyyyMM}";
                                }
                                else
                                {
                                    errors.Add(new ValidationError { Field = "VCDate", Message = "Định dạng ngày chứng từ không hợp lệ" });
                                    response.Success = false;
                                    response.Errors = errors;
                                    return response;
                                }

                            }
                            else
                            {
                                tableDelete = request.FormId;
                            }
                            var whereClause = string.Join(" AND ", where);
                            var deleteQuery = $"update {tableDelete} set status = '*' WHERE {whereClause}";
                            using (var command = new SqlCommand(deleteQuery, connection, transaction))
                            {
                                for (int i = 0; i < request.PrimaryKey.Length; i++)
                                {
                                    command.Parameters.AddWithValue($"@pk{i}", request.Value[i]);
                                }
                                await command.ExecuteNonQueryAsync();
                            }

                            transaction.Commit();

                            response.Success = true;
                            response.Message = "Xóa dữ liệu thành công";
                            response.Id = string.Join(",", request.Value);
                        }
                        catch (Exception ex)
                        {
                            transaction.Rollback();
                            throw;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi khi xóa dữ liệu động cho form {FormId}", request.FormId);
                response.Success = false;
                response.Message = "Đã xảy ra lỗi khi xóa dữ liệu";
                errors.Add(new ValidationError { Field = "system", Message = ex.Message });
                response.Errors = errors;
            }

            return response;
        }

        private async Task HandlePrimaryKeyUpdateWithContextAsync(
            DynamicSaveRequest request,
            string tableName,
            string whereClause,
            string[] newPrimaryKeyValues,
            SqlConnection connection,
            SqlTransaction transaction,
            List<ValidationError> errors)
        {
            try
            {
                _logger.LogInformation("Handling primary key update for table {TableName}", tableName);

                // 1. Validate: Check if new primary key already exists (to avoid duplicates)
                var newWhereClause = string.Join(" AND ", request.PrimaryKey.Select((pk, i) => $"{pk} = @newpk{i}"));
                var checkNewQuery = $"SELECT COUNT(*) FROM {tableName} WHERE {newWhereClause}";
                using (var checkNewCommand = new SqlCommand(checkNewQuery, connection, transaction))
                {
                    for (int i = 0; i < request.PrimaryKey.Length; i++)
                    {
                        checkNewCommand.Parameters.AddWithValue($"@newpk{i}", (object)newPrimaryKeyValues[i] ?? DBNull.Value);
                    }
                    var newExists = Convert.ToInt32(await checkNewCommand.ExecuteScalarAsync()) > 0;
                    if (newExists)
                    {
                        errors.Add(new ValidationError { Field = "newPrimaryKey", Message = "Bản ghi với khóa chính mới đã tồn tại" });
                        return;
                    }
                }

                // 2. Get old primary key values from request.OriginalPrimaryKeyValues
                if (request.OriginalPrimaryKeyValues == null || request.OriginalPrimaryKeyValues.Count == 0)
                {
                    errors.Add(new ValidationError { Field = "originalPrimaryKey", Message = "Thiếu thông tin khóa chính cũ" });
                    return;
                }

                // Extract old primary key values
                string[] oldPrimaryKeyValues = new string[request.PrimaryKey.Length];
                for (int i = 0; i < request.PrimaryKey.Length; i++)
                {
                    var pkField = request.PrimaryKey[i];
                    if (request.OriginalPrimaryKeyValues.TryGetValue(pkField, out var oldValue))
                    {
                        oldPrimaryKeyValues[i] = oldValue?.ToString() ?? "";
                    }
                    else
                    {
                        errors.Add(new ValidationError { Field = pkField, Message = $"Không tìm thấy giá trị khóa chính cũ cho trường {pkField}" });
                        return;
                    }
                }

                // 3. Verify old record exists
                var oldWhereClause = string.Join(" AND ", request.PrimaryKey.Select((pk, i) => $"{pk} = @oldpk{i}"));
                var checkOldQuery = $"SELECT COUNT(*) FROM {tableName} WHERE {oldWhereClause}";
                using (var checkOldCommand = new SqlCommand(checkOldQuery, connection, transaction))
                {
                    for (int i = 0; i < request.PrimaryKey.Length; i++)
                    {
                        checkOldCommand.Parameters.AddWithValue($"@oldpk{i}", (object)oldPrimaryKeyValues[i] ?? DBNull.Value);
                    }
                    var oldExists = Convert.ToInt32(await checkOldCommand.ExecuteScalarAsync()) > 0;
                    if (!oldExists)
                    {
                        errors.Add(new ValidationError { Field = "originalPrimaryKey", Message = "Không tìm thấy bản ghi với khóa chính cũ" });
                        return;
                    }
                }

                // 4. Update master table - including primary key fields
                var setClauses = new List<string>();
                var commandParameters = new List<SqlParameter>();

                foreach (var prop in request.Data.EnumerateObject())
                {
                    if (prop.Name != "details") // Include ALL fields, including primary key fields
                    {
                        setClauses.Add($"{prop.Name} = @{prop.Name}");
                        commandParameters.Add(new SqlParameter($"@{prop.Name}", GetJsonElementValue(prop.Value) ?? DBNull.Value));
                    }
                }

                // Add old PK params for WHERE clause
                for (int i = 0; i < request.PrimaryKey.Length; i++)
                {
                    commandParameters.Add(new SqlParameter($"@oldpk{i}", (object)oldPrimaryKeyValues[i] ?? DBNull.Value));
                }

                var updateQuery = $"UPDATE {tableName} SET {string.Join(", ", setClauses)}, user_id2 = {request.UserId}, [datetime2] = getdate() WHERE {oldWhereClause}";

                using (var command = new SqlCommand(updateQuery, connection, transaction))
                {
                    command.Parameters.AddRange(commandParameters.ToArray());
                    var rowsAffected = await command.ExecuteNonQueryAsync();

                    if (rowsAffected == 0)
                    {
                        errors.Add(new ValidationError { Field = "primaryKeyUpdate", Message = "Không tìm thấy bản ghi để cập nhật khóa chính" });
                        return;
                    }
                }

                // 5. Update detail records foreign keys if any
                await UpdateDetailForeignKeysAsync(request, oldPrimaryKeyValues, newPrimaryKeyValues, connection, transaction);

                _logger.LogInformation("Successfully updated primary key for {TableName}. Old PK: [{OldPK}] -> New PK: [{NewPK}]",
                    tableName, string.Join(",", oldPrimaryKeyValues), string.Join(",", newPrimaryKeyValues));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating primary key for table {TableName}", tableName);
                errors.Add(new ValidationError { Field = "primaryKeyUpdate", Message = $"Lỗi khi cập nhật khóa chính: {ex.Message}" });
                throw;
            }
        }

        private async Task UpdateDetailForeignKeysAsync(
            DynamicSaveRequest request,
            string[] oldPrimaryKeyValues,
            string[] newPrimaryKeyValues,
            SqlConnection connection,
            SqlTransaction transaction)
        {
            if (!request.Data.TryGetProperty("details", out var detailsElement) || detailsElement.ValueKind != JsonValueKind.Array)
                return;

            foreach (var detailElement in detailsElement.EnumerateArray())
            {
                var detail = new DetailData
                {
                    ControllerDetail = detailElement.GetProperty("controllerDetail").GetString(),
                    FormIdDetail = detailElement.GetProperty("formIdDetail").GetString(),
                    ForeignKey = detailElement.GetProperty("foreignKey").GetString(),
                    Data = detailElement.GetProperty("data")
                };

                // Determine detail table name with partition for voucher type
                var detailTableName = detail.FormIdDetail;
                if (request.Type.ToLower() == "voucher" && DateTime.TryParse(request.VCDate, out DateTime detailVcDate))
                {
                    detailTableName = $"{detail.FormIdDetail}${detailVcDate:yyyyMM}";
                }

                // Parse foreign key mapping (e.g., "itemCode,customerCode")
                var foreignKeyFields = detail.ForeignKey.Split(',').Select(fk => fk.Trim()).ToArray();

                // Build UPDATE query to change foreign key values
                var updateClauses = new List<string>();
                var updateParams = new List<SqlParameter>();
                var whereParams = new List<SqlParameter>();
                var whereClause = new List<string>();

                for (int i = 0; i < foreignKeyFields.Length; i++)
                {
                    var foreignKeyField = foreignKeyFields[i];
                    var primaryKeyIndex = Array.IndexOf(request.PrimaryKey, foreignKeyField);

                    if (primaryKeyIndex >= 0)
                    {
                        // This foreign key field matches a primary key field
                        updateClauses.Add($"{foreignKeyField} = @newfk{i}");
                        updateParams.Add(new SqlParameter($"@newfk{i}", (object)newPrimaryKeyValues[primaryKeyIndex] ?? DBNull.Value));

                        whereClause.Add($"{foreignKeyField} = @oldfk{i}");
                        whereParams.Add(new SqlParameter($"@oldfk{i}", (object)oldPrimaryKeyValues[primaryKeyIndex] ?? DBNull.Value));
                    }
                }

                if (updateClauses.Any() && whereClause.Any())
                {
                    var updateQuery = $"UPDATE {detailTableName} SET {string.Join(", ", updateClauses)} WHERE {string.Join(" AND ", whereClause)}";

                    using (var updateCommand = new SqlCommand(updateQuery, connection, transaction))
                    {
                        updateCommand.Parameters.AddRange(updateParams.ToArray());
                        updateCommand.Parameters.AddRange(whereParams.ToArray());

                        var affectedRows = await updateCommand.ExecuteNonQueryAsync();
                        _logger.LogInformation("Updated {RowCount} detail records in {TableName} for primary key change",
                            affectedRows, detailTableName);
                    }
                }
            }
        }

        /// <summary>
        /// Xử lý file attachments sau khi save form thành công
        /// </summary>
        private async Task ProcessFileAttachmentsAsync(DynamicSaveRequest request, DynamicSaveResponse saveResponse)
        {
            if (request.FileAttachments == null) return;

            var controller = request.Controller;
            var sysKey = BuildSysKey(request);

            // 1. Upload files mới
            if (request.FileAttachments.NewFiles?.Count > 0)
            {
                foreach (var newFile in request.FileAttachments.NewFiles)
                {
                    try
                    {
                        // Convert base64 to byte array
                        var fileContent = Convert.FromBase64String(newFile.FileContent);

                        var fileAttachment = new FileAttachment
                        {
                            Controller = controller,
                            SysKey = sysKey,
                            FileName = newFile.FileName,
                            FileContent = fileContent,
                            ContentType = newFile.ContentType
                        };

                        await _attachedFileRepository.UploadFileAsync(fileAttachment);
                        _logger.LogInformation("Uploaded file {FileName} for {Controller}/{SysKey}",
                            newFile.FileName, controller, sysKey);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error uploading file {FileName} for {Controller}/{SysKey}",
                            newFile.FileName, controller, sysKey);
                        throw; // Re-throw to be caught by parent method
                    }
                }
            }

            // 2. Xóa files đã đánh dấu
            if (request.FileAttachments.FilesToDelete?.Count > 0)
            {
                foreach (var fileName in request.FileAttachments.FilesToDelete)
                {
                    try
                    {
                        await _attachedFileRepository.DeleteFileAsync(controller, sysKey, fileName);
                        _logger.LogInformation("Deleted file {FileName} for {Controller}/{SysKey}",
                            fileName, controller, sysKey);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error deleting file {FileName} for {Controller}/{SysKey}",
                            fileName, controller, sysKey);
                        // Continue with other files even if one fails
                    }
                }
            }
        }

        /// <summary>
        /// Build sysKey từ primary key values trong request
        /// </summary>
        private string BuildSysKey(DynamicSaveRequest request)
        {
            if (request.PrimaryKey == null || request.PrimaryKey.Length == 0)
                return string.Empty;

            var keyValues = new List<string>();
            foreach (var pkField in request.PrimaryKey)
            {
                if (request.Data.TryGetProperty(pkField, out var pkValue))
                {
                    var stringValue = pkValue.GetString() ?? string.Empty;
                    keyValues.Add(stringValue.Trim());
                }
                else
                {
                    keyValues.Add(string.Empty);
                }
            }

            return string.Join("|", keyValues);
        }

        public async Task<ServiceResponse<string>> GetNextFieldNumberAsync(string controller, string field, string formId = null)
        {
            try
            {
                using var connection = new SqlConnection(_connectionString);
                await connection.OpenAsync();

                //Bắt đầu transaction để đảm bảo tính nhất quán
                using var transaction = connection.BeginTransaction();

                try
                {
                    // Lấy thông tin cấu hình field với UPDLOCK, ROWLOCK để tránh race condition
                    var configSql = @"
                        SELECT Controller, VoucherCode, Field, CurrentNumber, Prefix, Suffix, NumberLength, 
                               DateFormat, ResetPeriod, LastResetDate
                        FROM VoucherSequence WITH (UPDLOCK, ROWLOCK)
                        WHERE Controller = @Controller and Field = @Field";

                    var config = await connection.QueryFirstOrDefaultAsync(configSql, new { Controller = controller, Field = field }, transaction);

                    if (config == null)
                    {
                        return ServiceResponse<string>.CreateError($"Chưa khai báo thông tin Field: {field} và Controller: {controller}", 404);
                    }

                    var currentDate = DateTime.Now;
                    var shouldReset = false;
                    var newNumber = config.CurrentNumber + 1;

                    // Xử lý logic reset dựa trên ResetPeriod
                    if (!string.IsNullOrEmpty(config.ResetPeriod))
                    {
                        // Xử lý an toàn LastResetDate từ dynamic object
                        DateTime? lastResetDate = SafeParseDynamicDateTime(config.LastResetDate);

                        if (lastResetDate == null)
                        {
                            _logger.LogDebug($"LastResetDate null hoặc không hợp lệ cho field {field}, controller {controller}");
                        }

                        // Nếu LastResetDate null (lần đầu tiên) hoặc cần reset theo period
                        if (!lastResetDate.HasValue)
                        {
                            // Lần đầu tiên sử dụng, reset về 1
                            shouldReset = true;
                        }
                        else
                        {
                            // Kiểm tra xem có cần reset theo period không
                            switch (config.ResetPeriod.ToUpper())
                            {
                                case "YEAR":
                                    shouldReset = currentDate.Year > lastResetDate.Value.Year;
                                    break;
                                case "MONTH":
                                    shouldReset = currentDate.Year > lastResetDate.Value.Year ||
                                                 currentDate.Month > lastResetDate.Value.Month;
                                    break;
                                case "DAY":
                                    shouldReset = currentDate.Date > lastResetDate.Value.Date;
                                    break;
                            }
                        }
                    }

                    if (shouldReset)
                    {
                        newNumber = 1;
                    }

                    // Tạo voucher number theo format
                    var voucherNumber = BuildVoucherNumber(config.Prefix, config.Suffix,
                        newNumber, config.NumberLength, config.DateFormat, currentDate);

                    // Cập nhật số hiện tại trong database
                    var updateSql = @"
                    UPDATE VoucherSequence 
                    SET CurrentNumber = @NewNumber, 
                        LastResetDate = @CurrentDate,
                        UpdatedDate = @CurrentDate
                    WHERE Controller = @Controller and Field = @Field";

                    await connection.ExecuteAsync(updateSql, new
                    {
                        NewNumber = newNumber,
                        CurrentDate = currentDate,
                        Controller = controller,
                        Field = field
                    }, transaction);

                    transaction.Commit();
                    return ServiceResponse<string>.CreateSuccess(voucherNumber, "Lấy số tiếp theo thành công");
                }
                catch (Exception ex)
                {
                    transaction.Rollback();
                    _logger.LogError(ex, $"Lỗi khi tạo số tiếp theo cho field {field} của controller {controller}");
                    return ServiceResponse<string>.CreateError($"Lỗi khi tạo số tiếp theo: {ex.Message}", 500);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Lỗi khi tăng tự động cho field {field} của controller {controller}");
                return ServiceResponse<string>.CreateError($"Lỗi hệ thống: {ex.Message}", 500);
            }
        }

        /// <summary>
        /// Lấy số chứng từ tiếp theo để gợi ý (không tăng số trong VoucherSequence)
        /// </summary>
        /// <param name="controller">Tên controller</param>
        /// <param name="field">Tên field</param>
        /// <param name="formId">ID form (optional)</param>
        /// <returns>Số chứng từ gợi ý</returns>
        public async Task<ServiceResponse<string>> GetNextFieldNumberPreviewAsync(string controller, string field, string formId = null)
        {
            try
            {
                using var connection = new SqlConnection(_connectionString);
                await connection.OpenAsync();

                // Lấy thông tin cấu hình field (không dùng UPDLOCK, ROWLOCK vì chỉ đọc)
                var configSql = @"
                    SELECT Controller, VoucherCode, Field, CurrentNumber, Prefix, Suffix, NumberLength, 
                           DateFormat, ResetPeriod, LastResetDate
                    FROM VoucherSequence
                    WHERE Controller = @Controller and Field = @Field";

                var config = await connection.QueryFirstOrDefaultAsync(configSql, new { Controller = controller, Field = field });

                if (config == null)
                {
                    return ServiceResponse<string>.CreateError($"Chưa khai báo thông tin Field: {field} và Controller: {controller}", 404);
                }

                var currentDate = DateTime.Now;
                var shouldReset = false;
                var newNumber = config.CurrentNumber + 1;

                // Xử lý logic reset dựa trên ResetPeriod
                if (!string.IsNullOrEmpty(config.ResetPeriod))
                {
                    // Xử lý an toàn LastResetDate từ dynamic object
                    DateTime? lastResetDate = SafeParseDynamicDateTime(config.LastResetDate);

                    if (lastResetDate == null)
                    {
                        _logger.LogDebug($"LastResetDate null hoặc không hợp lệ cho field {field}, controller {controller}");
                    }

                    // Nếu LastResetDate null (lần đầu tiên) hoặc cần reset theo period
                    if (!lastResetDate.HasValue)
                    {
                        // Lần đầu tiên sử dụng, reset về 1
                        shouldReset = true;
                    }
                    else
                    {
                        // Kiểm tra xem có cần reset theo period không
                        switch (config.ResetPeriod.ToUpper())
                        {
                            case "YEAR":
                                shouldReset = currentDate.Year > lastResetDate.Value.Year;
                                break;
                            case "MONTH":
                                shouldReset = currentDate.Year > lastResetDate.Value.Year ||
                                             currentDate.Month > lastResetDate.Value.Month;
                                break;
                            case "DAY":
                                shouldReset = currentDate.Date > lastResetDate.Value.Date;
                                break;
                        }
                    }
                }

                if (shouldReset)
                {
                    newNumber = 1;
                }

                // Tạo voucher number theo format (chỉ để gợi ý, không lưu)
                var voucherNumber = BuildVoucherNumber(config.Prefix, config.Suffix,
                    newNumber, config.NumberLength, config.DateFormat, currentDate);

                return ServiceResponse<string>.CreateSuccess(voucherNumber, "Lấy số gợi ý thành công");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Lỗi khi lấy số gợi ý cho field {field} của controller {controller}");
                return ServiceResponse<string>.CreateError($"Lỗi hệ thống: {ex.Message}", 500);
            }
        }

        /// <summary>
        /// Tự động tăng số cho field khi lưu mới (chỉ áp dụng cho type = voucher)
        /// </summary>
        /// <param name="request">Request lưu dữ liệu</param>
        /// <param name="connection">Database connection</param>
        /// <param name="transaction">Database transaction</param>
        /// <returns>True nếu thành công, False nếu có lỗi</returns>
        private async Task<bool> AutoIncrementFieldNumberAsync(DynamicSaveRequest request, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                _logger.LogInformation("AutoIncrementFieldNumberAsync started for FormId: {FormId}, Action: {Action}", request.FormId, request.Action);

                // Chỉ áp dụng cho action = insert
                if (request.Action?.ToLower() != "insert")
                {
                    _logger.LogInformation("Skipping auto increment - Action is not 'insert': {Action}", request.Action);
                    return true;
                }

                // Lấy danh sách các field cần auto increment từ VoucherSequence
                var autoIncrementFields = await GetAutoIncrementFieldsFromVoucherSequenceAsync(request.FormId, connection, transaction);

                if (autoIncrementFields.Count == 0)
                {
                    _logger.LogInformation("No auto increment fields found for FormId: {FormId}", request.FormId);
                    return true;
                }

                _logger.LogInformation("Found {Count} auto increment fields: {Fields}", autoIncrementFields.Count, string.Join(", ", autoIncrementFields));

                // Xử lý từng field cần auto increment
                foreach (var fieldName in autoIncrementFields)
                {
                    _logger.LogInformation("Processing auto increment field: {FieldName}", fieldName);

                    // Kiểm tra field có giá trị rỗng hoặc chưa có
                    if (request.Data.TryGetProperty(fieldName, out var fieldValue))
                    {
                        var fieldStringValue = fieldValue.GetString() ?? "";
                        if (!string.IsNullOrEmpty(fieldStringValue) && fieldStringValue.Trim() != "")
                        {
                            _logger.LogInformation("Field {FieldName} already has value: {Value}, will update VoucherSequence after save", fieldName, fieldStringValue);

                            // Cập nhật VoucherSequence dựa trên giá trị VoucherNumber đã có
                            await UpdateVoucherSequenceFromVoucherNumberAsync(request.FormId, fieldName, fieldStringValue, connection, transaction);
                            continue;
                        }
                    }

                    _logger.LogInformation("Getting next number for field {FieldName} in form {FormId}", fieldName, request.FormId);

                    // Lấy số tiếp theo cho field này (chỉ để gợi ý, không tăng VoucherSequence)
                    var nextNumberResponse = await GetNextFieldNumberPreviewForSaveAsync(request.FormId, fieldName, connection, transaction);
                    if (nextNumberResponse.Success)
                    {
                        // Cập nhật giá trị vào request.Data
                        var updatedData = new Dictionary<string, object>();
                        foreach (var prop in request.Data.EnumerateObject())
                        {
                            updatedData[prop.Name] = prop.Value.GetRawText();
                        }
                        updatedData[fieldName] = nextNumberResponse.Data;

                        // Convert back to JsonElement
                        var jsonString = JsonSerializer.Serialize(updatedData);
                        request.Data = JsonSerializer.Deserialize<JsonElement>(jsonString);

                        _logger.LogInformation("Set field {FieldName} to {Value} for form {FormId} (will update VoucherSequence after save)",
                            fieldName, nextNumberResponse.Data, request.FormId);
                    }
                    else
                    {
                        _logger.LogWarning("Failed to get next number for field {FieldName} for form {FormId}: {Error}",
                            fieldName, request.FormId, nextNumberResponse.Message);
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in AutoIncrementFieldNumberAsync for form {FormId}", request.FormId);
                return false;
            }
        }

        /// <summary>
        /// Cập nhật VoucherSequence sau khi lưu chứng từ thành công
        /// </summary>
        public async Task<bool> UpdateVoucherSequenceAfterSaveAsync(string formId, Dictionary<string, object> savedData, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                _logger.LogInformation("UpdateVoucherSequenceAfterSaveAsync started for FormId: {FormId}", formId);

                // Lấy danh sách các field cần auto increment từ VoucherSequence
                var autoIncrementFields = await GetAutoIncrementFieldsFromVoucherSequenceAsync(formId, connection, transaction);

                if (autoIncrementFields.Count == 0)
                {
                    _logger.LogInformation("No auto increment fields found for FormId: {FormId}", formId);
                    return true;
                }

                // Xử lý từng field
                foreach (var fieldName in autoIncrementFields)
                {
                    if (savedData.TryGetValue(fieldName, out var fieldValue))
                    {
                        var fieldStringValue = fieldValue?.ToString() ?? "";
                        if (!string.IsNullOrEmpty(fieldStringValue))
                        {
                            _logger.LogInformation("Updating VoucherSequence for field {FieldName} with value {Value}", fieldName, fieldStringValue);

                            // Cập nhật VoucherSequence dựa trên giá trị VoucherNumber đã lưu
                            await UpdateVoucherSequenceFromVoucherNumberAsync(formId, fieldName, fieldStringValue, connection, transaction);
                        }
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in UpdateVoucherSequenceAfterSaveAsync for form {FormId}", formId);
                return false;
            }
        }

        /// <summary>
        /// Lấy số tiếp theo cho field khi lưu (không commit transaction)
        /// </summary>
        private async Task<ServiceResponse<string>> GetNextFieldNumberForSaveAsync(string formId, string fieldName, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                _logger.LogInformation("GetNextFieldNumberForSaveAsync called for FormId: {FormId}, FieldName: {FieldName}", formId, fieldName);

                // Lấy thông tin cấu hình field với UPDLOCK, ROWLOCK
                var configSql = @"
                    SELECT Controller, VoucherCode, Field, CurrentNumber, Prefix, Suffix, NumberLength, 
                           DateFormat, ResetPeriod, LastResetDate
                    FROM VoucherSequence WITH (UPDLOCK, ROWLOCK)
                    WHERE Controller = @Controller and Field = @Field";

                var config = await connection.QueryFirstOrDefaultAsync(configSql, new { Controller = formId, Field = fieldName }, transaction);

                if (config == null)
                {
                    _logger.LogWarning("VoucherSequence config not found for Controller: {FormId}, Field: {FieldName}", formId, fieldName);
                    return ServiceResponse<string>.CreateError($"Chưa khai báo thông tin Field: {fieldName} và Controller: {formId}", 404);
                }

                _logger.LogInformation("Found VoucherSequence config: Controller={Controller}, Field={Field}, CurrentNumber={CurrentNumber}, Prefix={Prefix}",
                    (string)config.Controller, (string)config.Field, (int)config.CurrentNumber, (string)config.Prefix);

                var currentDate = DateTime.Now;
                var shouldReset = false;
                var newNumber = config.CurrentNumber + 1;

                // Xử lý logic reset dựa trên ResetPeriod
                if (!string.IsNullOrEmpty(config.ResetPeriod))
                {
                    DateTime? lastResetDate = SafeParseDynamicDateTime(config.LastResetDate);

                    if (!lastResetDate.HasValue)
                    {
                        shouldReset = true;
                    }
                    else
                    {
                        switch (config.ResetPeriod.ToUpper())
                        {
                            case "YEAR":
                                shouldReset = currentDate.Year > lastResetDate.Value.Year;
                                break;
                            case "MONTH":
                                shouldReset = currentDate.Year > lastResetDate.Value.Year ||
                                             currentDate.Month > lastResetDate.Value.Month;
                                break;
                            case "DAY":
                                shouldReset = currentDate.Date > lastResetDate.Value.Date;
                                break;
                        }
                    }
                }

                if (shouldReset)
                {
                    newNumber = 1;
                }

                // Tạo voucher number theo format
                var voucherNumber = BuildVoucherNumber(config.Prefix, config.Suffix,
                    newNumber, config.NumberLength, config.DateFormat, currentDate);

                // Cập nhật số hiện tại trong database
                var updateSql = @"
                UPDATE VoucherSequence 
                SET CurrentNumber = @NewNumber, 
                    LastResetDate = @CurrentDate,
                    UpdatedDate = @CurrentDate
                WHERE Controller = @Controller and Field = @Field";

                _logger.LogInformation("Updating VoucherSequence: Controller={Controller}, Field={Field}, NewNumber={NewNumber}",
                    (string)formId, (string)fieldName, (string)newNumber);

                var rowsAffected = await connection.ExecuteAsync(updateSql, new
                {
                    NewNumber = newNumber,
                    CurrentDate = currentDate,
                    Controller = formId,
                    Field = fieldName
                }, transaction);

                _logger.LogInformation("VoucherSequence update completed. Rows affected: {RowsAffected}, Generated voucher: {VoucherNumber}",
                   rowsAffected.ToString(), (string)voucherNumber);

                return ServiceResponse<string>.CreateSuccess(voucherNumber, "Lấy số tiếp theo thành công");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Lỗi khi tạo số tiếp theo cho field {fieldName} của controller {formId}");
                return ServiceResponse<string>.CreateError($"Lỗi khi tạo số tiếp theo: {ex.Message}", 500);
            }
        }

        /// <summary>
        /// Lấy số gợi ý cho field khi lưu (không tăng VoucherSequence)
        /// </summary>
        private async Task<ServiceResponse<string>> GetNextFieldNumberPreviewForSaveAsync(string formId, string fieldName, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                _logger.LogInformation("GetNextFieldNumberPreviewForSaveAsync called for FormId: {FormId}, FieldName: {FieldName}", formId, fieldName);

                // Lấy thông tin cấu hình field (không dùng UPDLOCK, ROWLOCK vì chỉ đọc)
                var configSql = @"
                    SELECT Controller, VoucherCode, Field, CurrentNumber, Prefix, Suffix, NumberLength, 
                           DateFormat, ResetPeriod, LastResetDate
                    FROM VoucherSequence
                    WHERE Controller = @Controller and Field = @Field";

                var config = await connection.QueryFirstOrDefaultAsync(configSql, new { Controller = formId, Field = fieldName }, transaction);

                if (config == null)
                {
                    _logger.LogWarning("VoucherSequence config not found for Controller: {FormId}, Field: {FieldName}", formId, fieldName);
                    return ServiceResponse<string>.CreateError($"Chưa khai báo thông tin Field: {fieldName} và Controller: {formId}", 404);
                }

                _logger.LogInformation("Found VoucherSequence config: Controller={Controller}, Field={Field}, CurrentNumber={CurrentNumber}, Prefix={Prefix}",
                    (string)config.Controller, (string)config.Field, (int)config.CurrentNumber, (string)config.Prefix);

                var currentDate = DateTime.Now;
                var shouldReset = false;
                var newNumber = config.CurrentNumber + 1;

                // Xử lý logic reset dựa trên ResetPeriod
                if (!string.IsNullOrEmpty(config.ResetPeriod))
                {
                    DateTime? lastResetDate = SafeParseDynamicDateTime(config.LastResetDate);

                    if (!lastResetDate.HasValue)
                    {
                        shouldReset = true;
                    }
                    else
                    {
                        switch (config.ResetPeriod.ToUpper())
                        {
                            case "YEAR":
                                shouldReset = currentDate.Year > lastResetDate.Value.Year;
                                break;
                            case "MONTH":
                                shouldReset = currentDate.Year > lastResetDate.Value.Year ||
                                             currentDate.Month > lastResetDate.Value.Month;
                                break;
                            case "DAY":
                                shouldReset = currentDate.Date > lastResetDate.Value.Date;
                                break;
                        }
                    }
                }

                if (shouldReset)
                {
                    newNumber = 1;
                }

                // Tạo voucher number theo format (chỉ để gợi ý, không lưu)
                var voucherNumber = BuildVoucherNumber(config.Prefix, config.Suffix,
                    newNumber, config.NumberLength, config.DateFormat, currentDate);

                return ServiceResponse<string>.CreateSuccess(voucherNumber, "Lấy số gợi ý thành công");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Lỗi khi lấy số gợi ý cho field {fieldName} của controller {formId}");
                return ServiceResponse<string>.CreateError($"Lỗi hệ thống: {ex.Message}", 500);
            }
        }

        /// <summary>
        /// Cập nhật VoucherSequence dựa trên giá trị VoucherNumber đã lưu
        /// </summary>
        private async Task<bool> UpdateVoucherSequenceFromVoucherNumberAsync(string formId, string fieldName, string voucherNumber, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                _logger.LogInformation("UpdateVoucherSequenceFromVoucherNumberAsync called for FormId: {FormId}, FieldName: {FieldName}, VoucherNumber: {VoucherNumber}",
                    formId, fieldName, voucherNumber);

                // Lấy thông tin cấu hình field
                var configSql = @"
                    SELECT Controller, VoucherCode, Field, CurrentNumber, Prefix, Suffix, NumberLength, 
                           DateFormat, ResetPeriod, LastResetDate
                    FROM VoucherSequence
                    WHERE Controller = @Controller and Field = @Field";

                var config = await connection.QueryFirstOrDefaultAsync(configSql, new { Controller = formId, Field = fieldName }, transaction);

                if (config == null)
                {
                    _logger.LogWarning("VoucherSequence config not found for Controller: {FormId}, Field: {FieldName}", formId, fieldName);
                    return false;
                }

                // Trích xuất số tự nhiên từ VoucherNumber
                var extractedNumber = ExtractNumberFromVoucherNumber(voucherNumber, (string)config.Prefix, (string)config.Suffix, (string)config.DateFormat);

                if (extractedNumber <= 0)
                {
                    _logger.LogWarning("Could not extract valid number from VoucherNumber: {VoucherNumber}", voucherNumber);
                    return false;
                }

                _logger.LogInformation("Extracted number {ExtractedNumber} from VoucherNumber {VoucherNumber}", extractedNumber, voucherNumber);

                // Cập nhật VoucherSequence với số đã trích xuất
                var updateSql = @"
                    UPDATE VoucherSequence 
                    SET CurrentNumber = @NewNumber, 
                        UpdatedDate = @CurrentDate,
                        LastResetDate = @CurrentDate
                    WHERE Controller = @Controller and Field = @Field";

                var rowsAffected = await connection.ExecuteAsync(updateSql, new
                {
                    NewNumber = extractedNumber,
                    CurrentDate = DateTime.Now,
                    Controller = formId,
                    Field = fieldName
                }, transaction);

                _logger.LogInformation("Updated VoucherSequence: Controller={Controller}, Field={Field}, NewNumber={NewNumber}, RowsAffected={RowsAffected}",
                    formId, fieldName, extractedNumber, rowsAffected);

                return rowsAffected > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Lỗi khi cập nhật VoucherSequence từ VoucherNumber {voucherNumber} cho field {fieldName} của controller {formId}");
                return false;
            }
        }

        /// <summary>
        /// Trích xuất số tự nhiên từ VoucherNumber
        /// </summary>
        private int ExtractNumberFromVoucherNumber(string voucherNumber, string prefix, string suffix, string dateFormat)
        {
            try
            {
                if (string.IsNullOrEmpty(voucherNumber))
                    return 0;

                // Loại bỏ prefix
                if (!string.IsNullOrEmpty(prefix) && voucherNumber.StartsWith(prefix))
                {
                    voucherNumber = voucherNumber.Substring(prefix.Length);
                }

                // Loại bỏ suffix
                if (!string.IsNullOrEmpty(suffix) && voucherNumber.EndsWith(suffix))
                {
                    voucherNumber = voucherNumber.Substring(0, voucherNumber.Length - suffix.Length);
                }

                // Loại bỏ phần ngày tháng dựa trên DateFormat
                if (!string.IsNullOrEmpty(dateFormat))
                {
                    var dateLength = dateFormat.Length;
                    if (voucherNumber.Length > dateLength)
                    {
                        // Giả sử phần ngày tháng ở cuối trước phần số
                        var numberPart = voucherNumber.Substring(dateLength);
                        if (int.TryParse(numberPart, out var number))
                        {
                            return number;
                        }
                    }
                }

                // Thử parse toàn bộ chuỗi còn lại
                if (int.TryParse(voucherNumber, out var fullNumber))
                {
                    return fullNumber;
                }

                // Thử tìm số cuối cùng trong chuỗi
                var match = System.Text.RegularExpressions.Regex.Match(voucherNumber, @"\d+$");
                if (match.Success && int.TryParse(match.Value, out var lastNumber))
                {
                    return lastNumber;
                }

                return 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error extracting number from VoucherNumber: {VoucherNumber}", voucherNumber);
                return 0;
            }
        }

        /// <summary>
        /// Lấy danh sách các field cần auto increment từ VoucherSequence
        /// </summary>
        /// <param name="formId">Form ID</param>
        /// <param name="connection">Database connection</param>
        /// <param name="transaction">Database transaction</param>
        /// <returns>Danh sách field names</returns>
        private async Task<List<string>> GetAutoIncrementFieldsFromVoucherSequenceAsync(string formId, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                var sql = @"
                    SELECT DISTINCT Field 
                    FROM VoucherSequence 
                    WHERE Controller = @Controller";

                var fields = await connection.QueryAsync<string>(sql, new { Controller = formId }, transaction);

                var fieldList = fields.ToList();
                _logger.LogInformation("Found {Count} VoucherSequence fields for Controller {Controller}: {Fields}",
                    fieldList.Count, formId, string.Join(", ", fieldList));

                return fieldList;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting auto increment fields from VoucherSequence for Controller {Controller}", formId);
                return new List<string>();
            }
        }

        /// <summary>
        /// Lấy form config từ database
        /// </summary>
        private async Task<JsonElement?> GetFormConfigAsync(string formId, SqlConnection connection, SqlTransaction transaction)
        {
            try
            {
                var sql = "SELECT FormConfig FROM FormConfig WHERE FormId = @FormId";
                var configJson = await connection.QueryFirstOrDefaultAsync<string>(sql, new { FormId = formId }, transaction);

                if (string.IsNullOrEmpty(configJson))
                    return null;

                return JsonSerializer.Deserialize<JsonElement>(configJson);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting form config for {FormId}", formId);
                return null;
            }
        }

        /// <summary>
        /// Xử lý an toàn việc parse DateTime từ dynamic object
        /// </summary>
        /// <param name="dynamicValue">Giá trị dynamic từ database</param>
        /// <returns>DateTime? - null nếu không parse được</returns>
        private DateTime? SafeParseDynamicDateTime(dynamic dynamicValue)
        {
            try
            {
                if (dynamicValue == null || Convert.IsDBNull(dynamicValue))
                {
                    return null;
                }

                // Nếu đã là DateTime
                if (dynamicValue is DateTime dateTime)
                {
                    return dateTime;
                }

                // Nếu là string hoặc các kiểu khác, thử parse
                if (DateTime.TryParse(dynamicValue.ToString(), out DateTime parsedDate))
                {
                    return parsedDate;
                }

                return null;
            }
            catch
            {
                return null;
            }
        }

        private string BuildVoucherNumber(string prefix, string suffix, int number, int numberLength, string dateFormat, DateTime currentDate)
        {
            var result = "";

            // Thêm prefix
            if (!string.IsNullOrEmpty(prefix))
            {
                result += prefix;
            }

            // Thêm date format nếu có
            if (!string.IsNullOrEmpty(dateFormat))
            {
                result += currentDate.ToString(dateFormat);
            }

            // Thêm số với padding
            result += number.ToString().PadLeft(numberLength, '0');

            // Thêm suffix
            if (!string.IsNullOrEmpty(suffix))
            {
                result += suffix;
            }

            return result;
        }
    }
}
