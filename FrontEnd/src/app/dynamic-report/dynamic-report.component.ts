import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  FormGroup,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  ValidatorFn,
} from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ReportListResponse, LookupApiResponse } from '../models';
import { DynamicPaginationComponent } from '../dynamic-pagination/dynamic-pagination.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { DynamicLookupComponent } from '../dynamic-lookup/dynamic-lookup.component';
import { environment } from '../../environments/environment';
import * as XLSX from 'xlsx';
import * as FileSaver from 'file-saver';
import { FileHandleComponent } from "../file-handle/file-handle.component";
const EXCEL_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8';
const EXCEL_EXTENSION = '.xlsx';
const localeMap: { [key: string]: string } = {
  'vi': 'vi-VN',
  'en': 'en-US',
}
@Component({
  selector: 'app-report',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    DynamicPaginationComponent,
    DynamicLookupComponent,
    MatButtonModule,
    MatIconModule,
    TranslateModule,
    ReactiveFormsModule,
    FileHandleComponent
],
  templateUrl: './dynamic-report.component.html',
  styles: [`
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `]
})
export class DynamicReportComponent implements OnInit {
  response?: ReportListResponse;
  filterForm!: FormGroup;
  page: number = 1;
  data: Record<string, any>[] = [];
  filteredData: Record<string, any>[] = [];
  columnFilters: { [key: string]: string } = {};
  isFileHandle: string | undefined = "export";
  userData: { [key: string]: string } = {};
  exportData: { [key: string]: any[] } = {};
  pageSize: number = 200;
  readonly pageSizeOptions: number[] = [10, 20, 50, 100, 200];
  showFilter: boolean = true;
  constructor(private http: HttpClient, private fb: FormBuilder) { }
  lookupMap: Record<string, LookupApiResponse> = {};
  @Input({ required: true }) controller!: string;
  ngOnInit(): void {
    this.http
      .post<{ data: ReportListResponse }>(
        `${environment.apiUrl}/api/DynamicReport/processReport`,
        {
          controller: this.controller,
          type: 'report',
          action: 'loading',
          param: {},
        },
        {
          headers: {
            accept: 'text/plain',
            'Content-Type': 'application/json',
          },
        }
      )
      .subscribe(async (meta) => {
        this.response = meta.data;
        this.initFilterForm();
        this.initColumnFilters();
      });
  }

  initFilterForm(): void {
    const formControls: Record<string, any> = {};
    for (const field of this.response?.filters || []) {
      const validators: ValidatorFn[] = [];
      if (field.required) {
        validators.push(Validators.required);
      }
      if (field.type == 'lookup') {
        this.http
          .post<any>(`${environment.apiUrl}/api/Lookup`, field.default)
          .subscribe((res) => {
            this.lookupMap[field.key] = res.data as LookupApiResponse;
          });
        formControls[field.key] = ['', validators];
        continue;
      }
      formControls[field.key] = [field.default ?? '', validators];
    }
    formControls['userId'] = localStorage.getItem('userId');
    formControls['language'] = localStorage.getItem('language') ?? 'vi';
    this.filterForm = this.fb.group(formControls);
  }

  loadData(): void {
    this.http
      .post<{ data: ReportListResponse }>(
        `${environment.apiUrl}/api/DynamicReport/processReport`,
        {
          controller: this.controller,
          type: 'report',
          action: 'finding',
          param: this.filterForm.value,
        },
        {
          headers: {
            accept: 'text/plain',
            'Content-Type': 'application/json',
          },
        }
      )
      .subscribe(async (meta) => {
        this.data = meta.data.data;
        this.applyColumnFilters();
        this.page = 1;
        if(this.data.length> 0){
          const cleanControll = this.controller.endsWith('.json')
                                    ? this.controller.replace(/\.json$/i, '')
                                    : this.controller;
          this.exportData = {
            [cleanControll]: this.filterForm.value as any[]};
        }
        if (this.response) {
          this.response.total = meta.data.total;
        }
      });
  }

  onPageChange(newPage: number): void {
    this.page = newPage;
  }
  onPageSizeChange(): void {
    this.page = 1; // reset về trang đầu
  }

