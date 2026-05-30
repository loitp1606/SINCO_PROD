using reportSystem01.Shared;

namespace Sinco.Server.Repositories
{
    public interface ITaxExcelExportService
    {
        Task<ServiceResponse<MemoryStream>> ExportTaxExcelAsync(ReportRequest request);
    }
}

