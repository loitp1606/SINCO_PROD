using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Sinco.Server.Repositories;
using System.IO;
using System.Text;

namespace Sinco.Server.Controllers
{
	[Route("api/AttachedFile")]
	[ApiController]
	public class FilesController : ControllerBase
	{
		private readonly IFileService _fileService;
		public FilesController(IFileService fileService)
		{
			_fileService = fileService;
		}

		[HttpPost("import-file")]
		public async Task<IActionResult> ImportFile([FromForm] FileRequest fileRequest)
		{
			if ( fileRequest.Type == "import" && fileRequest.File == null )
			{
				return BadRequest(new
				{
					message = "File is required." ,
				});
			}

			if ( string.IsNullOrEmpty(fileRequest.Controll) )
			{
				return BadRequest(new
				{
					message = "Controller name is required." ,
				});
			}

			var result = await _fileService.ImportFileAsync(fileRequest);

			// Nếu là trả về file mẫu thì trả ra dạng file
			if ( fileRequest.Type == "template" )
			{
				if ( !result.Success || result.Data is not ImportFileResponse fileResult )
				{
					return BadRequest(new
					{
						message = result.Message ?? "Tạo file mẫu thất bại." ,
						data = result.Data
					});
				}

				return File(fileResult.FileBytes , fileResult.ContentType , fileResult.FileName);
			}

			// Còn lại là kết quả xử lý import (hoặc lỗi định dạng)

			return StatusCode(result.StatusCode, new
			{
				succes = result.Success,
				message = result.Message,
				data = result.Data
			});
		}


		[HttpPost("export")]
		public async Task<IActionResult> ExportPdf([FromBody] ReportRequest request)
			{
			if ( string.IsNullOrEmpty(request.Controll) )
			{
				return BadRequest("Table name is required");
			}

			var result = await _fileService.ExportPdfAsync(request);
			if ( result.Success == true && result.Data != null )
			{
                var fileName = result.Message;
                var contentType = !string.IsNullOrEmpty(result.Note)
                            ? "text/plain" // Trường hợp trả về Note (dữ liệu tạm)
                            : fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)
                                ? "application/pdf"
                                : fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                                    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    : fileName.EndsWith(".docx", StringComparison.OrdinalIgnoreCase)
                                        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" // <-- CONTENT TYPE CHO DOCX
                                        : "application/octet-stream"; // Loại mặc định
                HttpContext.Response.Headers["X-Debug-Filename"] = fileName;
                HttpContext.Response.Headers["X-Debug-Content-Type"] = contentType;
                MemoryStream outputStream = result.Data;
                if (outputStream == null && result.Note != null)
                {
                    outputStream = new MemoryStream(Encoding.UTF8.GetBytes(result.Note));
                }
				if(outputStream != null)
				{
                    outputStream.Position = 0; // reset pointer
					return File(outputStream, contentType , fileName);

				}
				return BadRequest("Can not conver note to stream");
            }
			else
			{
				return BadRequest(result);
			}
		}

        [HttpPost("export-deliverynote-tax")]
        public async Task<IActionResult> ExportDeliveryNoteTax([FromBody] ReportRequest request)
        {
            if (string.IsNullOrEmpty(request.Controll))
            {
                return BadRequest("Table name is required");
            }

            var result = await _fileService.ExportDeliveryNoteTaxExcelAsync(request);
            if (result.Success && result.Data != null)
            {
                var fileName = string.IsNullOrWhiteSpace(result.Message)
                    ? $"deliverynote_tax_{DateTime.Now:yyyyMMddHHmmss}.xlsx"
                    : result.Message;
                result.Data.Position = 0;
                return File(
                    result.Data,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    fileName
                );
            }

            return BadRequest(result);
        }
	}
}