  onColumnFilterChange(): void {
    this.applyColumnFilters();
    this.page = 1;
  }

  clearColumnFilters(): void {
    Object.keys(this.columnFilters).forEach((k) => (this.columnFilters[k] = ''));
    this.applyColumnFilters();
    this.page = 1;
  }

  onFilter(): void {
    if (this.filterForm.valid) {
      this.loadData();
      this.showFilter = false;
      return;
    }


    this.filterForm.markAllAsTouched();

    const missingFields: string[] = [];

    for (const field of this.response?.filters ?? []) {
      const control = this.filterForm.get(field.key);

      if (control && control.invalid) {
        missingFields.push(field.label);
      }
    }

    if (missingFields.length > 0) {
      alert(missingFields.join("\n"));
    }

    
  }

  resetFilter(): void {
    this.filterForm.reset();
  }

  onFieldValueChange(value: any, field: any) {
    if (this.filterForm && this.filterForm.contains(field.key)) {
      this.filterForm.get(field.key)?.setValue(value);
    }

  }

  exportReport(): void {
    const rawData = this.filteredData.length > 0 ? this.filteredData : this.data;
    
    if (!rawData || rawData.length === 0) {
      console.warn('Không có dữ liệu để xuất.');
      alert('Không có dữ liệu để xuất báo cáo.');
      return;
    }

    const exportData = rawData.map(row => {
      let formattedRow: any = {};

      this.response!.header.forEach((header: any) => {
        formattedRow[header.label] = row[header.key];
      });
      return formattedRow;
    });

    const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
    const workbook: XLSX.WorkBook = { Sheets: { 'data': worksheet }, SheetNames: ['data'] };

    const excelBuffer: any = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

    this.saveAsExcelFile(excelBuffer, new Date().toDateString());
  }

  private saveAsExcelFile(buffer: any, fileName: string): void {
    const data: Blob = new Blob([buffer], { type: EXCEL_TYPE });
    FileSaver.saveAs(data, fileName + EXCEL_EXTENSION);
  }

  formatCurrencyNumber(amount: number): string {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return ''
    }

    return new Intl.NumberFormat(localeMap[localStorage.getItem("language") ?? "vi"] || 'vi-VN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  formatCell(value: any, format: string, type?: string): string {
    if (value === 0 || value === '0' || value === null || value === undefined) {
      return '';
    }
    if (format === 'space-group') {
      // Định dạng 100000000 -> 100 000 000
      return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    if (format === 'decimal-2') {
      // Định dạng 100.01, làm tròn 2 số lẻ
      return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (format === 'currency') {
      // Định dạng kiểu tiền tệ, ngăn cách hàng nghìn, không có số lẻ
      return Number(value).toLocaleString('vi-VN', {  minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    // Nếu type là number và format rỗng thì cũng định dạng kiểu tiền tệ VNĐ
    if ((type === 'number' || type === 'currency') && (!format || format === '')) {
      return Number(value).toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    return value;
  }

  getRowClass(row: any): string {
    // Ví dụ: Nếu stt = 0 thì vàng, nếu amount > 1000 thì xanh, có thể mở rộng thêm
    if (row['stt'] === 0) {
      return 'font-bold bg-blue-100 text-blue-900';
    }
    if (row['amount'] > 1000) {
      return 'bg-blue-100 text-blue-900';
    }
    // Thêm điều kiện khác tại đây nếu cần
    return '';
  }

  private initColumnFilters(): void {
    this.columnFilters = {};
    for (const header of this.response?.header || []) {
      this.columnFilters[header.key] = '';
    }
    this.applyColumnFilters();
  }

  private applyColumnFilters(): void {
    const activeFilters = Object.entries(this.columnFilters || {})
      .map(([key, value]) => ({ key, value: (value || '').trim().toLowerCase() }))
      .filter((f) => !!f.value);

    if (activeFilters.length === 0) {
      this.filteredData = [...this.data];
      return;
    }

    this.filteredData = this.data.filter((row) =>
      activeFilters.every((f) => {
        const raw = row?.[f.key];
        if (raw === null || raw === undefined) return false;
        return String(raw).toLowerCase().includes(f.value);
      })
    );
  }
}
