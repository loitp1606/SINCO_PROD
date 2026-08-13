using Dapper;
using DocumentFormat.OpenXml.Office.Word;
using FuzzySharp;
using log4net;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Internal;
using Microsoft.Extensions.FileSystemGlobbing.Internal;
using Microsoft.PowerBI.Api.Models;
using Newtonsoft.Json;
using reportSystem01.Server.Data;
using Sinco.Server.Helpers;
using Sinco.Server.Models;
using Sinco.Server.SqlJsonDefinations;
using Sinco.Server.SqlJsonDefinations.Responses;
using System.CodeDom;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data;
using System.Data.SqlClient;
using System.Drawing;
using System.Dynamic;
using System.Globalization;
using System.Linq;
using System.Net.Http.Headers;
using System.Reflection.Metadata;
using System.ServiceModel.Channels;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using static Sinco.Server.SqlJsonDefinations.SqlJsonDefination;
using static Sinco.Server.SqlJsonDefinations.SqlJsonDefination.ExcelIntegrationMap;


namespace Sinco.Server.Repositories.BaseRepository
{
    public class BaseRepository<T> : IBaseRepository<T> where T : class
    {
        private readonly ReportServerContext _context;
        private readonly IDbConnection _dbConnect;
        private readonly DbSet<T> _dbSet;
        private static readonly ILog log = LogManager.GetLogger(typeof(BaseRepository<T>));

        public BaseRepository(ReportServerContext context)
        {
            _context = context;
            _dbConnect = context.Database.GetDbConnection();
            _dbSet = _context.Set<T>();
        }

        public async Task<List<Dictionary<string, List<Dictionary<string, object>>>>> GetTablesAsync(string suffix, string ids, Dictionary<string, List<string>> expectedCols)
        {
            var resultList = new List<Dictionary<string, List<Dictionary<string, object>>>>();
            if (expectedCols == null || expectedCols.Count == 0)
            {
                return resultList;
            }


            var sqlDef = await GetTemplateByTableNameAsync(expectedCols.FirstOrDefault().Key);
            foreach (var expected in expectedCols)
            {
                SqlJsonDefination sqlDefi = new SqlJsonDefination();
                if (sqlDef != null && string.Equals(sqlDef.Model, expected.Key, StringComparison.OrdinalIgnoreCase))
                {
                    sqlDefi = sqlDef;
                }
                else if (sqlDef != null && sqlDef.ForiegnModel != null)
                {
                    var foreign = sqlDef.ForiegnModel.FirstOrDefault(f => string.Equals(f.Model, expected.Key, StringComparison.OrdinalIgnoreCase));

                    if (foreign != null)
                    {
                        sqlDefi = foreign;
                    }
                    else
                    {
                        throw new ExceptionFormat($"GetTablesAsync: error (no match found in ForeignModel)");
                    }
                }
                else
                {
                    throw new ExceptionFormat($"GetTablesAsync: error");
                }
                var data = await getDataTable(sqlDefi, expected.Key, suffix, ids, expected.Value);
                if (data != null && data.Count > 0)
                {
                    resultList.Add(data);
                }
            }

            return resultList;
        }

        private async Task<Dictionary<string, List<Dictionary<string, object>>>> getDataTable(
                                                                                            SqlJsonDefination sqlDef,
                                                                                            string baseTableName,
                                                                                            string suffix,
                                                                                            string ids,
                                                                                            List<string> columns)
        {
            var result = new Dictionary<string, List<Dictionary<string, object>>>();

            using var connection = new SqlConnection(_dbConnect.ConnectionString);
            await connection.OpenAsync();

            var pk = GetPrimaryKeys(sqlDef);
            var queryTableName = sqlDef.Schema.Partition == true ? baseTableName + suffix : baseTableName;

            var selectCols = new List<string>();
            var joinClauses = new List<string>();
            var mainAlias = "m";

            foreach (var colName in columns)
            {
                var field = sqlDef.Schema.Fields
                    .FirstOrDefault(f => f.Name.Equals(colName, StringComparison.OrdinalIgnoreCase));

                if (field != null && !string.IsNullOrWhiteSpace(field.SqlExpression))
                {
                    var expression = field.SqlExpression.Replace("{m}", mainAlias);
                    selectCols.Add($"{expression} AS [{field.Name}]");
                    continue;
                }

                if (field != null && field.Foreign != null && !string.IsNullOrEmpty(field.Foreign.Lookup))
                {
                    var alias = "f_" + field.Foreign.Table;
                    var localJoinField = string.IsNullOrWhiteSpace(field.Foreign.SourceField)
                        ? field.Name
                        : field.Foreign.SourceField;
                    selectCols.Add($"{alias}.[{field.Foreign.Lookup}] AS [{field.Name}]");
                    joinClauses.Add(
                        $"LEFT JOIN [{field.Foreign.Table}] {alias} ON {alias}.[{field.Foreign.Key}] = {mainAlias}.[{localJoinField}]"
                    );
                }
                else
                {
                    selectCols.Add($"{mainAlias}.[{colName}]");
                }
            }

            var pks = pk.Where(k => !string.IsNullOrEmpty(k)).ToList();
            var query = $@"
                            SELECT {string.Join(",", selectCols)}
                            FROM [{queryTableName}] {mainAlias}
                            {string.Join("\n", joinClauses)}
                            WHERE {mainAlias}.[{pks.First()}] = @Id
                        ";

            using var command = new SqlCommand(query, connection);
            command.Parameters.AddWithValue("@Id", ids);

            var tableData = new List<Dictionary<string, object>>();
            using (var reader = await command.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    var row = new Dictionary<string, object>();
                    foreach (var col in columns!)
                    {
                        row[col] = reader[col];
                    }
                    tableData.Add(row);
                }
            } // reader đã đóng ở đây

            // xử lý Foreign sau khi reader đã đóng
            var columnMappings = sqlDef.ExcelIntegration?.ColumnMapping;
            if (columnMappings == null || columnMappings.Count == 0)
            {
                log.Warn(
                    $"[GetTablesAsync] ExcelIntegration.ColumnMapping is null/empty. " +
                    $"Model={sqlDef.Model}, Table={baseTableName}"
                );
            }
            else
            {
                var warnedMappingKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var row in tableData)
                {
                    foreach (var colMap in columnMappings)
                    {
                        if (colMap == null)
                        {
                            const string nullMapKey = "__null_col_map__";
                            if (warnedMappingKeys.Add(nullMapKey))
                            {
                                log.Warn(
                                    $"[GetTablesAsync] Encountered null mapping item in ColumnMapping. " +
                                    $"Model={sqlDef.Model}, Table={baseTableName}"
                                );
                            }
                            continue;
                        }
                        if (string.IsNullOrWhiteSpace(colMap.Foriegn))
                        {
                            var warnKey = $"missing_foreign::{colMap.FieldName}";
                            if (warnedMappingKeys.Add(warnKey))
                            {
                                log.Warn(
                                    $"[GetTablesAsync] Missing 'Foriegn' SQL in mapping. " +
                                    $"Model={sqlDef.Model}, Table={baseTableName}, Field={colMap.FieldName}"
                                );
                            }
                            continue;
                        }
                        if (string.IsNullOrWhiteSpace(colMap.FieldName))
                        {
                            const string missingFieldNameKey = "__missing_field_name__";
                            if (warnedMappingKeys.Add(missingFieldNameKey))
                            {
                                log.Warn(
                                    $"[GetTablesAsync] Missing FieldName in mapping. " +
                                    $"Model={sqlDef.Model}, Table={baseTableName}"
                                );
                            }
                            continue;
                        }
                        if (!row.TryGetValue(colMap.FieldName, out var fieldValue) || fieldValue == null)
                        {
                            var warnKey = $"missing_row_field::{colMap.FieldName}";
                            if (warnedMappingKeys.Add(warnKey))
                            {
                                log.Warn(
                                    $"[GetTablesAsync] Row does not contain mapped field or value is null. " +
                                    $"Model={sqlDef.Model}, Table={baseTableName}, Field={colMap.FieldName}"
                                );
                            }
                            continue;
                        }

                        using var foreignCmd = connection.CreateCommand();
                        foreignCmd.CommandText = colMap.Foriegn;
                        foreignCmd.CommandType = CommandType.Text;

                        var param = foreignCmd.CreateParameter();
                        param.ParameterName = "@" + colMap.FieldName;
                        param.Value = fieldValue;
                        foreignCmd.Parameters.Add(param);

                        var foreignResult = await foreignCmd.ExecuteScalarAsync();
                        if (foreignResult != null && foreignResult != DBNull.Value)
                        {
                            row[colMap.FieldName] = foreignResult.ToString();
                        }
                    }
                }
            }

