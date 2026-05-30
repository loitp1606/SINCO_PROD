using System.Collections.Generic;

namespace Sinco.Server.Models
{
    public class DynamicReportRequest
    {
        public string Controller { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public string Action { get; set; } = string.Empty;
        public Dictionary<string, string> Param { get; set; } = new Dictionary<string, string>();
    }
}

