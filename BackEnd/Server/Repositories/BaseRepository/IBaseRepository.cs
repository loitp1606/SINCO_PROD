using Sinco.Server.Models;
using Sinco.Server.SqlJsonDefinations;
using Sinco.Server.SqlJsonDefinations.Responses;
using System.Data;


namespace Sinco.Server.Repositories.BaseRepository
{
	public interface IBaseRepository<T> where T : class
	{
		Task<List<Dictionary<string , List<Dictionary<string , object>>>>> GetTablesAsync(string suffix, string ids, Dictionary<string, List<string>> expectedCols);
		Task<dynamic?> GetByIdAsync(object id , string tableName , string? keyName);
        /// <summary>
        /// Delete Multi data
        /// </summary>
        /// <param name="ids">List ID</param>
        /// <param name="tableName">TableName want delete</param>
        /// <param name="status">Status if change</param>
        /// <param name="primaryKey">Primary key table want delete</param>
        /// <returns></returns>
        /// <exception cref="ArgumentNullException"></exception>
        /// <exception cref="Exception"></exception>
        Task<int> DeleteMultiAsync(List<string> ids, string tableName, string status, string primaryKey);
        Task<int> UpsertMultipleTablesAsync(Dictionary<string, DataTable> dataTables, SqlJsonDefination masterDef, List<SqlJsonDefination> foreignDefs, Dictionary<string, object>? userAssign, bool? overWrite);
        Task<int> UpsertAsyncQuaquotationPaper(Dictionary<string, DataTable> dataTables, SqlJsonDefination masterDef, List<SqlJsonDefination> foreignDefs, Dictionary<string, object>? userAssign, bool? overWrite);

		(Dictionary<string, DataTable> tables, List<string> errors) SplitFlatTableWithHeaderDetection(DataTable flatTable, SqlJsonDefination masterDef, List<SqlJsonDefination>? foreignDefs);
        /// <summary>
        /// Hàm lấy ID và name từ db
        /// </summary>
        /// <param name="sql"></param>
        /// <returns></returns>
        Task<List<(string Code, string? Name)>> GetForeignDataAsync(string sql);

        Task<SqlJsonDefination> GetTemplateByTableNameAsync(string tableName);
		Task<List<SqlJsonDefination>> GetAllTemplateDefinitionsAsync();
		Task<MetadataResponse> GetTemplateMetadataByTableNameAsync(string tableName);
	}
}