            result[baseTableName] = tableData;
            return result;
        }

        /// <summary>
        /// Hàm lấy thông tin dựa trên ID 
        /// </summary>
        /// <param name="id">value primarykey</param>
        /// <param name="tableName">table name</param>
        /// <param name="keyName">key name if exist</param>
        /// <returns>list or T if exist</returns>
        /// <exception cref="ArgumentNullException"></exception>
        /// <exception cref="Exception"></exception>
        public async Task<dynamic?> GetByIdAsync(object id, string tableName, string? keyName = null)
        {
            if (id == null)
                throw new ExceptionFormat("Giá trị khoá chính là null");

            var sqlDef = await GetTemplateByTableNameAsync(tableName);
            if (sqlDef == null)
                throw new ExceptionFormat($"Không tìm thấy định nghĩa bảng {tableName}");

            // Nếu id là Dictionary → dùng multi-key
            if (id is IDictionary<string, string> keyDict)
            {
                var whereClause = string.Join(" AND ", keyDict.Select(k => $"[{k.Key}] = @{k.Key}"));
                var sql = $"SELECT * FROM [{tableName}] WHERE {whereClause}";
                var parameters = new DynamicParameters();
                foreach (var kv in keyDict)
                {
                    parameters.Add(kv.Key, kv.Value);
                }
                if (_dbConnect.State != ConnectionState.Open)
                    _dbConnect.Open();
                var results = await _dbConnect.QueryAsync<dynamic>(sql, parameters);
                return results;
            }
            else if (id is string)
            {
                // Nếu là single key
                if (string.IsNullOrEmpty(keyName))
                {
                    keyName = GetPrimaryKeys(sqlDef).FirstOrDefault();
                    if (string.IsNullOrEmpty(keyName))
                        throw new ExceptionFormat("Không tìm thấy khóa chính");
                }

                var sqlSingle = $"SELECT * FROM [{tableName}] WHERE [{keyName}] = @id";

                if (_dbConnect.State != ConnectionState.Open)
                    _dbConnect.Open();
                var result = await _dbConnect.QueryAsync<dynamic>(sqlSingle, new { id });
                return result;
            }
            else
            {
                throw new ExceptionFormat("Dữ liệu id truyền vào không hợp lệ");
            }
        }
        public async Task<int> DeleteMultiAsync(List<string> ids, string tableName, string status, string primaryKey)
        {
            if (ids.Count <= 0) throw new ArgumentNullException(nameof(ids));
            if (string.IsNullOrWhiteSpace(tableName)) throw new ArgumentNullException(nameof(tableName));
            try
            {
                using (var connection = new SqlConnection(_dbConnect.ConnectionString))
                {
                    await connection.OpenAsync();
                    using (var transaction = connection.BeginTransaction())
                    {
                        var deleteQueries = new List<string>();

                        foreach (var id in ids)
                        {
                            //bool isReferenced = false;

                            //// Tìm tất cả bảng có cột item_id (ngoại trừ chính bảng item)
                            //string sqlRefs = @"
                            //                SELECT t.name, c.name
                            //                FROM sys.columns c
                            //                INNER JOIN sys.tables t ON c.object_id = t.object_id
                            //                WHERE c.name = @KeyColumn AND t.name <> @TableName";

                            //var refs = new List<(string Table, string Column)>();
                            //using (var cmd = new SqlCommand(sqlRefs, connection, transaction))
                            //{
                            //    cmd.Parameters.AddWithValue("@KeyColumn", primaryKey);
                            //    cmd.Parameters.AddWithValue("@TableName", tableName);

                            //    using (var reader = await cmd.ExecuteReaderAsync())
                            //    {
                            //        while (await reader.ReadAsync())
                            //        {
                            //            refs.Add((reader.GetString(0), reader.GetString(1)));
                            //        }
                            //    }
                            //}

                            //// Đóng reader trước, rồi mới kiểm tra từng bảng
                            //foreach (var (refTable, refColumn) in refs)
                            //{
                            //    string checkSql = $@"
                            //                    SELECT TOP 1 1 
                            //                    FROM [{refTable}] 
                            //                    WHERE [{refColumn}] = @Id";

                            //    using (var checkCmd = new SqlCommand(checkSql, connection, transaction))
                            //    {
                            //        checkCmd.Parameters.AddWithValue("@Id", id);
                            //        var result = await checkCmd.ExecuteScalarAsync();
                            //        if (result != null)
                            //        {
                            //            isReferenced = true;
                            //            break;
                            //        }
                            //    }
                            //}

                            // Nếu có liên quan → update status
                            //if (isReferenced)
                            //{
                            deleteQueries.Add(
                                $"UPDATE [{tableName}] " +
                                $"SET status = @Status " +
                                $"WHERE [{primaryKey}] = '{id}'"
                            );
                            //}
                            //else // Không có → xóa hẳn
                            //{
                            //    deleteQueries.Add(
                            //        $"DELETE FROM [{tableName}] WHERE [{primaryKey}] = '{id}'"
                            //    );
                            //}
                        }

                        // Ghép lại thành batch query
                        var deleteQuery = string.Join(";\n", deleteQueries);
                        using (var deleteCmd = new SqlCommand(deleteQuery, connection, transaction))
                        {
                            deleteCmd.Parameters.AddWithValue("@Status", status);
                            int affectedRows = await deleteCmd.ExecuteNonQueryAsync();
                            transaction.Commit();
                            return affectedRows;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                throw new Exception("Exception when deleting:", ex);
            }
        }
        private async Task<int> UpsertSingleTableAsync(DataTable table, SqlJsonDefination sqlDefination, SqlConnection connection, SqlTransaction transaction, Dictionary<string, object>? userAssign, bool? overWrite)
        {
            if (sqlDefination == null) throw new ArgumentNullException(nameof(sqlDefination));

            var tableName = table.TableName; // Đảm bảo lấy đúng "quotationPaper$202507"
            if (string.IsNullOrEmpty(tableName))
                tableName = sqlDefination.ExcelIntegration?.SheetName ?? sqlDefination.Model;

            var tempTableName = $"#{tableName}_Temp";

            // Không được mở connection ở đây vì đã truyền vào
            try
            {
                string? partition = null;
                if (tableName.Contains("$"))
                {
                    var parts = tableName.Split('$');
                    if (parts.Length > 1 && !string.IsNullOrWhiteSpace(parts[1]))
                    {
                        partition = parts[1];
                    }
                }
                //ConvertDataTableColumnsFromJsonSchema(table, sqlDefinition);
                var dbColumns = await GetTableColumnsAsync(tableName, connection, transaction);
                //tạo temp Bulk coppy
                var createTempSql = await GenerateCreateTableScript(tempTableName, dbColumns);
                using (var createCmd = new SqlCommand(createTempSql, connection, transaction))
                {
                    await createCmd.ExecuteNonQueryAsync();
                }
                //Gán giá trị userAssign và status nếu tồn tại trong DB
                var dbColumnNames = dbColumns
                    .Select(c => c.columnName)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                if (dbColumnNames.Count <= 0)
                    throw new ExceptionFormat($"Bảng {tableName} không tồn tại trong database.");

                var defaultValues = new Dictionary<string, object?>();
                // Duyệt qua tất cả cột trong DB để gán userAssign
                foreach (var col in dbColumnNames)
                {
                    if (userAssign != null && userAssign.TryGetValue(col, out var val))
                    {
                        // Nếu FE có gửi giá trị
                        defaultValues[col] = val ?? null;
                    }
                    else
                    {
                        // Gán giá trị mặc định cho một số cột đặc biệt
                        if (col.Equals("datetime0", StringComparison.OrdinalIgnoreCase))
                            defaultValues[col] = DateTime.Now;
                        else if (col.Equals("status", StringComparison.OrdinalIgnoreCase))
                            defaultValues[col] = 1;//hiện tại đang dùng 1 là hoạt động
                        else
                            defaultValues[col] = null;
                    }
                }
                //tạo cột user assign cho table
                foreach (var colName in defaultValues.Keys)
                {
                    if (dbColumnNames.Contains(colName) && !table.Columns.Contains(colName))
                    {
                        var defaultValue = defaultValues[colName];
                        Type colType = null!;
                        if (defaultValues[colName] != null || colType == typeof(object) || colType == typeof(string))
                        {
                            var dbCol = dbColumns.FirstOrDefault(c => c.columnName.Equals(colName, StringComparison.OrdinalIgnoreCase));

                            if (dbCol.columnName != null)
                            {
                                string sqlDataType = dbCol.dataType.ToLower();

                                if (sqlDataType.Contains("int"))
                                    colType = typeof(int);
                                else if (sqlDataType.Contains("float") || sqlDataType.Contains("decimal") || sqlDataType.Contains("numeric"))
                                    colType = typeof(decimal); // Nên dùng decimal cho độ chính xác cao
                                else if (sqlDataType.Contains("bit"))
                                    colType = typeof(bool);
                                else if (sqlDataType.Contains("datetime") || sqlDataType.Contains("date"))
                                    colType = typeof(DateTime);
                                else if (sqlDataType.Contains("uniqueidentifier"))
                                    colType = typeof(Guid);
                                else
                                    // Kiểu chuỗi (varchar, nvarchar, text,...)
                                    colType = typeof(string);
                            }
                            else
                            {
                                // Trường hợp không tìm thấy cột trong dbColumns (có thể là cột tạm thời khác RowIndex)
                                colType = typeof(string);
                            }
                            table.Columns.Add(colName, colType);
                        }
                    }
                }
                foreach (DataRow row in table.Rows)
                {
                    foreach (var colName in defaultValues.Keys)
                    {
                        if (table.Columns.Contains(colName))
                        {
                            var defaultValue = defaultValues[colName];
                            if (row[colName] == DBNull.Value || row[colName] == null || string.IsNullOrWhiteSpace(row[colName]?.ToString()))
                            {
                                row[colName] = defaultValue ?? DBNull.Value;
                            }
                        }
                    }
                }
                //tạo bulkCoppy
                using (var bulkCopy = new SqlBulkCopy(connection, SqlBulkCopyOptions.Default, transaction))
                {
                    //tạo RowIndex để hiện lỗi
                    if (!table.Columns.Contains("RowIndex"))
                    {
                        table.Columns.Add("RowIndex", typeof(int));
                        for (int i = 0; i < table.Rows.Count; i++)
                        {
                            table.Rows[i]["RowIndex"] = i + 3;//bắt đầu từ dòng 3
                        }
                    }

                    bulkCopy.DestinationTableName = tempTableName;
                    foreach (DataColumn column in table.Columns)
                    {
                        bool hasValue = table.AsEnumerable().Any(r => r[column] != null &&
                                                                                      r[column] != DBNull.Value &&
                                                                                      !string.IsNullOrWhiteSpace(r[column].ToString()));

                        if (hasValue)
                        {
                            bulkCopy.ColumnMappings.Add(column.ColumnName, column.ColumnName);
                        }
                    }

                    await bulkCopy.WriteToServerAsync(table);
                }

                var allErrors = new List<string>();
                (bool isValid, List<string>? dbCheckErrors) validateResult = (false, new List<string>());
                //validate rule type check
                validateResult = await ValidationQueryFromTempTable(tempTableName, sqlDefination, dbColumns, connection, transaction);
                if (validateResult.dbCheckErrors != null && validateResult.dbCheckErrors.Count > 0)
                {
                    allErrors.AddRange(validateResult.dbCheckErrors);
                }
                //xử lý validate bảng temp
                validateResult = await ValidateDatabaseCheck(tableName, tempTableName, sqlDefination, connection, transaction, overWrite);

                if (validateResult.dbCheckErrors != null && validateResult.dbCheckErrors.Count > 0)
                {
                    throw new ExceptionFormat(409, $"Upsert {tableName}", validateResult.dbCheckErrors);
                }

                if (allErrors.Any())
                {
                    // Nối các lỗi với xuống dòng
                    var message = string.Join(Environment.NewLine, allErrors);

                    throw new ExceptionFormat(null, $"Upsert {tableName}", new List<string> { message });
                }

                //merge data
                var mergeSql = GenerateMergeSqlFromTempTable(tableName, tempTableName, sqlDefination, dbColumnNames);

                // Lấy kết quả merge
                //var pks = new List<Dictionary<string, object>>();
                using (var mergeCmd = new SqlCommand(mergeSql, connection, transaction))
                {
                    await mergeCmd.ExecuteNonQueryAsync();
                }
                #region old merge
                //using (var mergeCmd = new SqlCommand(mergeSql, connection, transaction))
                //using (var reader = await mergeCmd.ExecuteReaderAsync())
                //{
                //    while (await reader.ReadAsync())
                //    {
                //        // lấy toàn bộ PK động, không fix cứng "Id"
                //        var keys = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                //        for (int i = 0; i < reader.FieldCount; i++)
                //        {
                //            var colName = reader.GetName(i);
                //            keys[colName] = await reader.IsDBNullAsync(i) ? null : reader.GetValue(i);
                //        }
                //        // chỉ thêm nếu chưa có trong danh sách
                //        if (!pks.Any(existing => existing.SequenceEqual(keys)))
                //            pks.Add(keys);
                //        else
                //        {
                //            Console.WriteLine("trùng khóa ");
                //        }
                //    }
                //}
                #endregion
                // Nếu có dataprocess thì làm
                if (sqlDefination.DataProcessing?.SqlStatements != null)
                {
                    // Danh sách các câu lệnh cần xử lý (chỉ MERGE)
                    var sqlStatements = sqlDefination.DataProcessing.SqlStatements;

                    // Lặp qua các câu lệnh SQL (chỉ có 1 lệnh MERGE)
                    foreach (var statement in sqlStatements)
                    {
                        var sqlText = statement.Query;

                        if (string.IsNullOrWhiteSpace(sqlText))
                            continue;

                        // 1. Thay thế tên Bảng Tạm và Partition (nếu có)
                        sqlText = sqlText.Replace("#TempTableName", tempTableName);

                        if (sqlDefination.Schema.Partition == true && partition != null)
                        {
                            sqlText = sqlText.Replace("@partition", $"${partition}");
                        }

                        string realSql = sqlText;

                        // 2. CHỈ CHẠY CÂU LỆNH MERGE MỘT LẦN DUY NHẤT
                        using (var cmd = new SqlCommand(realSql, connection, transaction))
                        {
                            // ExecuteNonQueryAsync sẽ chạy MERGE cho TẤT CẢ các hàng trong bảng tạm.
                            await cmd.ExecuteNonQueryAsync();
                        }
                    }
                }

                return table.Rows.Count;
            }
            catch (Exception ex)
            {
                if (ex is ExceptionFormat valEx)
                    throw;

                var summaries = new List<string>();

                if (ex is SqlException sqlEx)
                {
                    var msg = sqlEx.Message;
                    if (msg.Contains("Cannot insert the value NULL", StringComparison.OrdinalIgnoreCase))
                        summaries.Add($"Thiếu dữ liệu ở cột '{Regex.Match(msg, @"'([^']+)'").Groups[1].Value}'");
                    else if (msg.Contains("duplicate key", StringComparison.OrdinalIgnoreCase))
                        summaries.Add($"Dữ liệu bị trùng khóa");
                    else
                        summaries.Add(msg);
                }
                else
                {
                    summaries.Add(ex.Message);
                }

                throw new ExceptionFormat(-1, $"Lỗi khi upsert {tableName}", summaries);
            }
        }
        private List<ItemEntry> _itemDictionary = new List<ItemEntry>();
        private void LoadItemDictionaryFromDb()
        {
            const string query = "select item_id, item_name from item where status = '1'";

            using (var connection = new SqlConnection(_dbConnect.ConnectionString))
            {
                connection.Open();
                using (var command = new SqlCommand(query, connection))
                using (var reader = command.ExecuteReader())
                {
                    _itemDictionary.Clear();

                    while (reader.Read())
                    {
                        _itemDictionary.Add(new ItemEntry
                        {
                            ItemCode = reader["item_id"].ToString(),
                            ItemDesc = reader["item_name"].ToString()
                        });
                    }
                }
            }
        }


        // Inner helper: dò mã vật tư từ tên
        void MatchItemCodes(DataTable table, List<ItemEntry> dict)
        {
            if (!table.Columns.Contains("itemNameCustomer") || !table.Columns.Contains("itemCode")) return;

            foreach (DataRow row in table.Rows)
            {
                var input = row["itemNameCustomer"]?.ToString();
                if (string.IsNullOrWhiteSpace(input)) continue;

                var normalized = Normalize(input);
                var best = dict
                    .Select(i => new
                    {
                        i.ItemCode,
                        i.ItemDesc,
                        Score = Fuzz.Ratio(Normalize(i.ItemDesc), normalized)
                    })
                    .OrderByDescending(x => x.Score)
                    .FirstOrDefault();

                if (best != null && best.Score > 60)
                    row["itemCode"] = best.ItemCode;
            }
        }

        string Normalize(string s)
        {
            s = s.ToLowerInvariant();
            s = Regex.Replace(s, @"[^a-z0-9\s]", " ");
            s = Regex.Replace(s, @"\s+", " ").Trim();
            return s;
        }
        public async Task MatchItemCodesFromApiAsync(DataTable table)
        {
            if (!table.Columns.Contains("itemNameCustomer") ||
                !table.Columns.Contains("itemCode") ||
                !table.Columns.Contains("nha_san_xuat"))
            {
                log.Warn("Thiếu cột bắt buộc: itemNameCustomer, itemCode hoặc nha_san_xuat");
                return;
            }

            try
            {
                // 1. Lấy URL từ cấu hình DB
                string apiUrl = await GetApiUrlFromDbAsync(_dbConnect.ConnectionString);
                if (string.IsNullOrEmpty(apiUrl))
                {
                    log.Error("Không tìm thấy cấu hình URL API từ DB");
                    return;
                }

                // 2. Chuẩn bị danh sách đầu vào
                var inputList = table.Rows
                    .Cast<DataRow>()
                    .Select(row => new
                    {
                        Row = row,
                        Manufacturer = row["nha_san_xuat"]?.ToString()?.Trim() ?? "",
                        ItemName = row["itemNameCustomer"]?.ToString()?.Trim() ?? ""
                    })
                    .Where(x => !string.IsNullOrWhiteSpace(x.ItemName))
                    .GroupBy(x => new { x.Manufacturer, x.ItemName }) // loại trùng
                    .ToDictionary(
                        g => g.Key,
                        g => g.Select(x => x.Row).ToList()
                    );



                // 3. Tạo payload
                var payload = new
                {
                    items = inputList.Keys.Select(k => new
                    {
                        nhaSanXuat = k.Manufacturer,
                        itemNameCustomer = k.ItemName
                    }).ToList()
                };

                var payloadJson = System.Text.Json.JsonSerializer.Serialize(payload);
                log.Info($"Payload gửi API: {payloadJson}");

                using var httpClient = new HttpClient();
                httpClient.Timeout = TimeSpan.FromSeconds(180);
                httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                var content = new StringContent(payloadJson, Encoding.UTF8, "application/json");

                // 4. Gửi request
                var response = await httpClient.PostAsync(apiUrl, content);
                if (!response.IsSuccessStatusCode)
                {
                    log.Error($"API trả về mã lỗi: {(int)response.StatusCode} - {response.ReasonPhrase}");
                    return;
                }

                var responseString = await response.Content.ReadAsStringAsync();
                log.Info($"Response từ API: {responseString}");

                // 5. Parse kết quả
                var results = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, ItemMatchResult>>>(responseString);

                if (results != null && results.TryGetValue("results", out var resultsDict))
                {
                    foreach (var key in inputList.Keys)
                    {
                        var fullKey = $"{key.Manufacturer} {key.ItemName}".Trim();
                        if (resultsDict.TryGetValue(fullKey, out var match) && match != null)
                        {
                            if (match.TryGetValue("ItemID", out var itemId))
                            {
                                foreach (var row in inputList[key])
                                {
                                    row["itemCode"] = itemId?.ToString();
                                }
                            }
                        }

                    }
                }

            }
            catch (Exception ex)
            {
                log.Error("Lỗi khi gọi API match item code", ex);
            }
        }





        // Lấy URL từ DB
        private async Task<string> GetApiUrlFromDbAsync(string connectionString)
        {
            using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();

            using var cmd = new SqlCommand("SELECT ConfigValue FROM SystemOptions WHERE ConfigKey = 'url_search'", connection);
            var result = await cmd.ExecuteScalarAsync();

            return result?.ToString();
        }

        // Lớp ánh xạ kết quả
        public class ItemMatchResult : Dictionary<string, object> { }

        public async Task<int> UpsertAsyncQuaquotationPaper(Dictionary<string, DataTable> dataTables, SqlJsonDefination masterDef, List<SqlJsonDefination>? foreignDefs, Dictionary<string, object>? userAssign, bool? overWrite)
        {
            if (masterDef == null) throw new ArgumentNullException(nameof(masterDef));

            int totalRows = 0;

            using (var connection = new SqlConnection(_dbConnect.ConnectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Master
                        foreach (var kv in dataTables)
                        {
                            if (IsMatchingTable(kv.Key, masterDef.Model))
                            {
                                kv.Value.TableName = kv.Key;

                                totalRows += await UpsertSingleTableAsync(kv.Value, masterDef, connection, transaction, userAssign, overWrite);
                            }
                        }

                        // Foreign
                        if (foreignDefs != null && foreignDefs.Count > 0)
                        {
                            foreach (var foreignDef in foreignDefs)
                            {
                                foreach (var kv in dataTables)
                                {
                                    if (IsMatchingTable(kv.Key, foreignDef.Model))
                                    {
                                        kv.Value.TableName = kv.Key;
                                        // 🆕 THÊM ĐÂY: xử lý tìm mã vật tư trước khi upsert
                                        LoadItemDictionaryFromDb();
                                        //MatchItemCodes(kv.Value, _itemDictionary);
                                        await MatchItemCodesFromApiAsync(kv.Value);
                                        totalRows += await UpsertSingleTableAsync(kv.Value, foreignDef, connection, transaction, userAssign, overWrite);
                                    }
                                }
                            }
                        }

                        transaction.Commit();
                        return totalRows;
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();

                        if (ex is ExceptionFormat) throw; // Giữ nguyên lỗi validation ném lên

                        throw new ExceptionFormat(-1, "Error when upsert multiple tables", new List<string> { ex.Message });
                    }
                }
            }

        }
        public async Task<int> UpsertMultipleTablesAsync(Dictionary<string, DataTable> dataTables, SqlJsonDefination masterDef, List<SqlJsonDefination>? foreignDefs, Dictionary<string, object>? userAssign, bool? overWrite)
        {
            if (masterDef == null) throw new ArgumentNullException(nameof(masterDef));

            int totalRows = 0;

            using (var connection = new SqlConnection(_dbConnect.ConnectionString))
            {
                await connection.OpenAsync();
                using (var transaction = connection.BeginTransaction())
                {
                    try
                    {
                        // Master
                        foreach (var kv in dataTables)
                        {
                            if (IsMatchingTable(kv.Key, masterDef.Model))
                            {
                                kv.Value.TableName = kv.Key;
                                totalRows += await UpsertSingleTableAsync(kv.Value, masterDef, connection, transaction, userAssign, overWrite);
                            }
                        }

                        // Foreign
                        if (foreignDefs != null && foreignDefs.Count > 0)
                        {
                            foreach (var foreignDef in foreignDefs)
                            {
                                foreach (var kv in dataTables)
                                {
                                    if (IsMatchingTable(kv.Key, foreignDef.Model))
                                    {
                                        kv.Value.TableName = kv.Key;
                                        totalRows += await UpsertSingleTableAsync(kv.Value, foreignDef, connection, transaction, userAssign, overWrite);
                                    }
                                }
                            }
                        }

                        transaction.Commit();
                        return totalRows;
                    }
                    catch (Exception ex)
                    {
                        transaction.Rollback();

                        if (ex is ExceptionFormat) throw; // Giữ nguyên lỗi validation ném lên

                        throw new ExceptionFormat(-1, "Error when upsert multiple tables", new List<string> { ex.Message });
                    }
                }
            }

        }
        bool IsMatchingTable(string tableKey, string model)
        {
            var prefix = tableKey.Contains('$') ? tableKey.Split('$')[0] : tableKey;
            return string.Equals(prefix, model, StringComparison.OrdinalIgnoreCase);
        }
        /// <summary>
        /// hàm này để convert lại datatable theo def và ép iểu cho đúng 
        /// </summary>
        /// <param name="table"></param>
        /// <param name="def"></param>
        private Type GetClrTypeFromJson(string jsonType)
        {
            return jsonType switch
            {
                "string" => typeof(string),
                "number" => typeof(int),           // Nếu cần chính xác hơn, có thể để là decimal hoặc double nếu sqlType là DECIMAL
                "decimal" => typeof(decimal),
                "datetime" => typeof(DateTime),
                "date" => typeof(DateTime),
                "bool" => typeof(bool),
                _ => typeof(string) // fallback
            };
        }

        #region Get template
        /// <summary>
        /// Hàm đọc path json dựa theo table name 
        /// </summary>
        /// <param name="tableName"></param>
        /// <returns></returns>
        /// <exception cref="FileNotFoundException"></exception>
        public async Task<SqlJsonDefination> GetTemplateByTableNameAsync(string tableName)
        {
            // Ưu tiên đọc từ thư mục source code (dùng khi dev)
            var possiblePaths = new[]
            {
                Path.Combine(Directory.GetCurrentDirectory(), "SqlJsonDefinations", "JsonModels"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "SqlJsonDefinations", "JsonModels"),
                Path.Combine(AppContext.BaseDirectory, "SqlJsonDefinations", "JsonModels") // fallback cho trường hợp publish
            };

            string? folderPath = possiblePaths.FirstOrDefault(Directory.Exists);

            if (folderPath == null)
                throw new DirectoryNotFoundException("Cannot locate SqlJsonDefinations\\JsonModels in any expected path.");

            var expectedFileName = $"{tableName}Model.json";

            // Tìm file bất kể hoa thường
            var matchedFile = Directory.GetFiles(folderPath)
                .FirstOrDefault(f => string.Equals(Path.GetFileName(f), expectedFileName, StringComparison.OrdinalIgnoreCase));

            if (matchedFile == null)
                throw new FileNotFoundException($"JSON file not found: '{expectedFileName}' in folder {folderPath}");

            var jsonContent = await File.ReadAllTextAsync(matchedFile);
            var template = JsonConvert.DeserializeObject<SqlJsonDefination>(jsonContent);

            if (template == null)
                throw new InvalidDataException($"Cannot deserialize JSON: {matchedFile}");

            return template;
        }

        /// <summary>
        /// Hàm đọc path json metadata dựa theo table name 
        /// </summary>
        /// <param name="tableName"></param>
        /// <returns></returns>
        /// <exception cref="FileNotFoundException"></exception>
        public async Task<MetadataResponse> GetTemplateMetadataByTableNameAsync(string tableName)
        {
            var possiblePaths = new[]
            {
                Path.Combine(Directory.GetCurrentDirectory(), "Controllers", "Form", $"{tableName}.json"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Controllers", "Form", $"{tableName}.json"),
                Path.Combine(AppContext.BaseDirectory, "Controllers", "Form", $"{tableName}.json") // fallback cho publish
            };

            string? jsonPath = possiblePaths.FirstOrDefault(File.Exists);

            if (jsonPath == null)
                throw new FileNotFoundException($"File JSON for '{tableName}' does not exist in any expected path.");

            var jsonContent = await File.ReadAllTextAsync(jsonPath);
            var template = JsonConvert.DeserializeObject<MetadataResponse>(jsonContent);

            if (template == null)
                throw new InvalidDataException($"Cannot deserialize JSON file: {jsonPath}");

            return template;
        }

        /// <summary>
        /// Hàm lấy toàn bộ định nghĩa JSON schema cho tất cả các bảng.
        /// </summary>
        /// <returns>Danh sách SqlJsonDefination</returns>
        /// <exception cref="DirectoryNotFoundException">Nếu không tìm thấy thư mục schema</exception>
        public async Task<List<SqlJsonDefination>> GetAllTemplateDefinitionsAsync()
        {
            var possiblePaths = new[]
            {
                Path.Combine(Directory.GetCurrentDirectory(), "SqlJsonDefinations", "JsonModels"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "SqlJsonDefinations", "JsonModels"),
                Path.Combine(AppContext.BaseDirectory, "SqlJsonDefinations", "JsonModels") // fallback cho publish
            };

            string? folderPath = possiblePaths.FirstOrDefault(Directory.Exists);

            if (folderPath == null)
                throw new DirectoryNotFoundException("Không tìm thấy thư mục SqlJsonDefinations/JsonModels trong các vị trí được kiểm tra.");

            var results = new List<SqlJsonDefination>();
            var files = Directory.GetFiles(folderPath, "*Model.json");

            foreach (var file in files)
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var def = JsonConvert.DeserializeObject<SqlJsonDefination>(json);
                    if (def != null)
                    {
                        var fileName = Path.GetFileNameWithoutExtension(file);
                        def.Model = fileName.Replace("Model", "");
                        results.Add(def);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Lỗi khi đọc file {file}: {ex.Message}");
                }
            }

            return results;
        }

        /// <summary>
        /// Hàm lấy primarykey 
        /// </summary>
        /// <returns>Tên primary key</returns>
        private List<string> GetPrimaryKeys(SqlJsonDefination schema)
        {
            return schema.Schema.Fields
                .Where(f => f.PrimaryKey == true)
                .Select(f => f.Name)
                .ToList();
        }
        public async Task<List<(string Code, string? Name)>> GetForeignDataAsync(string sql)
        {
            var list = new List<(string, string?)>();

            using var connection = new SqlConnection(_dbConnect.ConnectionString); // _connectionString = config DB
            await connection.OpenAsync();

            using var cmd = new SqlCommand(sql, connection) { CommandType = CommandType.Text };
            using var reader = await cmd.ExecuteReaderAsync();

            while (await reader.ReadAsync())
            {
                var code = reader.GetFieldValue<string>(0);
                string? name = null;
                if (reader.FieldCount > 1)
                {
                    name = reader.IsDBNull(1) ? null : reader.GetString(1);
                }
                list.Add((code, name));
            }

            return list;
        }
        #endregion
        #region Generate
        /// <summary>
        /// Hàm tạo sql để tạo table template 
        /// </summary>
        /// <param name="tempTableName"></param>
        /// <param name="sqlJsonDefination"></param>
        /// <returns></returns>
        private Task<string> GenerateCreateTableScript(
                                                        string tempTableName,
                                                        List<(string ColumnName, string DataType, int? MaxLength, bool? isRequired)> dbColumns)
        {
            var columnsDef = new List<string>();

            foreach (var col in dbColumns)
            {
                string sqlType = col.DataType;

                if (col.MaxLength.HasValue)
                {
                    if (col.MaxLength.Value > 0)
                        sqlType += $"({col.MaxLength.Value})";
                    else if (col.MaxLength.Value == -1) // MAX
                        sqlType += "(MAX)";
                }

                columnsDef.Add($"[{col.ColumnName}] {sqlType}");
            }

            // Thêm RowIndex
            columnsDef.Add("[RowIndex] INT");

            string createSql = $"CREATE TABLE {tempTableName} (\n{string.Join(",\n", columnsDef)}\n);";
            return Task.FromResult(createSql);
        }


        /// <summary>
        /// Hàm tạo câu lệnh merge từ bảng phụ sang bảng chính 
        /// </summary>
        /// <param name="tempTableName"></param>
        /// <param name="sqlJsonDefination"></param>
        /// <returns></returns>
        /// <exception cref="ArgumentException"></exception>
        private string GenerateMergeSqlFromTempTable(
                                                    string tableName,
                                                    string tempTableName,
                                                    SqlJsonDefination sqlJsonDefination,
                                                    HashSet<string> dbColumns)
        {
            // Copy schema fields ra list để có thể bổ sung
            var schemaFields = sqlJsonDefination.Schema.Fields.ToList();

            // Bổ sung các cột từ dbColumns nếu schema chưa có
            foreach (var col in dbColumns)
            {
                if (!schemaFields.Any(f => f.Name.Equals(col, StringComparison.OrdinalIgnoreCase)))
                {
                    schemaFields.Add(new SqlJsonDefination.SqlSchema.Field
                    {
                        Name = col,
                        Property = col,
                    });
                }
            }

            // Chỉ giữ các field có trong dbColumns (tránh cột rác)
            var validFields = schemaFields
                .Where(f => dbColumns.Contains(f.Name, StringComparer.OrdinalIgnoreCase))
                .ToList();

            // Lấy key / non-key
            var keyFields = validFields.Where(f => f.PrimaryKey == true).ToList();
            var nonKeyFields = validFields.Where(f => f.PrimaryKey != true).ToList();

            if (!keyFields.Any())
                throw new ArgumentException("Primary key field not defined in schema");

            string sourceAlias = "Source";
            string targetAlias = "Target";

            // Điều kiện ON
            string onConditions = string.Join(" AND ",
                keyFields.Select(f => $"{targetAlias}.[{f.Name}] = {sourceAlias}.[{f.Name}]"));

            // SET cho UPDATE
            string updateSet = string.Join(", ",
                nonKeyFields.Select(f => $"{targetAlias}.[{f.Name}] = {sourceAlias}.[{f.Name}]"));
            bool hasStatusColumn = dbColumns.Contains("status", StringComparer.OrdinalIgnoreCase);
            //string updateSet = string.Join(", ",
            //    nonKeyFields.Select(f =>
            //    {
            //        // Kiểm tra: Nếu bảng đích CÓ cột Status, áp dụng logic CASE.
            //        if (hasStatusColumn && f.Name.Equals("status", StringComparison.OrdinalIgnoreCase))
            //        {
            //            // Nếu cột đang được set là cột 'status', chỉ cần cập nhật giá trị mới.
            //            // (Thường bạn sẽ không muốn cập nhật cột status dựa trên status cũ)
            //            return $"{targetAlias}.[{f.Name}] = {sourceAlias}.[{f.Name}]";
            //        }
            //        else if (hasStatusColumn)
            //        {
            //            //chỉ cập nhập lại row khác status = * (ko cập nhập row đang ở trạng thái xóa)
            //            return $"{targetAlias}.[{f.Name}] = CASE WHEN {targetAlias}.[status] == '*' THEN {sourceAlias}.[{f.Name}] ELSE {targetAlias}.[{f.Name}] END";
            //        }
            //        else
            //        {
            //            // Nếu bảng đích KHÔNG CÓ cột status (như quotationPaperDetail), cập nhật trực tiếp
            //            return $"{targetAlias}.[{f.Name}] = {sourceAlias}.[{f.Name}]";
            //        }
            //    }));

            // INSERT
            string insertColumns = string.Join(", ", validFields.Select(f => $"[{f.Name}]"));
            string insertValues = string.Join(", ", validFields.Select(f => $"{sourceAlias}.[{f.Name}]"));

            // OUTPUT: chỉ PK
            //var pkColumns = keyFields.Where(k => k.PrimaryKey == true).Select(k => k.Name).ToList();
            //string outputColumns = pkColumns.Count > 0 ? string.Join(", ", pkColumns.Select(c => $"inserted.[{c}]")) : "";
            //string outputColumns = string.Join(", ",
            //    keyFields.Select(f => $"inserted.[{f.Name}]"));
            return $@"
                    MERGE INTO {tableName} AS {targetAlias}
                    USING {tempTableName} AS {sourceAlias}
                    ON {onConditions}
                    WHEN MATCHED THEN
                        UPDATE SET {updateSet}
                    WHEN NOT MATCHED THEN
                        INSERT ({insertColumns})
                        VALUES ({insertValues});
                    ";//trả về PKValue
                    //OUTPUT {outputColumns}; 
        }



        /// <summary>
        /// Hàm này để tạo ra câu lệnh check validate theo type 
        /// </summary>
        /// <param name="tempTableName"></param>
        /// <param name="sqlDefination"></param>
        /// <returns></returns>
        private string GenerateValidationQueryFromTempTable(string tempTableName, SqlJsonDefination sqlDefination)
        {
            var caseWhenClauses = new List<string>();
            // Chỉ lấy các field có Required = true
            var requiredFields = sqlDefination.Schema.Fields
                .Where(f => f.Required == true)
                .ToList();
            //kiểm tra checking rule type
            foreach (var rule in sqlDefination.Checking.Rules.Where(
                                               r => requiredFields.Any(f => f.Name.Equals(r.FieldName, StringComparison.OrdinalIgnoreCase))))
            {
                string field = rule.FieldName;
                string message = rule.Message;
                string condition = "";

                switch (rule.Type)
                {
                    case "range":
                        condition = BuildRangeCondition(field, rule.Min, rule.Max);
                        break;

                    case "length":
                        if (rule.MinLength != null)
                            caseWhenClauses.Add($"WHEN LEN([{field}]) < {rule.MinLength} THEN '{message}'");
                        if (rule.MaxLength != null)
                            caseWhenClauses.Add($"WHEN LEN([{field}]) > {rule.MaxLength} THEN '{message}'");
                        break;

                    case "pattern":
                        // Đánh dấu để xử lý pattern ở backend (vì SQL không hỗ trợ regex)
                        caseWhenClauses.Add($"WHEN [{field}] IS NOT NULL THEN 'PatternCheck:{field}:{rule.Pattern}:{message}'");
                        break;
                }

                if (!string.IsNullOrWhiteSpace(condition))
                {
                    caseWhenClauses.Add($"WHEN {condition} THEN '{message}'");
                }
            }

            //kiểm tra sqlType
            foreach (var field in requiredFields)
            {
                string fieldName = field.Name;
                string sqlType = field.SqlType?.ToLower() ?? "";

                if (sqlType.ToLower().Contains("decimal") || sqlType.ToLower().Contains("float") || sqlType.ToLower().Contains("numeric"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS FLOAT) IS NULL THEN 'Field {fieldName} must be a number'");
                }
                else if (sqlType.ToLower().Contains("datetime") || sqlType.ToLower().Contains("date") || sqlType.ToLower().Contains("smalldatetime"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS DATETIME) IS NULL THEN 'Field {fieldName} must be a valid date'");
                }
                else if (sqlType.ToLower().Contains("int") && !sqlType.ToLower().Contains("point") && !sqlType.ToLower().Contains("float"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS INT) IS NULL THEN 'Field {fieldName} must be an integer'");
                }
                else if (sqlType.ToLower().Contains("bit"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS BIT) IS NULL THEN 'Field {fieldName} must be a boolean'");
                }
                else if (sqlType.ToLower().Contains("uniqueidentifier"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS UNIQUEIDENTIFIER) IS NULL THEN 'Field {fieldName} must be a valid GUID'");
                }
                // Cảnh báo cho kiểu TEXT/NTEXT
                else if (sqlType.Contains("text"))
                {
                    caseWhenClauses.Add($"WHEN [{fieldName}] IS NULL THEN 'Field {fieldName} (text) should not be null'");
                }
                // Cảnh báo kiểu BINARY / IMAGE
                else if (sqlType.Contains("binary") || sqlType.Contains("image"))
                {
                    caseWhenClauses.Add($"WHEN [{fieldName}] IS NULL THEN 'Field {fieldName} (binary) should not be null'");
                }
                // XML kiểu mới
                else if (sqlType.Contains("xml"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS XML) IS NULL THEN 'Field {fieldName} must be valid XML'");
                }
                // TIME
                else if (sqlType.Contains("time"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS TIME) IS NULL THEN 'Field {fieldName} must be a valid time'");
                }
                // MONEY
                else if (sqlType.Contains("money"))
                {
                    caseWhenClauses.Add($"WHEN TRY_CAST([{fieldName}] AS MONEY) IS NULL THEN 'Field {fieldName} must be a valid money value'");
                }
                //độ dài cố định của char 
                var charMatch = Regex.Match(sqlType, @"char\((\d+)\)");
                if (charMatch.Success && int.TryParse(charMatch.Groups[1].Value, out int charMaxLen))
                {
                    caseWhenClauses.Add($"WHEN LEN([{fieldName}]) > {charMaxLen} THEN 'Field {fieldName} exceeds max length {charMaxLen}'");
                }
                // Kiểm tra kiểu dữ liệu TEXT, NTEXT, IMAGE
            }

            string caseStatement = string.Join("\n", caseWhenClauses);
            if (string.IsNullOrWhiteSpace(caseStatement))
            {
                return "";
            }
            return $@"
					SELECT *,
					CASE
						{caseStatement}
					ELSE 'Valid'
					END AS ValidationResult
					FROM {tempTableName}
					";
        }

        /// <summary>
        /// Hàm tạo câu lệnh query sử dụng open json 
        /// </summary>
        /// <param name="sqlDefination"></param>
        /// <returns></returns>
        /// <exception cref="Exception"></exception>
        private string GenerateValidationQueryByOpenJson(SqlJsonDefination sqlDefination)
        {
            var caseWhenClauses = new List<string>();
            var fields = new List<string>();
            foreach (var rule in sqlDefination.Checking.Rules)
            {
                string field = rule.FieldName;
                string message = rule.Message;
                string condition = "";
                switch (rule.Type)
                {
                    case "range":
                        condition = BuildRangeCondition(field, rule.Min, rule.Max);
                        break;
                    case "length":
                        if (rule.MinLength != null) caseWhenClauses.Add($"WHEN LEN([{field}]) < {rule.MinLength} THEN '{message}'");
                        if (rule.MaxLength != null) caseWhenClauses.Add($"WHEN LEN([{field}]) > {rule.MaxLength} THEN '{message}'");
                        break;
                    case "pattern":
                        // Dùng PATINDEX thay vì LIKE
                        var pattern = rule.Pattern?.Replace("'", "''") ?? "";
                        condition = $"PATINDEX('{pattern}', [{field}]) = 0";
                        break;
                }
                if (!string.IsNullOrWhiteSpace(condition))
                {
                    caseWhenClauses.Add($"WHEN {condition} THEN '{message}'");
                }
            }
            foreach (var field in sqlDefination.Schema.Fields)
            {
                var sqlDef = sqlDefination.Schema.Fields.FirstOrDefault(t => t.Name.Trim().ToLower().Equals(field.Name.Trim().ToLower()));
                if (sqlDef == null)
                {
                    throw new Exception($"Field '{field}' not exist in schema.");
                }
                string typeField = sqlDef.SqlType ?? "";
                //Chuyển kiểu không được hỗ trợ sang kiểu hợp lệ
                typeField = typeField switch
                {
                    "TEXT" => "NVARCHAR(MAX)",
                    "NTEXT" => "NVARCHAR(MAX)",
                    "IMAGE" => "VARBINARY(MAX)",
                    "SQL_VARIANT" => throw new Exception($"SQL_VARIANT is not supported in OPENJSON WITH clause. Field: {field.Name}"),
                    _ => typeField
                };
                fields.Add($"{field.Name} {typeField}");
            }
            string cases = string.Join("\n", caseWhenClauses);
            string casesField = string.Join(",\n", fields);

            return $@"
				SELECT *,
				CASE
					{cases}
					ELSE 'Valid'
				END AS ValidationResult
				FROM OPENJSON(@json)
				WITH (
					{casesField}
				)
			";
        }

        private async Task<List<(string columnName, string dataType, int? maxLength, bool? isRequired)>> GetTableColumnsAsync(
                                                                                                            string tableName,
                                                                                                            SqlConnection connection,
                                                                                                            SqlTransaction transaction)
        {
            var columns = new List<(string columnName, string dataType, int? maxLength, bool? isRequire)>();

            string sql = @"
                        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
                        FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_NAME = @TableName
                        ORDER BY ORDINAL_POSITION";

            using (var cmd = new SqlCommand(sql, connection, transaction))
            {
                cmd.Parameters.AddWithValue("@TableName", tableName);

                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        string columnName = reader.GetString(0);
                        string dataType = reader.GetString(1);
                        string isNullable = reader.GetString(2);
                        int? maxLength = reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3);
                        bool isRequire = isNullable.Equals("NO", StringComparison.OrdinalIgnoreCase);

                        columns.Add((columnName, dataType, maxLength, isRequire));
                    }
                }
            }

            return columns;
        }

        #endregion
        #region Validate

        private async Task<(bool isValid, List<string>? errors)> ValidationQueryFromTempTable(
                        string tempTableName,
                        SqlJsonDefination sqlDefination,
                        List<(string columnName, string dataType, int? maxLength, bool? isRequired)> dbColumns,
                        SqlConnection connection,
                        SqlTransaction transaction)
        {
            var errors = new List<string>();
            var caseWhenClauses = new List<string>();
            try
            {
                var checkingRules = sqlDefination?.Checking?.Rules;
                if (checkingRules != null)
                {
                    foreach (var rule in checkingRules)
                    {
                        if (rule == null || string.IsNullOrWhiteSpace(rule.FieldName) || string.IsNullOrWhiteSpace(rule.Type))
                            continue;

                        string field = rule.FieldName.ToLower();
                        string escapedMessage = (rule.Message ?? string.Empty).Replace("'", "''"); // Thoát ký tự nháy đơn
                        string errorTag = $"Column: {rule.FieldName} - {escapedMessage}";

                        string condition = "";

                        switch (rule.Type?.ToLower())
                        {
                            case "range":
                                // Kiểm tra Range (Chỉ áp dụng nếu trường không NULL)
                                var rangeCondition = BuildRangeCondition(field, rule.Min, rule.Max);
                                if (!string.IsNullOrWhiteSpace(rangeCondition))
                                {
                                    condition = $"[{field}] IS NOT NULL AND ({rangeCondition})";
                                }
                                break;

                            case "length":
                                if (!string.IsNullOrEmpty(rule.MinLength))
                                    caseWhenClauses.Add($@"WHEN [{field}] IS NOT NULL AND LEN(CAST([{field}] AS NVARCHAR(MAX))) < {rule.MinLength} THEN '{errorTag}'");
                                if (!string.IsNullOrEmpty(rule.MaxLength))
                                    caseWhenClauses.Add($@"WHEN [{field}] IS NOT NULL AND LEN(CAST([{field}] AS NVARCHAR(MAX))) > {rule.MaxLength} THEN '{errorTag}'");
                                break;

                                // Lưu ý: Validation PATTERN (Regex) phức tạp nên làm trong C# hoặc dùng LIKE trong SQL.
                                // Nếu bạn muốn dùng Regex, đoạn code hiện tại của bạn không phù hợp với SQL.
                                // (Tôi tạm thời bỏ qua Regex trong SQL CASE WHEN)
                        }

                        if (!string.IsNullOrWhiteSpace(condition))
                        {
                            caseWhenClauses.Add($"WHEN {condition} THEN '{errorTag}'");
                        }
                    }
                }

                foreach (var field in dbColumns)
                {
                    string fieldName = field.columnName;
                    string sqlType = field.dataType?.ToLower() ?? "";

                    // 2a. Kiểm tra Required (NOT NULL)
                    if (field.isRequired == true)
                    {
                        // Check NULL hoặc chuỗi rỗng
                        caseWhenClauses.Add($@"WHEN [{fieldName}] IS NULL OR LTRIM(RTRIM(CAST([{fieldName}] AS NVARCHAR(MAX)))) = '' 
                                       THEN 'Column: {fieldName} - Required field cannot be empty'");
                    }

                    // 2b. Kiểm tra Kiểu Dữ Liệu bằng TRY_CAST (chỉ khi giá trị không rỗng)
                    string? typeCheckCondition = null;
                    string typeCheckMessage = $"Column: {fieldName} - Invalid data type ({sqlType})";

                    if (sqlType.Contains("decimal") || sqlType.Contains("float") || sqlType.Contains("numeric"))
                        typeCheckCondition = $"TRY_CAST([{fieldName}] AS FLOAT) IS NULL";
                    else if (sqlType.Contains("datetime") || sqlType.Contains("date"))
                        typeCheckCondition = $"TRY_CAST([{fieldName}] AS DATETIME) IS NULL";
                    else if (sqlType.Contains("int") && !sqlType.Contains("point"))
                        typeCheckCondition = $"TRY_CAST([{fieldName}] AS INT) IS NULL";
                    else if (sqlType.Contains("bit"))
                        typeCheckCondition = $"TRY_CAST([{fieldName}] AS BIT) IS NULL";
                    else if (sqlType.Contains("uniqueidentifier"))
                        typeCheckCondition = $"TRY_CAST([{fieldName}] AS UNIQUEIDENTIFIER) IS NULL";

                    if (typeCheckCondition != null)
                    {
                        // Chỉ kiểm tra kiểu dữ liệu nếu nó không phải NULL/rỗng
                        caseWhenClauses.Add($@"WHEN [{fieldName}] IS NOT NULL AND LTRIM(RTRIM(CAST([{fieldName}] AS NVARCHAR(MAX)))) != '' AND {typeCheckCondition} 
                                       THEN '{typeCheckMessage}'");
                    }
                }

                if (caseWhenClauses.Count == 0)
                {
                    return (true, null);
                }

                string caseStatement = string.Join("\n\t\t\t\t", caseWhenClauses);

                var sqlQuery = $@"
                                SELECT T.RowIndex, T.ValidationResult
                                FROM (
                                    SELECT 
                                        *, -- Bao gồm RowIndex và tất cả các cột
                                        CASE 
                                            {caseStatement}
                                            ELSE 'Valid'
                                        END AS ValidationResult
                                    FROM {tempTableName}
                                ) AS T
                                WHERE T.ValidationResult != 'Valid'; -- Chỉ lấy các hàng có lỗi
                                ";

                using (var cmdDb = new SqlCommand(sqlQuery, connection, transaction))
                using (var readerDb = await cmdDb.ExecuteReaderAsync())
                {
                    // Cần kiểm tra xem cột RowIndex có tồn tại trong kết quả truy vấn không
                    bool hasRowIndex = false;
                    try { hasRowIndex = readerDb.GetOrdinal("RowIndex") >= 0; } catch { /* Ignore */ }

                    int resultColIndex = readerDb.GetOrdinal("ValidationResult");

                    while (await readerDb.ReadAsync())
                    {
                        string validationMessage = readerDb.GetString(resultColIndex);

                        string errorPrefix = hasRowIndex
                            ? $"[Lỗi Dòng {readerDb.GetInt32(readerDb.GetOrdinal("RowIndex"))}]: "
                            : "[Lỗi Dòng (Không rõ số thứ tự)]: ";

                        // Ghi nhận lỗi
                        errors.Add($"{errorPrefix}{validationMessage}");
                    }
                }

                if (errors.Count > 0)
                {
                    return (false, errors);
                }

                return (true, null);
            }
            catch (Exception ex)
            {
                errors.Add($"[Validation Error]: An unexpected error occurred: {ex.Message}");
                return (false, errors);
            }
        }


        private static string BuildRangeCondition(string fieldName, string? min, string? max)
        {
            var conditions = new List<string>();

            if (!string.IsNullOrWhiteSpace(min))
            {
                conditions.Add($"[{fieldName}] < {min}");
            }

            if (!string.IsNullOrWhiteSpace(max))
            {
                conditions.Add($"[{fieldName}] > {max}");
            }

            return string.Join(" OR ", conditions);
        }


        /// <summary>
        /// Hàm kiểm tra database đã tồn tại chưa trong temp 
        /// </summary>
        /// <param name="oldTable"></param>
        /// <param name="sqlDefination"></param>
        /// <returns></returns>
        private async Task<(bool isValid, List<string>? errors)> ValidateDatabaseCheck(
                                                                                        string tableName,
                                                                                        string tempTableName,
                                                                                        SqlJsonDefination sqlDefination,
                                                                                        SqlConnection connection,
                                                                                        SqlTransaction transaction,
                                                                                        bool? overWrite)
        {
            var errors = new List<string>();
            try
            {
                var dbChecks = (sqlDefination?.Checking?.Rules ?? new List<SqlJsonDefination.CheckingData.Rule>())
                    .Where(f => f.Type?.ToLower() == "databasecheck")
                    .ToList();

                if (!dbChecks.Any())
                    return (true, errors);

                foreach (var field in dbChecks)
                {
                    try
                    {
                        // Nếu user cho phép overwrite và json có overwrite thì bỏ qua
                        if (overWrite == true && field.OverWrite == true)
                            continue;

                        string fieldName = field.FieldName!;
                        string? errorCol = field.ErrorCol ?? null;
                        string message = field.Message;
                        int threshold = int.Parse(field.Threshold ?? "0");
                        string whereClause = field.CheckQuery!.Trim();
                        var tableColumns = await GetTableColumnsAsync(tableName, connection, transaction);
                        bool hasStatusColumn = tableColumns.Any(c =>
                            c.columnName.Equals("status", StringComparison.OrdinalIgnoreCase));

                        if (whereClause.StartsWith("WHERE", StringComparison.OrdinalIgnoreCase))
                            whereClause = whereClause.Substring(5).Trim();

                        // Các cột param
                        var paramMatches = Regex.Matches(whereClause, @"@(\w+)");
                        var paramColumns = paramMatches.Select(m => m.Groups[1].Value).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

                        // Thay trực tiếp @param bằng t.[param]
                        foreach (var param in paramColumns)
                        {
                            whereClause = Regex.Replace(
                                whereClause,
                                $@"@{Regex.Escape(param)}\b",
                                $"t.[{param}]",
                                RegexOptions.IgnoreCase);
                        }

                        // Lấy schema fields để alias về bảng đích m.[field]
                        var schemaFields = sqlDefination.Schema.Fields
                            .Select(f => f.Name)
                            .Select(Regex.Escape)
                            .ToList();

                        if (schemaFields.Any())
                        {
                            var pattern = $@"(?<![\.\[])\b({string.Join("|", schemaFields)})\b";
                            whereClause = Regex.Replace(whereClause, pattern, m => $"m.{m.Value}", RegexOptions.IgnoreCase);
                        }

                        string joinConditions = string.Join(" AND ", paramColumns.Select(c => $"m.[{c}] = t.[{c}]"));
                        if (hasStatusColumn)
                        {
                            joinConditions = string.IsNullOrWhiteSpace(joinConditions)
                                ? "ISNULL(m.[status], '') <> '*'"
                                : $"{joinConditions} AND ISNULL(m.[status], '') <> '*'";
                        }

                        // Gộp temp + errorCol
                        var selectColumns = paramColumns.Select(c => $"t.[{c}]").ToList();
                        if (!string.IsNullOrEmpty(errorCol) && !selectColumns.Contains($"t.[{errorCol}]"))
                            selectColumns.Add($"t.[{errorCol}]");

                        string selectColumnsStr = string.Join(", ", selectColumns);

                        // 1️⃣ Kiểm tra trùng trong temp
                        string tempCheckQuery = $@"
                                                    SELECT {selectColumnsStr}, 'temp' AS Source
                                                    FROM {tempTableName} t
                                                    GROUP BY {selectColumnsStr}
                                                    HAVING COUNT(*) > 1;
                                                ";

                        // Thực hiện kiểm tra temp trước, bỏ qua nếu overWrite khai báo trong json = false và user chưa chọn ghi đè thì kiểm tra temp
                        if (overWrite == false && field.OverWrite == false)
                        {
                            using (var cmdTemp = new SqlCommand(tempCheckQuery, connection, transaction))
                            using (var readerTemp = await cmdTemp.ExecuteReaderAsync())
                            {
                                int errorColIndex = string.IsNullOrEmpty(errorCol) ? -1 : readerTemp.GetOrdinal(errorCol);
                                int sourceIndex = readerTemp.GetOrdinal("Source");

                                bool tempHasError = false;

                                while (await readerTemp.ReadAsync())
                                {
                                    tempHasError = true;

                                    //var errorColValue = errorColIndex >= 0
                                    //    ? await readerTemp.IsDBNullAsync(errorColIndex) ? null : readerTemp.GetValue(errorColIndex)
                                    //    : null;

                                    //var prefix = !string.IsNullOrEmpty(errorCol)
                                    //    ? $"[Ở {errorCol} = {errorColValue}]: "
                                    //    : "";

                                    errors.Add($"Tại giá trị '{string.Join(", ", paramColumns.Select(c => readerTemp[c]))}' - {message}");
                                }

                                await readerTemp.CloseAsync();

                                // Nếu temp có lỗi, không chạy check DB
                                if (tempHasError)
                                    return (false, errors);
                            }

                        }
                        // Thực hiện kiểm tra DB nếu temp OK -> thực hiện ktra db
                        // 2️⃣ Kiểm tra trùng trong DB
                        string dbCheckQuery = $@"
                                                    SELECT {selectColumnsStr}, 'db' AS Source
                                                    FROM {tableName ?? "TargetTable"} m
                                                    JOIN {tempTableName} t 
                                                      ON {joinConditions}
                                                    WHERE {(!string.IsNullOrWhiteSpace(whereClause) ? whereClause : "1=1")}
                                                    GROUP BY {selectColumnsStr}
                                                    HAVING COUNT(*) > {threshold};
                                                ";
                        using (var cmdDb = new SqlCommand(dbCheckQuery, connection, transaction))
                        using (var readerDb = await cmdDb.ExecuteReaderAsync())
                        {
                            int errorColIndex = string.IsNullOrEmpty(errorCol) ? -1 : readerDb.GetOrdinal(errorCol);
                            int sourceIndex = readerDb.GetOrdinal("Source");

                            while (await readerDb.ReadAsync())
                            {
                                //var errorColValue = errorColIndex >= 0
                                //    ? await readerDb.IsDBNullAsync(errorColIndex) ? null : readerDb.GetValue(errorColIndex)
                                //    : null;

                                //var prefix = !string.IsNullOrEmpty(errorCol)
                                //    ? $"[Ở {errorCol} = {errorColValue}]: "
                                //    : "";

                                errors.Add($"Tại giá trị '{string.Join(", ", paramColumns.Select(c => readerDb[c]))}' - {message}");
                            }

                            await readerDb.CloseAsync();
                        }

                    }
                    catch (Exception ex)
                    {
                        errors.Add($"[DatabaseCheck Error]: Field '{field.FieldName}' - {ex.Message}");
                    }
                }

                return (errors.Count == 0, errors);
            }
            catch (Exception ex)
            {
                errors.Add($"[ValidateDatabaseCheck Error]: {ex.Message}");
                return (false, errors);
            }
        }

        #endregion
        #region external function
        ///hàm kiểm tra và đưa ra new table dựa theo các field tương ứng với json map được
        private List<string> CheckMissingRequiredData(DataTable dataTable, SqlJsonDefination.ExcelIntegrationMap excelColumn)
        {
            var errors = new List<string>();

            // Tạo dictionary để check required nhanh hơn
            var requiredFields = excelColumn.ColumnMapping
                .Where(x => x.Required == true)
                .ToDictionary(x => x.FieldName.Trim(), x => true, StringComparer.OrdinalIgnoreCase);

            // Check cột có thiếu không
            foreach (var field in requiredFields.Keys)
            {
                if (!dataTable.Columns.Contains(field))
                {
                    errors.Add($"Thiếu cột required: {field}");
                }
            }

            // Nếu thiếu cột, trả lỗi luôn không cần check giá trị
            if (errors.Count > 0)
                return errors;

            // Check giá trị từng dòng
            for (int rowIndex = 0; rowIndex < dataTable.Rows.Count; rowIndex++)
            {
                var row = dataTable.Rows[rowIndex];

                foreach (var field in requiredFields.Keys)
                {
                    var value = row[field];
                    if (value == null || value == DBNull.Value || string.IsNullOrWhiteSpace(value.ToString()))
                    {
                        errors.Add($"Cột '{field}' không có dữ liệu (required).");
                    }
                }
                if (errors.Count > 0)
                {
                    break; // dừng ngay khi có lỗi
                }
            }

            return errors;
        }

        public (Dictionary<string, DataTable> tables, List<string> errors) SplitFlatTableWithHeaderDetection(
                                                                                                            DataTable flatTable,
                                                                                                            SqlJsonDefination masterDef,
                                                                                                            List<SqlJsonDefination>? foreignDefs)
        {
            var result = new Dictionary<string, DataTable>();
            var errors = new List<string>();

            // Mapping bây giờ dùng List<int> để lưu tất cả index trùng
            List<(SqlJsonDefination def, Dictionary<string, List<int>> mapping)>? currentMatchedDefs = null;
            var allDefs = new List<SqlJsonDefination> { masterDef };
            if (foreignDefs != null && foreignDefs.Count > 0)
                allDefs.AddRange(foreignDefs);

            var masterKeys = new List<(string numberKey, string dateKey)>();
            var masterIdKeys = new List<(string pkValue, string numberKey)>();
            //Tìm tất cả dòng header
            var headerRowIndexes = new List<int>();
            for (int i = 0; i < flatTable.Rows.Count; i++)
            {
                var row = flatTable.Rows[i];
                // Detect header
                var matchedDefs = FindAllMatchedDefs(row, allDefs);

                if (matchedDefs.Any())
                {
                    //waitingForData = true;
                    currentMatchedDefs = matchedDefs;
                    headerRowIndexes.Add(i);
                }
            }

            // Xử lý data row
            if (currentMatchedDefs != null)
            {
                for (int i = 0; i < flatTable.Rows.Count; i++)
                {
                    if (headerRowIndexes.Contains(i))
                        continue;
                    var row = flatTable.Rows[i];
                    var idRow = "";
                    string dateKey = "";
                    bool skipAddMasterRow = false;
                    foreach (var (def, mapping) in currentMatchedDefs)
                    {
                        string? voucherNumberVal = null;
                        string? voucherDateVal = null;

                        // MASTER có Partition
                        if (def.Model == masterDef.Model && def.Schema.Partition == true)
                        {
                            // Lấy voucherNumber (master → lấy index đầu tiên)
                            if (mapping.TryGetValue("voucherNumber", out var vnIndexes) && vnIndexes.Count > 0)
                            {
                                var vnColIdx = vnIndexes.First();
                                if (vnColIdx >= 0 && vnColIdx < flatTable.Columns.Count)
                                    voucherNumberVal = row[vnColIdx]?.ToString()?.Trim();
                            }
                            // Nếu voucherNumber chưa có → fallback lấy primaryKey trong schema
                            if (string.IsNullOrWhiteSpace(voucherNumberVal))
                            {
                                // Tìm cột nào được đánh dấu primaryKey = true
                                var primaryKeyField = def.Schema.Fields.FirstOrDefault(f => f.PrimaryKey == true);
                                if (primaryKeyField != null)
                                {
                                    if (mapping.TryGetValue(primaryKeyField.Name, out var pkIndexes) && pkIndexes.Count > 0)
                                    {
                                        var pkColIdx = pkIndexes.First();
                                        if (pkColIdx >= 0 && pkColIdx < flatTable.Columns.Count)
                                            voucherNumberVal = row[pkColIdx]?.ToString()?.Trim();
                                    }
                                }
                            }

                            // Kiểm tra tồn tại trong masterKeys
                            var existedMaster = !string.IsNullOrWhiteSpace(voucherNumberVal)
                                ? masterKeys.FirstOrDefault(x =>
                                    x.numberKey.Equals(voucherNumberVal, StringComparison.OrdinalIgnoreCase))
                                : default;

                            bool isMasterExisted = !string.IsNullOrWhiteSpace(existedMaster.numberKey);

                            if (isMasterExisted)
                            {
                                dateKey = existedMaster.dateKey;
                            }

                            if (string.IsNullOrWhiteSpace(voucherNumberVal))
                            {
                                if (!string.IsNullOrWhiteSpace(dateKey))
                                {
                                    var existedByDate = masterKeys
                                        .FirstOrDefault(x => x.dateKey.Equals(dateKey, StringComparison.OrdinalIgnoreCase));

                                    if (!string.IsNullOrWhiteSpace(existedByDate.numberKey))
                                    {
                                        voucherNumberVal = existedByDate.numberKey;

                                        if (mapping.ContainsKey("voucherNumber"))
                                        {
                                            var vnColIdx = mapping["voucherNumber"].First();
                                            if (vnColIdx >= 0 && vnColIdx < flatTable.Columns.Count)
                                                row[vnColIdx] = voucherNumberVal;
                                        }
                                        else
                                        {
                                            if (!flatTable.Columns.Contains("voucherNumber"))
                                                flatTable.Columns.Add("voucherNumber", typeof(string));
                                            row["voucherNumber"] = voucherNumberVal;
                                        }
                                    }
                                }
                                if (!string.IsNullOrEmpty(voucherNumberVal))
                                    isMasterExisted = true;
                            }

                            // Lấy voucherDate
                            if (mapping.TryGetValue("voucherDate", out var vdIndexes) && vdIndexes.Count > 0)
                            {
                                var vdColIdx = vdIndexes.First();
                                if (vdColIdx >= 0 && vdColIdx < flatTable.Columns.Count)
                                    voucherDateVal = row[vdColIdx]?.ToString()?.Trim();
                            }

                            // Nếu rỗng → gán ngày hiện tại
                            if (string.IsNullOrWhiteSpace(voucherDateVal))
                            {
                                voucherDateVal = DateTime.Now.ToString("yyyy-MM-dd");

                                if (mapping.ContainsKey("voucherDate"))
                                {
                                    var vdColIdx = mapping["voucherDate"].First();
                                    row[vdColIdx] = voucherDateVal;
                                }
                                else
                                {
                                    if (!flatTable.Columns.Contains("voucherDate"))
                                        flatTable.Columns.Add("voucherDate", typeof(string));
                                    row["voucherDate"] = voucherDateVal;
                                }
                            }

                            // Validate: hỗ trợ cả serial date từ Excel (ví dụ: 46360)
                            if (!TryParseImportDate(voucherDateVal, out var parsedDate))
                            {
                                errors.Add($"Dòng {i + 2}: Ngày chứng từ không hợp lệ ({voucherDateVal}) trong bảng {def.Model}.");
                                continue;
                            }
                            // Chuẩn hóa lại dữ liệu ngày để các bước validate/merge sau dùng ổn định
                            voucherDateVal = parsedDate.ToString("yyyy-MM-dd");
                            if (mapping.ContainsKey("voucherDate"))
                            {
                                var vdColIdx = mapping["voucherDate"].First();
                                if (vdColIdx >= 0 && vdColIdx < flatTable.Columns.Count)
                                    row[vdColIdx] = voucherDateVal;
                            }
                            else
                            {
                                if (!flatTable.Columns.Contains("voucherDate"))
                                    flatTable.Columns.Add("voucherDate", typeof(string));
                                row["voucherDate"] = voucherDateVal;
                            }

                            dateKey = parsedDate.ToString("yyyyMM");

                            // Lưu master key nếu chưa tồn tại
                            if (!isMasterExisted)
                                masterKeys.Add((voucherNumberVal!, dateKey));
                            else
                                skipAddMasterRow = true;
                        }
                        else if (def.Model == masterDef.Model && def.Schema.Multiple == true)
                        {
                            // Tìm field nào được đánh dấu PrimaryKey = true
                            var primaryKeyField = def.Schema.Fields.FirstOrDefault(f => f.PrimaryKey == true);
                            if (primaryKeyField != null)
                            {
                                // Lấy giá trị khóa chính từ row
                                if (mapping.TryGetValue(primaryKeyField.Name, out var pkIndexes) && pkIndexes.Count > 0)
                                {
                                    var pkColIdx = pkIndexes.First();
                                    if (pkColIdx >= 0 && pkColIdx < flatTable.Columns.Count)
                                        voucherNumberVal = row[pkColIdx]?.ToString()?.Trim();
                                }
                            }

                            // Kiểm tra tồn tại trong masterKeys (so sánh theo numberKey = primaryKey)
                            var existedMaster = !string.IsNullOrWhiteSpace(voucherNumberVal)
                                ? masterKeys.FirstOrDefault(x =>
                                    x.numberKey.Equals(voucherNumberVal, StringComparison.OrdinalIgnoreCase))
                                : default;

                            bool isMasterExisted = !string.IsNullOrWhiteSpace(existedMaster.numberKey);

                            // Với Multiple không có dateKey → có thể set rỗng hoặc null
                            dateKey = string.Empty;

                            // Nếu chưa có thì thêm vào masterKeys
                            if (!isMasterExisted)
                                masterKeys.Add((voucherNumberVal!, dateKey));
                            else
                                skipAddMasterRow = true;
                        }
                        // DETAIL
                        else if (def.Model != masterDef.Model && foreignDefs != null)
                        {
                            foreach (var detailDef in foreignDefs)
                            {
                                if (detailDef.Model != def.Model) continue;

                                string? detailVoucherNumber = null;

                                // Ưu tiên: Detail → lấy index cuối cùng của voucherNumber
                                if (mapping.TryGetValue("voucherNumber", out var vnIndexes) && vnIndexes.Count > 0)
                                {
                                    var vnColIdx = vnIndexes.Last();
                                    if (vnColIdx >= 0 && vnColIdx < flatTable.Columns.Count)
                                        detailVoucherNumber = row[vnColIdx]?.ToString()?.Trim();
                                }

                                // Nếu detail không có voucherNumber → lấy từ master (nếu có)
                                if (string.IsNullOrWhiteSpace(detailVoucherNumber))
                                {
                                    var masterMapping = currentMatchedDefs
                                        .FirstOrDefault(x => x.def.Model == masterDef.Model)
                                        .mapping;

                                    if (masterMapping != null && masterMapping.TryGetValue("voucherNumber", out var masterVnIndexes))
                                    {
                                        var vnColIdx = masterVnIndexes.First();
                                        if (vnColIdx >= 0 && vnColIdx < flatTable.Columns.Count)
                                            detailVoucherNumber = row[vnColIdx]?.ToString()?.Trim();
                                    }
                                }

                                // Nếu master cũng không có voucherNumber → lấy PrimaryKey của master
                                if (string.IsNullOrWhiteSpace(detailVoucherNumber))
                                {
                                    var primaryKeyField = masterDef.Schema.Fields.FirstOrDefault(f => f.PrimaryKey == true);
                                    if (primaryKeyField != null)
                                    {
                                        var masterMapping = currentMatchedDefs
                                            .FirstOrDefault(x => x.def.Model == masterDef.Model)
                                            .mapping;

                                        if (masterMapping != null && masterMapping.TryGetValue(primaryKeyField.Name, out var pkIndexes) && pkIndexes.Count > 0)
                                        {
                                            var pkColIdx = pkIndexes.First();
                                            if (pkColIdx >= 0 && pkColIdx < flatTable.Columns.Count)
                                                detailVoucherNumber = row[pkColIdx]?.ToString()?.Trim();
                                        }
                                    }
                                }

                                // Cuối cùng: nếu có số chứng từ hoặc PK thì match với master
                                if (!string.IsNullOrWhiteSpace(detailVoucherNumber))
                                {
                                    var matchedMaster = masterKeys
                                        .FirstOrDefault(x =>
                                            x.numberKey.Equals(detailVoucherNumber, StringComparison.OrdinalIgnoreCase));

                                    if (!string.IsNullOrWhiteSpace(matchedMaster.numberKey))
                                    {
                                        dateKey = matchedMaster.dateKey;
                                        voucherNumberVal = detailVoucherNumber;
                                    }
                                }
                            }
                        }


                        if (skipAddMasterRow && def.Model == masterDef.Model) continue;

                        var tableKey = def.Schema.Partition == true ? $"{def.Model}${dateKey}" : $"{def.Model}";
                        if (!result.ContainsKey(tableKey))
                        {
                            var table = new DataTable();
                            foreach (var col in def.Schema.Fields)
                                table.Columns.Add(col.Name);
                            result[tableKey] = table;
                        }

                        var currentTable = result[tableKey];
                        var newRow = currentTable.NewRow();

                        bool isIdExistByVoucherNumber = false;
                        // Bước 1: đọc toàn bộ cellValue trước
                        var fieldValues = new Dictionary<string, object?>();
                        foreach (var fieldDef in def.Schema.Fields)
                        {
                            var fieldName = fieldDef.Name;
                            object? cellValue = null;

                            if (mapping.TryGetValue(fieldName, out var indexes) && indexes.Count > 0)
                            {
                                int fieldIdx = (indexes.Count > 1)
                                    ? (def.Model == masterDef.Model ? indexes.First() : indexes.Last())
                                    : indexes[0];

                                if (fieldIdx >= 0 && fieldIdx < row.ItemArray.Length)
                                    cellValue = row[fieldIdx];
                            }
                            else
                            {
                                if (flatTable.Columns.Contains(fieldName))
                                    cellValue = row[fieldName];
                                else
                                    cellValue = DBNull.Value;
                            }

                            fieldValues[fieldName] = cellValue;
                        }

                        // Bước 2: xử lý voucherNumber trước
                        string? voucherNumberStr = null;
                        if (fieldValues.TryGetValue("voucherNumber", out var vnVal) && vnVal != null)
                            voucherNumberStr = vnVal.ToString()?.Trim();

                        // Nếu có voucherNumber → ưu tiên ánh xạ masterIdKeys
                        if (!string.IsNullOrWhiteSpace(voucherNumberStr))
                        {
                            var pkName = def.Schema.Fields.FirstOrDefault(f => f.PrimaryKey == true)?.Name;
                            var dbMasterId = GetExistingIdByVoucherNumber(pkName, voucherNumberStr, tableKey);

                            if (!string.IsNullOrWhiteSpace(dbMasterId))
                            {
                                // update/insert vào masterIdKeys
                                var existingIdx = masterIdKeys.FindIndex(x =>
                                    x.numberKey.Equals(voucherNumberStr, StringComparison.OrdinalIgnoreCase));
                                if (existingIdx >= 0)
                                    masterIdKeys[existingIdx] = (dbMasterId, voucherNumberStr);
                                else
                                    masterIdKeys.Add((dbMasterId, voucherNumberStr));

                                // nếu PK hiện tại đang rỗng → gán luôn id này
                                if (pkName != null && string.IsNullOrWhiteSpace(fieldValues[pkName]?.ToString()))
                                {
                                    fieldValues[pkName] = dbMasterId;
                                    isIdExistByVoucherNumber = true;
                                }
                            }
                        }

                        foreach (var fieldDef in def.Schema.Fields)
                        {
                            var fieldName = fieldDef.Name;
                            object? cellValue = null;

                            if (mapping.TryGetValue(fieldName, out var indexes) && indexes.Count > 0)
                            {
                                int fieldIdx = (indexes.Count > 1)
                                    ? (def.Model == masterDef.Model ? indexes.First() : indexes.Last())
                                    : indexes[0];

                                if (fieldIdx >= 0 && fieldIdx < row.ItemArray.Length)
                                    cellValue = row[fieldIdx];
                            }
                            else
                            {
                                if (flatTable.Columns.Contains(fieldName))
                                    cellValue = row[fieldName];
                                else
                                    cellValue = DBNull.Value;
                            }

                            cellValue = NormalizeLookupCellValueForImport(def, fieldName, cellValue);
                            //nếu khóa chính có mà ở bảng master thì gán vào masterIdKey
                            if (fieldDef.PrimaryKey == true && !string.IsNullOrWhiteSpace(cellValue?.ToString()) && def.Model == masterDef.Model)
                            {
                                masterIdKeys.Add((cellValue!.ToString()!, cellValue!.ToString()!));
                                idRow = cellValue.ToString();
                            }

                            // Xử lý khóa chính rỗng
                            if (fieldDef.PrimaryKey == true && string.IsNullOrWhiteSpace(cellValue?.ToString()))
                            {
                                if (def.Model == masterDef.Model)
                                {
                                    if (isIdExistByVoucherNumber)
                                    {
                                        cellValue = fieldValues[fieldDef.Name];
                                    }
                                    else
                                    {
                                        var newGuid = Guid.NewGuid().ToString();

                                        if (mapping.ContainsKey(fieldName))
                                        {
                                            var idx = mapping[fieldName].First();
                                            // Tìm column mapping tương ứng trong ExcelIntegration
                                            var colMap = masterDef.ExcelIntegration.ColumnMapping
                                                .FirstOrDefault(c => c.FieldName.Equals(fieldName, StringComparison.OrdinalIgnoreCase));

                                            if (colMap?.Required != true) // Chỉ tạo Guid nếu không bắt buộc
                                            {
                                                if (idx >= 0 && idx < row.ItemArray.Length)
                                                    row[idx] = newGuid;
                                            }
                                            else
                                            {
                                                throw new ExceptionFormat($"Khóa chính của bảng ({def.Model}) không được để trống");
                                            }
                                        }
                                        else
                                        {
                                            if (!flatTable.Columns.Contains(fieldName))
                                                flatTable.Columns.Add(fieldName, typeof(string));
                                            row[fieldName] = newGuid;
                                        }

                                        cellValue = newGuid;
                                        //if (!string.IsNullOrWhiteSpace(voucherNumberVal))
                                        masterIdKeys.Add((cellValue!.ToString()!, voucherNumberVal ?? cellValue!.ToString()!));
                                    }
                                }
                                else
                                {
                                    string? matchedMasterId = null;
                                    if (!string.IsNullOrWhiteSpace(voucherNumberVal))
                                    {
                                        matchedMasterId = masterIdKeys
                                            .FirstOrDefault(x =>
                                                x.numberKey.Equals(voucherNumberVal, StringComparison.OrdinalIgnoreCase)).pkValue;
                                    }
                                    else
                                    {
                                        matchedMasterId = masterIdKeys
                                           .FirstOrDefault(x =>
                                               x.numberKey.Equals(idRow, StringComparison.OrdinalIgnoreCase)).pkValue;
                                    }
                                    if (!string.IsNullOrWhiteSpace(matchedMasterId))
                                    {
                                        cellValue = matchedMasterId;

                                        if (mapping.ContainsKey(fieldName))
                                        {
                                            var idx = mapping[fieldName].First();
                                            if (idx >= 0 && idx < row.ItemArray.Length)
                                                row[idx] = matchedMasterId;
                                        }
                                        else
                                        {
                                            if (!flatTable.Columns.Contains(fieldName))
                                                flatTable.Columns.Add(fieldName, typeof(string));
                                            row[fieldName] = matchedMasterId;
                                        }
                                    }

                                }
                            }

                            newRow[fieldName] = cellValue ?? DBNull.Value;
                        }

                        // Check required data
                        var tempTable = currentTable.Clone();
                        tempTable.Rows.Add(newRow.ItemArray);
                        var missingDataErrors = CheckMissingRequiredData(tempTable, def.ExcelIntegration);
                        if (missingDataErrors.Count > 0)
                        {
                            errors.AddRange(missingDataErrors);
                            return (result, errors);

                        }

                        currentTable.Rows.Add(newRow);
                    }
                }
            }

            if (!result.Any())
                errors.Add("Không tìm thấy bảng nào phù hợp trong file.");

            return (result, errors);
        }

        private static object? NormalizeLookupCellValueForImport(SqlJsonDefination def, string fieldName, object? value)
        {
            if (value == null || value == DBNull.Value) return value;

            var raw = value.ToString();
            if (string.IsNullOrWhiteSpace(raw)) return value;

            // Chỉ áp dụng cho cột có lookup import (có ClauseForiegn) theo format "CODE - NAME"
            var colMap = def.ExcelIntegration?.ColumnMapping?
                .FirstOrDefault(c =>
                    c != null &&
                    !string.IsNullOrWhiteSpace(c.FieldName) &&
                    c.FieldName.Equals(fieldName, StringComparison.OrdinalIgnoreCase) &&
                    !string.IsNullOrWhiteSpace(c.ClauseForiegn));

            if (colMap == null) return value;

            var separatorIndex = raw.IndexOf(" - ", StringComparison.Ordinal);
            if (separatorIndex <= 0) return value;

            return raw.Substring(0, separatorIndex).Trim();
        }

        private static bool TryParseImportDate(string? rawValue, out DateTime parsedDate)
        {
            parsedDate = default;
            if (string.IsNullOrWhiteSpace(rawValue))
                return false;

            var raw = rawValue.Trim();

            if (DateTime.TryParse(raw, out parsedDate))
                return true;

            // Excel serial date (OADate), ví dụ 46360
            if (double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var oa) ||
                double.TryParse(raw, NumberStyles.Any, CultureInfo.CurrentCulture, out oa))
            {
                try
                {
                    parsedDate = DateTime.FromOADate(oa);
                    return true;
                }
                catch
                {
                    // ignore invalid OADate
                }
            }

            return false;
        }

        private string? GetExistingIdByVoucherNumber(string? pk, string voucherNumber, string tableName)
        {
            if (string.IsNullOrWhiteSpace(pk))
                throw new ArgumentException("Primary key column name is required", nameof(pk));
            using (var connection = new SqlConnection(_dbConnect.ConnectionString))
            {
                connection.Open();
                using (var cmd = new SqlCommand($@"
                        SELECT TOP 1 {pk} 
                        FROM {tableName} 
                        WHERE voucherNumber = @voucherNumber AND status = '1'", connection))
                {
                    cmd.Parameters.AddWithValue("@voucherNumber", voucherNumber);

                    var result = cmd.ExecuteScalar();
                    return result != null ? result.ToString() : null;
                }
            }
        }

        private static List<(SqlJsonDefination def, Dictionary<string, List<int>> mapping)> FindAllMatchedDefs(
                                                                                            DataRow headerRow, List<SqlJsonDefination> defs, double threshold = 0.1)
        {
            var headerFields = headerRow.ItemArray.Select(x => CleanColumnName(x?.ToString() ?? "")).ToList();

            var matchedDefs = new List<(SqlJsonDefination, Dictionary<string, List<int>>)>();

            foreach (var def in defs)
            {
                // Nếu không có ExcelIntegration hoặc không có ColumnMapping thì bỏ qua luôn
                if (def?.ExcelIntegration?.ColumnMapping == null || def.ExcelIntegration.ColumnMapping.Count == 0)
                    continue;
                var fieldMap = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
                int matched = 0;

                for (int i = 0; i < headerFields.Count; i++)
                {
                    var header = headerFields[i];

                    var found = def.ExcelIntegration.ColumnMapping
                        .FirstOrDefault(c => CleanColumnName(c.FieldName) == header)
                        ?? def.ExcelIntegration.ColumnMapping
                            .FirstOrDefault(c => CleanColumnName(c.ExcelColumn) == header);

                    if (found != null)
                    {
                        if (!fieldMap.ContainsKey(found.FieldName))
                            fieldMap[found.FieldName] = new List<int>();

                        fieldMap[found.FieldName].Add(i);
                        matched++;
                    }
                }

                double score = (double)matched / def.ExcelIntegration.ColumnMapping.Count;

                if (score >= threshold && matched > 0)
                {
                    matchedDefs.Add((def, fieldMap));
                }
            }

            return matchedDefs;
        }


        private static string CleanColumnName(string input)
        {
            return input.Replace("*", "").Trim().ToLower();
        }
        #endregion
    }
}
