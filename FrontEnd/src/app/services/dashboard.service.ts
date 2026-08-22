import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, of, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';
import { FilterCondition, ListApiResponse } from '../models';

interface DashboardListConfig {
  controller: string;
  formId: string;
  idVC: string;
  listTable: string[];
  sort: string;
}

interface ReportFilterField {
  key: string;
  type: string;
  default?: any;
  required?: boolean;
  options?: Array<{ label: string; value: string | number }>;
}

interface ReportListResponse {
  data: Record<string, any>[];
  filters: ReportFilterField[];
  total: number;
}

@Injectable({
  providedIn: 'root',
})
export class DashboardService {
  private readonly defaultPageSize = 2000;

  constructor(private readonly http: HttpClient) {}

  loadQuotationList(dateFrom?: Date, dateTo?: Date): Observable<ListApiResponse> {
    return this.loadList({
      controller: 'quotationPaper.page.json',
      formId: 'QuotationPaper',
      idVC: 'Z02',
      listTable: ['QuotationPaper', 'QuotationPaperDetail'],
      sort: 'voucherDate desc, voucherNumber desc',
    }, dateFrom, dateTo);
  }

  loadOrderList(dateFrom?: Date, dateTo?: Date): Observable<ListApiResponse> {
    return this.loadList({
      controller: 'Order.page.json',
      formId: 'Order',
      idVC: 'Z02',
      listTable: ['Order', 'OrderDetail'],
      sort: 'voucherDate desc, voucherNumber desc',
    }, dateFrom, dateTo);
  }

  loadDeliveryNoteList(dateFrom?: Date, dateTo?: Date): Observable<ListApiResponse> {
    return this.loadList({
      controller: 'deliveryNote.page.json',
      formId: 'deliveryNote',
      idVC: 'Z05',
      listTable: ['deliveryNote', 'deliveryNoteDetail'],
      sort: 'voucherDate desc, voucherNumber desc',
    }, dateFrom, dateTo);
  }

  loadReceiptList(dateFrom?: Date, dateTo?: Date): Observable<ListApiResponse> {
    return this.loadList({
      controller: 'receiptV2.page.json',
      formId: 'receiptV2',
      idVC: 'Z07',
      listTable: ['receiptV2', 'receiptdetailV2'],
      sort: 'voucherDate desc, voucherNumber desc',
    }, dateFrom, dateTo);
  }

  loadBcdtlnReport(dateFrom: Date, dateTo: Date): Observable<Record<string, any>[]> {
    return this.http
      .post<{ data: ReportListResponse }>(
        `${environment.apiUrl}/api/DynamicReport/processReport`,
        {
          controller: 'bcdtln.json',
          type: 'report',
          action: 'loading',
          param: {},
        },
        {
          headers: {
            accept: 'text/plain',
            'Content-Type': 'application/json',
          },
        },
      )
      .pipe(
        map((res) => res?.data),
        switchMap((meta) => {
          if (!meta) {
            return of({ data: { data: [], filters: [], total: 0 } as ReportListResponse });
          }
          const param: Record<string, any> = {};
          (meta?.filters || []).forEach((f) => {
            if (f.type === 'lookup') {
              param[f.key] = '';
              return;
            }
            const defaultValue =
              f.default ?? (f.required && Array.isArray(f.options) && f.options.length > 0
                ? f.options[0].value
                : '');
            param[f.key] = defaultValue;
          });
          param['userId'] = localStorage.getItem('userId') ?? '';
          param['language'] = localStorage.getItem('language') ?? 'vi';

          const fromDate = this.formatDateYmd(dateFrom);
          const toDate = this.formatDateYmd(dateTo);

          for (const key of Object.keys(param)) {
            const lower = key.toLowerCase();
            if (
              (lower.includes('from') ||
                lower.includes('tu_ngay') ||
                lower.includes('ngay_tu')) &&
              this.looksLikeDateField(lower)
            ) {
              param[key] = fromDate;
            }
            if (
              (lower.includes('to') ||
                lower.includes('den_ngay') ||
                lower.includes('ngay_den')) &&
              this.looksLikeDateField(lower)
            ) {
              param[key] = toDate;
            }
          }

          return this.http.post<{ data: ReportListResponse }>(
            `${environment.apiUrl}/api/DynamicReport/processReport`,
            {
              controller: 'bcdtln.json',
              type: 'report',
              action: 'finding',
              param,
            },
            {
              headers: {
                accept: 'text/plain',
                'Content-Type': 'application/json',
              },
            },
          ).pipe(
            catchError(() =>
              of({
                data: { data: [], filters: meta.filters || [], total: 0 } as ReportListResponse,
              }),
            ),
          );
        }),
        map((res) => res?.data?.data || []),
        catchError(() => of([])),
      );
  }

  private loadList(
    config: DashboardListConfig,
    dateFrom?: Date,
    dateTo?: Date,
  ): Observable<ListApiResponse> {
    const formId = {
      controller: config.controller,
      formId: config.formId,
      primaryKey: ['idGui'],
      type: 'voucher',
      action: 'loading',
      language: localStorage.getItem('language') ?? 'vi',
      unit: localStorage.getItem('unit') ?? environment.unit ?? 'CTY',
      idVC: config.idVC,
      userId: localStorage.getItem('userId') ?? '',
      value: [],
      listTable: config.listTable,
      VCDate: '',
      isFileHandle: 'both',
    };

    const filters: FilterCondition[] = [];
    if (dateFrom) {
      filters.push({
        id: 'dashboard-date-from',
        field: 'voucherDate',
        operator: '>=',
        value: this.formatDateYmd(dateFrom),
        columnType: 'date',
      });
    }
    if (dateTo) {
      filters.push({
        id: 'dashboard-date-to',
        field: 'voucherDate',
        operator: '<=',
        value: this.formatDateYmd(dateTo),
        columnType: 'date',
      });
    }

    const params = new HttpParams()
      .set('formId', JSON.stringify(formId))
      .set('filter', JSON.stringify(filters))
      .set('page', '1')
      .set('pageSize', String(this.defaultPageSize))
      .set('sort', config.sort);

    return this.http.get<ListApiResponse>(
      `${environment.apiUrl}/api/Dynamic/filter`,
      { params },
    );
  }

  private formatDateYmd(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private looksLikeDateField(key: string): boolean {
    return (
      key.includes('date') ||
      key.includes('ngay') ||
      key.includes('tu') ||
      key.includes('den')
    );
  }
}
