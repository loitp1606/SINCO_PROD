using reportSystem01.Shared;
using Sinco.Server.Models;

namespace Sinco.Server.Repositories.Report
{
    public interface IDynamicReportService
    {
        Task<ServiceResponse<DynamicReportResponse>> ProcessReportAsync(DynamicReportRequest request);
        Task<List<Dictionary<string, object>>> ExecuteQueryAsync(string query);
    }
}

