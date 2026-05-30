using System.Collections.Generic;

namespace Sinco.Server.Models
{
    public class DynamicReportResponse
    {
        public string Type { get; set; } = string.Empty;
        public string Action { get; set; } = string.Empty;
        public string Language { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public string Title2 { get; set; } = string.Empty;
        public List<Dictionary<string, object>> Data { get; set; } = new List<Dictionary<string, object>>();
        public List<ReportHeaderColumn> Header { get; set; } = new List<ReportHeaderColumn>();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public string Sort { get; set; } = string.Empty;
        public List<ReportFilterItem> Filters { get; set; } = new List<ReportFilterItem>();
        public ReportDataProcessing? DataProcessing { get; set; }
    }

    public class ReportHeaderColumn
    {
        public string Label { get; set; } = string.Empty;
        public string Key { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public int Width { get; set; }
        public string Align { get; set; } = string.Empty;
        public string Format { get; set; } = string.Empty;
    }

    public class ReportFilterItem
    {
        public string Key { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;
        public string Placeholder { get; set; } = string.Empty;
        public bool Required { get; set; } = false;
        public object? Default { get; set; }  // Có thể là string hoặc ReportFilterDefault object
        public List<ReportFilterOption>? Options { get; set; }
    }

    public class ReportFilterDefault
    {
        public string Controller { get; set; } = string.Empty;
        public List<ReportFilterCondition> Filter { get; set; } = new List<ReportFilterCondition>();
    }

    public class ReportFilterCondition
    {
        public string Field { get; set; } = string.Empty;
        public string Value { get; set; } = string.Empty;
        public string Operator { get; set; } = string.Empty;
    }

    public class ReportFilterOption
    {
        public string Label { get; set; } = string.Empty;
        public string Value { get; set; } = string.Empty;
    }

    public class ReportDataProcessing
    {
        public List<ReportQueryConfig> Report { get; set; } = new List<ReportQueryConfig>();
    }

    public class ReportQueryConfig
    {
        public string Query { get; set; } = string.Empty;
    }
}

