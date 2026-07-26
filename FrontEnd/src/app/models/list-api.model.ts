export interface ListApiResponse {
  controller: string
  tableName: string
  primaryKey: string[]
  language: string
  unit: string
  idVC: string
  type: string
  action: string
  sort: string
  userId: string
  data: Record<string, string>[]
  total: number
  page: number
  pageSize: number
  isFileHandle?: string
}

export interface FormIdParams {
  controller: string
  tableName: string
  primaryKey: string[]
  type: string
  action: string
  sort: string
  language: string
  unit: string
  idVC: string
  userId: string
  listTable: string[]
}

export interface DetailApiQuery {
  controller: string
  formId: string
  primaryKey: string[]
  value: string[]
  type: string
  action: string
  language: string
  unit: string
  idVC: string
  userId: string
  VCDate: string
  listTable: string[]
  data?: any,
  isFileHandle?: string,
  isOption?: boolean,
  options?: { [key: number]: string },
  enableTaxExcelExport?: boolean,
  taxExcelExportConfig?: string,
  dataProcessing?: { actions: { post: any[] } }
}

export interface ListApiQuery {
  formId: DetailApiQuery
  filter?: FilterCondition[]
  page?: number
  pageSize?: number
  sort?: string
}

export interface FilterCondition {
  id: string
  field: string
  operator: string
  value: any
  columnType?: string
  lookupController?: string
}

export interface ApiResponse {
  Data: any
}

export interface GirdInitData {
  id: string
  title?: string
  headers: GirdHeader[]
  query: ListApiQuery
  sort: string
  actions: GridAction[]
  mode?: string
  width?: string
  ui?: GridUiConfig
}

export interface GridUiConfig {
  summary?: GridSummaryConfig
}

export interface GridSummaryConfig {
  field: string
  label?: string
  format?: 'number' | 'currency'
}

export interface GridAction {
  controller: string
  id: string
  label: string
  target: string
  color: string
  isCopy?: boolean
}

export interface GirdHeader {
  key: string
  label: string
  type: string
  lookupController?: string
  sortable?: boolean
  hidden?: boolean
  quickEditable?: boolean
  width?: string
  currency?: string
  format?: string
  sum?: boolean
  options?: { label: string; value: any }[]
}


export interface ReportListResponse {
  data: Record<string, any>[];
  total: number;
  page: number;
  pageSize: number;
  filters: ReportFilterField[];
  header: ReportHeaderField[];
  sort?: string;
  title?: string;
}

export interface ReportHeaderField {
  label: string;
  key: string;
  type: string;
  width: number;
  align: string;
  format: string;
}

export interface ReportFilterField {
  key: string;
  label: string;
  type: string;
  options?: Array<{ label: string; value: string | number }>;
  default?: any;
  required: boolean;
  placeholder?: string;
}
