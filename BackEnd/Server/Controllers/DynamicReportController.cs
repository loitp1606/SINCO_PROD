using Microsoft.AspNetCore.Mvc;
using reportSystem01.Shared;
using Sinco.Server.Models;
using Sinco.Server.Repositories.Report;

namespace Sinco.Server.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class DynamicReportController : ControllerBase
    {
        private readonly IDynamicReportService _dynamicReportService;
        private readonly ILogger<DynamicReportController> _logger;

        public DynamicReportController(IDynamicReportService dynamicReportService, ILogger<DynamicReportController> logger)
        {
            _dynamicReportService = dynamicReportService;
            _logger = logger;
        }

        /// <summary>
        /// API xử lý report động
        /// </summary>
        /// <param name="request">
        /// Request chứa:
        /// - controller: tên file JSON (vd: "reportTest.json")
        /// - type: loại report (vd: "report")
        /// - action: "loading" (chỉ lấy cấu trúc) hoặc "finding" (lấy data)
        /// - param: dictionary các tham số cho stored procedure (chỉ dùng khi action = "finding")
        /// </param>
        /// <returns>Cấu hình report và data (nếu action = "finding")</returns>
        [HttpPost("processReport")]
        public async Task<ActionResult<ServiceResponse<DynamicReportResponse>>> ProcessReport([FromBody] DynamicReportRequest request)
        {
            try
            {
                // Validate request
                if (string.IsNullOrEmpty(request.Controller))
                {
                    return BadRequest(ServiceResponse<DynamicReportResponse>.CreateError("Controller không được để trống"));
                }

                if (string.IsNullOrEmpty(request.Action))
                {
                    return BadRequest(ServiceResponse<DynamicReportResponse>.CreateError("Action không được để trống"));
                }

                // Xử lý report
                var result = await _dynamicReportService.ProcessReportAsync(request);

                if (!result.Success)
                {
                    return BadRequest(result);
                }

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lỗi khi xử lý dynamic report");
                return StatusCode(500, ServiceResponse<DynamicReportResponse>.CreateError($"Lỗi server: {ex.Message}"));
            }
        }
    }
}

