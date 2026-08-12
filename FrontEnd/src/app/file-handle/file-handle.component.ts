import { Router } from '@angular/router';
import {
  Component,
  HostListener,
  Input,
  OnInit,
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
} from '@angular/core';
import { FileService } from '../services/file.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { NgxSpinnerModule, NgxSpinnerService } from 'ngx-spinner';
import {
  delayWhen,
  finalize,
  firstValueFrom,
  map,
  Observable,
  timer,
} from 'rxjs';
import { ConfirmDialogComponent } from '../components/confirm-dialog/confirm-dialog.component';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DomSanitizer } from '@angular/platform-browser';
import { RichTextComponent } from './rich-text.component';
import { OptionDialogComponent } from './file-handle-option-dialog.component';
import * as XLSX from 'xlsx';

type RawExportHeader = {
  key: string;
  label: string;
  type?: string;
  options?: Array<{ label: string; value: any }>;
};

@Component({
  selector: 'app-file-handle',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    TranslateModule,
    NgxSpinnerModule,
  ],
  templateUrl: './file-handle.component.html',
  styleUrl: './file-handle.component.scss',
})

export class FileHandleComponent implements OnInit {
  @ViewChild('exportMenu') exportMenuRef!: ElementRef;
  @ViewChild('importMenu') importMenuRef!: ElementRef;
  @ViewChild('importInput') importInputRef!: ElementRef<HTMLInputElement>;
  @Output() importCompleted = new EventEmitter<void>();
  @Input() minimalMode = false;
  @Input() controll: string = '';
  @Input() exportData: { [key: string]: any[] } = {};
  @Input() selectedExportRows: any[] = [];
  @Input() exportAllRows: any[] = [];
  @Input() rawExportHeaders: RawExportHeader[] = [];
  @Input() rawExportValueResolver?: (
    row: Record<string, any>,
    key: string,
    header: RawExportHeader,
  ) => any;
  @Input() user: { [key: string]: string } = {};
  @Input() isFileHandle: string | undefined = ''; //"import" | "export" | "both"
  showImportOptions = false;
  pendingImportType: 'template' | 'import' | null = null;
  showExportOptions = false;
  pendingExportType: 'pdf' | 'excel' | 'word' | 'excel-tax' | null = null;
  @Input() isOption: boolean = false;
  @Input() options : any;
  option:  number | null = null;
  @Input() nameExport : string = 'Xuất dữ liệu';
  @Input() IsReport : boolean = false;
  @Input() enableTaxExcelExport: boolean = false;
  @Input() taxExcelExportConfig: string = '';
  @Input() extraTaxExcelExportLabel: string = '';
  @Input() extraTaxExcelExportConfig: string = '';
  constructor(
    private fileService: FileService,
    private snackBar: MatSnackBar,
    private spinner: NgxSpinnerService,
    private dialog: MatDialog,
    private Routes: Router,
    private samitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    console.log('option habdle: ', this.options);
    console.log('isoption habdle: ', this.isOption);

  }

  importCSV(
    event: any | null,
    user: any | null,
    controll: string,
    type: 'template' | 'import'
  ) {
    if (!controll || !controll.trim()) {
      this.showError('Controller is required.');
      return;
    }
    this.spinner.show();
    //Trường hợp tải file mẫu → không có file, chỉ gửi controll + type
    if (type === 'template' && event === null) {
      const formData = new FormData();
      formData.append('controll', controll);
      formData.append('type', type);
      //show popup loading
      this.fileService
        .sendTemplateRequest(formData)
        .pipe(
          delayWhen(() => timer(500)), // Luôn delay 0.5 giây trước khi next/error
          finalize(() => this.spinner.hide())
        )
        .subscribe({
          next: (res: HttpResponse<Blob>) => {
            const contentDisposition = res.headers.get('content-disposition');
            let fileName = 'template.xlsx';
            if (contentDisposition) {
              const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
                contentDisposition
              );
              if (matches != null && matches[1]) {
                fileName = matches[1].replace(/['"]/g, '');
              }
            }

            const blob = new Blob([res.body!], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            window.URL.revokeObjectURL(url);
            //load lại data
            this.importCompleted.emit();
          },
          error: (err) => {
            // Nếu error.error là Blob → giải mã ra JSON
            if (
              err?.error instanceof Blob &&
              err.error.type === 'application/json'
            ) {
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const errorJson = JSON.parse(reader.result as string);
                  this.showError(
                    errorJson.message || 'Không thể tải file mẫu.'
                  );
                } catch (e) {
                  this.showError('Lỗi khi đọc phản hồi lỗi từ server.');
                }
              };
              reader.onerror = () => {
                this.showError('Lỗi khi đọc dữ liệu lỗi.');
              };
              reader.readAsText(err.error); // GIẢI MÃ BLOB
            } else {
              this.showError(err?.error?.message || 'Không thể tải file mẫu.');
            }
          },
        });
      return;
    }

    //Trường hợp import dữ liệu cần có file
    const input = event?.target as HTMLInputElement;
    const file = input?.files?.[0];

    if (!file) {
      this.showError('Vui lòng chọn tệp hợp lệ.');
      return;
    }

    this.fileService.convertXLSXToCSVFile(file).then((csvFile) => {
      const formData = new FormData();
      formData.append('file', csvFile);
      formData.append('controll', controll);
      formData.append('type', type);
      formData.append('user', JSON.stringify(user)); //parse về dạng json
      console.time('ImportCSV Execution Time');
      this.fileService
        .sendImportRequest(formData)
        .pipe(
          delayWhen(() => timer(500)), // Luôn delay 0.5 giây trước khi next/error
          finalize(() => this.spinner.hide())
        )
        .subscribe({
          next: () => {
            this.showSuccess('Import thành công!');
            input.value = '';
            console.timeEnd('ImportCSV Execution Time');
            this.importCompleted.emit();
          },
          error: (res) => {
            input.value = '';
            console.timeEnd('ImportCSV Execution Time');
            console.log('Import error:', res?.status);
            // Lấy message và errors từ response trả về
            const statusCode = res?.status;
            const errorMessage = res?.error?.message;
            console.log('Error message:', errorMessage);
            const errorDetails = res?.error?.data;
            //bắt dữ liệu trùng
            if (statusCode === 409) {
              const dialogRef = this.dialog.open(ConfirmDialogComponent, {
                width: '600px',
                data: {
                  title: 'Xác nhận ghi đè',
                  message: `${errorMessage}.
                   Bạn có muốn ghi đè không?`,
                  details: errorDetails ?? errorMessage,
                },
              });
              dialogRef.afterClosed().subscribe((result) => {
                if (result == true) {
                  //gọi lại api ghi đè
                  formData.append('overwrite', 'true'); // Thêm cờ ghi đè
                  this.fileService.sendImportRequest(formData).subscribe({
                    next: () => {
                      this.showSuccess('Import thành công (ghi đè)!');
                      this.importCompleted.emit();
                    },
                    error: (err2) => {
                      console.log(err2?.error?.message);
                      this.showError(
                        `Import thất bại khi ghi đè: ${err2?.error?.message}`,
                        err2?.status
                      );
                    },
                  });
                }
              });
            } else {
              // Show lỗi gồm message + chi tiết
              this.showError(errorMessage, errorDetails);
            }
          },
        });
    });
  }

  //hàm chuyển HSL sang HEX
  hslToHex(h: number, s: number, l: number): string {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  // Phương thức mở Dialog Rich Text Editor
  openRichTextEditor(initialContent: string): Observable<string | undefined> {
    //Khai báo và khởi tạo biến xử lý dữ liệu
    let processedContent = initialContent;
    processedContent = processedContent.replace(/\n/g, '<br>');
    //Mở Dialog và truyền nội dung đã xử lý (processedContent)
    const dialogRef = this.dialog.open(RichTextComponent, {
      width: '1200px',
      height: '700px',
      data: { content: processedContent }, // <-- Truyền nội dung đã xử lý
    });

    //Lắng nghe dữ liệu sau khi dialog đóng
    return dialogRef.afterClosed().pipe(
      map((result) => {
        if (typeof result === 'string') {
          let cleanedHtml = result;
            // Thay thế tất cả các thẻ <strong> và </strong>
            cleanedHtml = cleanedHtml.replace(/<strong>/g, '<b>');
            cleanedHtml = cleanedHtml.replace(/<\/strong>/g, '</b>');
            cleanedHtml = cleanedHtml.replace(/<p>/g, '');
            cleanedHtml = cleanedHtml.replace(/<\/p>/g, '');
            const colorRegex = /<span style="color:hsl\((.*?),\s*(.*?)%,\s*(.*?)%\);">(.*?)<\/span>/gi; 
            cleanedHtml = cleanedHtml.replace(colorRegex, (fullMatch, hStr, sStr, lStr, content) => {
                const h = parseFloat(hStr);
                const s = parseFloat(sStr);
                const l = parseFloat(lStr);
                
                // CHUYỂN ĐỔI SANG MÃ HEX
                const hexColor = this.hslToHex(h, s, l);

                // Trả về thẻ <font> với mã HEX
                return `<font color="${hexColor}">${content}</font>`;
            });
            cleanedHtml = cleanedHtml.replace(/<\/li>/gi, '<br>'); // Thay thẻ đóng bằng <br>
        
              // Thay thế thẻ mở <li> bằng dấu gạch ngang và thụt lề (ví dụ: 4 khoảng trắng)
              cleanedHtml = cleanedHtml.replace(/<li[^>]*>/gi, '    - '); 

              // TẠM THỜI: Xóa thẻ bao ngoài <ul> và <ol>
              cleanedHtml = cleanedHtml.replace(/<\/?ul[^>]*>/gi, '');
              cleanedHtml = cleanedHtml.replace(/<\/?ol[^>]*>/gi, '');
              
              // c) Xóa thẻ <br> thừa và khoảng trắng
              cleanedHtml = cleanedHtml.replace(/<br>\s*<br>/gi, '<br>'); // Giảm thiểu các <br> kép
              cleanedHtml = cleanedHtml.replace(/<br>$/, ''); // Xóa <br> ở cuối chuỗi
             // Loại bỏ các khoảng trắng lớn và ngắt dòng dư thừa giữa các thẻ
              cleanedHtml = cleanedHtml.replace(/\n\s*\n/g, '\n');
              cleanedHtml = cleanedHtml.replace(/>\s*</g, '><'); // Loại bỏ khoảng trắng giữa các thẻ
          return cleanedHtml.trim(); // Trả về nội dung đã chỉnh sửa
        }
        return undefined; // Trả về undefined nếu bị hủy
      })
    );
  }
  //export
  async exportToReport(
    controll: string,
    type: 'pdf' | 'excel' | 'word' | 'excel-tax',
    taxExcelExportConfigOverride: string = '',
  ) {
    // Gọi API export hoặc xử lý export
    if (!this.controll || Object.keys(this.controll).length === 0) {
      this.showError('Không có controll để export.');
      return;
    }
    const cleanControll = controll.endsWith('.json')
    ? controll.replace(/\.json$/i, '')
    : controll;

    const taxExportTables =
      type === 'excel-tax' ? this.buildTaxExportTables(cleanControll) : null;
    const tablesPayload = taxExportTables ?? this.exportData;

    if (!tablesPayload || Object.keys(tablesPayload).length === 0) {
      this.showError('Không có dữ liệu để export.');
      return;
    }
    const payload = {
      controll: cleanControll,
      tables: tablesPayload,
      isPdfOrExcel: type,
      userID: this.user?.['user_id0'] ?? '',
      unit: this.user?.['unit0'] ?? '',
      language: localStorage.getItem('language') ?? 'vi',
      isReport : this.IsReport,
      taxExcelExportConfig: taxExcelExportConfigOverride || this.taxExcelExportConfig || cleanControll,
      noteEdited: '',
      isEdit: false
    };
    console.log("Payload export: ", payload);
    this.spinner.show();
    this.getExportRequest(type, payload)
      .pipe(
        delayWhen(() => timer(500)), // Luôn delay 0.5 giây trước khi next/error
        finalize(() => this.spinner.hide())
      )
      .subscribe({
        next: (res: HttpResponse<Blob>) => {
          const contentType = res.headers.get('Content-Type');
          // Kiểm tra xem backend có gửi về dạng 'text/plain' hay không.
          // Dựa vào logic backend: contentType = "text/plain" khi result.Note != null
          if (contentType === 'text/plain' && res.body) {
            const reader = new FileReader();
            reader.onload = async (e) => {
              const noteContent = reader.result as string;
              console.log('Nội dung Note:', noteContent);
              let noteEdited = await firstValueFrom(
                this.openRichTextEditor(noteContent)
              );
              if(noteEdited == undefined) return; //nếu hủy edit thì thôi
              console.log('Nội dung Note đã chỉnh sửa:', noteEdited);
              //gửi note sau edit về cho be
              payload.noteEdited = noteEdited ? noteEdited : noteContent;
              payload.isEdit = true; //đánh dấu đã edit
              this.getExportRequest(type, payload)
                .pipe(
                  delayWhen(() => timer(500)), // Luôn delay 0.5 giây trước khi next/error
                  finalize(() => this.spinner.hide())
                )
                .subscribe({
                  next: (res2: HttpResponse<Blob>) => {
                    //sau khi sửa note thì nhận file bình thường
                    const contentDisposition = res2.headers.get(
                      'content-disposition'
                    );
                    let fileName = 'download';
                    if (contentDisposition) {
                      const matches =
                        /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
                          contentDisposition
                        );
                      if (matches != null && matches[1]) {
                        fileName = matches[1].replace(/['"]/g, '');
                      }
                    }

                    const blob = new Blob([res2.body!], {
                      type:
                        type === 'pdf'
                          ? 'application/pdf'
                          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    });

                    const url = window.URL.createObjectURL(blob);
                    console.log(url);
                    const newTab = window.open(url, '_blank');

                    if (newTab) {
                      newTab.document.write(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                          <meta charset="UTF-8">
                          <title>Export Preview</title>
                          <style>
                            html, body { margin:0; padding:0; width:100%; height:100%; }
                            iframe { width:100%; height:100%; border:none; }
                            #downloadBtn {
                              position: absolute;
                              top: 12px;
                              right: 80px;
                              z-index: 1000;
                              padding: 8px 12px;
                              background-color: #007bff;
                              color: white;
                              border: none;
                              border-radius: 4px;
                              cursor: pointer;
                            }
                          </style>
                        </head>
                        <body>
                          <button id="downloadBtn">Download</button>
                          <iframe src="${url}" frameborder="0"></iframe>
                          <script>
                            const btn = document.getElementById('downloadBtn');
                            btn.addEventListener('click', () => {
                              const a = document.createElement('a');
                              a.href = '${url}';
                              a.download = '${fileName}';
                              a.click();
                            });
                          </script>
                        </body>
                        </html>
                      `);
                      newTab.document.close();
                    }
                  },
                  error: (err2: HttpErrorResponse) => {
                    this.showError(err2.error, err2.status, err2.statusText);
                  },
                });
            };
            // Đọc Blob dưới dạng văn bản (text)
            reader.readAsText(res.body);
          } else {
            //trường hợp export bằng pdf/excel bình thường
            const contentDisposition = res.headers.get('content-disposition');
            let fileName = 'download';
            if (contentDisposition) {
              const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
                contentDisposition
              );
              if (matches != null && matches[1]) {
                fileName = matches[1].replace(/['"]/g, '');
              }
            }

           const blob = new Blob([res.body!], {
                                    type:
                                        type === 'pdf'
                                            ? 'application/pdf'
                                            : type === 'excel' || type === 'excel-tax'
                                                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                                                : type === 'word'
                                                    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                                                    : 'application/octet-stream', // Mặc định hoặc cho các loại khác
                                });

            const url = window.URL.createObjectURL(blob);
            if(blob.type === 'application/pdf'){
                const newTab = window.open(url, 'export_view');
                if (newTab) {
                  newTab.document.write(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                      <meta charset="UTF-8">
                      <title>Export Preview</title>
                      <style>
                        html, body { margin:0; padding:0; width:100%; height:100%; }
                        iframe { width:100%; height:100%; border:none; }
                        #downloadBtn {
                          position: absolute;
                          top: 12px;
                          right: 80px;
                          z-index: 1000;
                          padding: 8px 12px;
                          background-color: #007bff;
                          color: white;
                          border: none;
                          border-radius: 4px;
                          cursor: pointer;
                        }
                      </style>
                    </head>
                    <body>
                      <button id="downloadBtn">Download</button>
                      <iframe src="${url}" frameborder="0"></iframe>
                      <script>
                        const btn = document.getElementById('downloadBtn');
                        btn.addEventListener('click', () => {
                          const a = document.createElement('a');
                          a.href = '${url}';
                          a.download = '${fileName}';
                          a.click();
                        });
                      </script>
                    </body>
                    </html>
                  `);
                  newTab.document.close();
                }
              }
            else if(blob.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'){
                 const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName;
                  a.click();
                  window.URL.revokeObjectURL(url);
            }
            else if(blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
                 const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName;
                  a.click();
                  window.URL.revokeObjectURL(url);
            }
          } 
        },
        error: (err: HttpErrorResponse) => {
          this.showError(err.error, err.status, err.statusText);
        },
      });
    this.showExportOptions = false;
  }

  private buildTaxExportTables(controller: string): { [key: string]: any[] } | null {
    const key = (controller || this.controll || '').toLowerCase();
    if (!key) return null;

    if (Array.isArray(this.selectedExportRows) && this.selectedExportRows.length > 0) {
      return { [key]: this.selectedExportRows };
    }

    if (Array.isArray(this.exportAllRows) && this.exportAllRows.length > 0) {
      return { [key]: this.exportAllRows };
    }

    if (this.exportData?.[key] && Array.isArray(this.exportData[key])) {
      return { [key]: this.exportData[key] };
    }

    return null;
  }

  private getExportRequest(type: 'pdf' | 'excel' | 'word' | 'excel-tax', payload: any): Observable<HttpResponse<Blob>> {
    if (type === 'excel-tax') {
      return this.fileService.exportTaxExcelFile(payload);
    }
    return this.fileService.exportFile(payload);
  }

  exportRawMasterToExcel(): void {
    const selectedRows = Array.isArray(this.selectedExportRows)
      ? this.selectedExportRows.filter((row) => !!row)
      : [];
    const rows =
      selectedRows.length > 0
        ? selectedRows
        : Array.isArray(this.exportAllRows)
          ? this.exportAllRows
          : [];

    if (!rows.length) {
      this.showError('Không có dữ liệu grid để kết xuất.');
      this.showExportOptions = false;
      return;
    }

    const headerConfig = this.resolveRawExportHeaders(rows);
    const normalizedRows = rows.map((row) => this.normalizeRawExportRow(row, headerConfig));
    const headers = headerConfig.map((h) => h.label);
    const worksheet = XLSX.utils.json_to_sheet(normalizedRows, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'MasterGridRaw');

    const baseName = (this.controll || 'grid').replace(/\.json$/i, '');
    const fileName = `${baseName}_raw_${this.buildExportTimestamp()}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    this.showExportOptions = false;
    this.showSuccess('Kết xuất dữ liệu thô thành công.');
  }

  private resolveRawExportHeaders(
    rows: Record<string, any>[],
  ): RawExportHeader[] {
    const excluded = new Set(['idgui', 'id_gui']);
    const configured = (this.rawExportHeaders || [])
      .filter((h) => !!h?.key && !excluded.has(h.key.toLowerCase()))
      .map((h) => ({
        key: h.key,
        label: h.label || h.key,
        type: h.type,
        options: h.options,
      }));

    if (configured.length > 0) {
      return configured;
    }

    const keySet = new Set<string>();
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!excluded.has(key.toLowerCase())) {
          keySet.add(key);
        }
      });
    });

    return Array.from(keySet).map((key) => ({ key, label: key }));
  }

  private normalizeRawExportRow(
    row: Record<string, any>,
    headers: RawExportHeader[],
  ): Record<string, any> {
    const normalized: Record<string, any> = {};
    headers.forEach((header) => {
      const { key, label } = header;
      const value = this.resolveRawExportValue(row, header);
      if (value === null || value === undefined) {
        normalized[label] = '';
        return;
      }
      if (typeof value === 'object') {
        normalized[label] = JSON.stringify(value);
        return;
      }
      normalized[label] = value;
    });
    return normalized;
  }

  private resolveRawExportValue(row: Record<string, any>, header: RawExportHeader): any {
    const resolvedValue = this.rawExportValueResolver?.(row, header.key, header);
    const value = resolvedValue !== undefined ? resolvedValue : row[header.key];

    if (value === null || value === undefined || value === '') {
      return '';
    }

    if (header.type === 'date' || header.type === 'datetime') {
      return this.formatRawExportDate(value);
    }

    if (header.type === 'select') {
      const option = (header.options || []).find((opt) => `${opt?.value ?? ''}` === `${value}`);
      return option?.label ?? value;
    }

    if (header.type === 'checkbox') {
      return value === true || value === 1 || value === '1' ? 'Có' : 'Không';
    }

    return value;
  }

  private formatRawExportDate(value: any): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return `${value}`;
    }

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  private buildExportTimestamp(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
  }

  triggerImport(type: 'template' | 'import'): void {
    this.pendingImportType = type;
    if (this.importInputRef) {
      this.importInputRef.nativeElement.click();
    }
  }

  selectImportType(type: 'template' | 'import') {
    this.pendingImportType = type;
    this.showImportOptions = false;

    if (type === 'template') {
      // Không cần chọn file → truyền null vào `event`
      this.importCSV(null, null, this.controll, 'template');
    } else if (type === 'import') {
      // Mở input ẩn để chọn file
      //alert(this.importInputRef);
      this.importInputRef?.nativeElement.click();
    }
  }

  selectExportType(type: 'pdf' | 'excel' | 'word' | 'excel-tax', taxExcelExportConfigOverride: string = '') {
  let controller = "";

  if (this.isOption) {
    const dialogRef = this.dialog.open(OptionDialogComponent, {
      width: '600px',
      data: { options: this.options },
    });

    dialogRef.afterClosed().subscribe((result) => {
      // Cancel/close dialog => do nothing, avoid exporting wrong default template.
      if (result == null) {
        this.pendingExportType = null;
        this.showExportOptions = false;
        return;
      }

      this.option = result;
      controller = this.controll + this.option;

      this.pendingExportType = type;
      this.showExportOptions = false;
      this.exportToReport(controller, this.pendingExportType, taxExcelExportConfigOverride);
      this.pendingExportType = null;
    });
  } else {
    controller = this.controll;
    this.pendingExportType = type;
    this.showExportOptions = false;
    this.exportToReport(controller, this.pendingExportType, taxExcelExportConfigOverride);
    this.pendingExportType = null;
  }
  }

  toggleExportOptions(): void {
    this.showExportOptions = !this.showExportOptions;
    if (this.showExportOptions) {
      this.showImportOptions = false;
    }
  }

  toggleImportOptions(): void {
    this.showImportOptions = !this.showImportOptions;
    if (this.showImportOptions) {
      this.showExportOptions = false;
    }
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Đóng', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['success-snackbar'],
    });
  }

  private showError(
    error: any,
    statusCode?: number,
    statusText?: string
  ): void {
    let displayMessage = 'Lỗi không xác định.';
    const lineBreak = String.fromCharCode(10);

    if (typeof error === 'string') {
      // Lỗi nghiệp vụ tự truyền vào, ví dụ "Không có dữ liệu để export."
      displayMessage = error;

      this.snackBar.open(displayMessage, 'Đóng', {
        duration: undefined,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['error-snackbar'],
      });
      return;
    }

    if (error instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const errorJson = JSON.parse(reader.result as string);
          if (errorJson && errorJson.message) {
            displayMessage = errorJson.message;
          } else {
            displayMessage =
              'Lỗi server: Phản hồi không phải JSON hợp lệ hoặc thiếu thông báo.';
            console.error('Error JSON from Blob:', errorJson);
          }
        } catch (e) {
          displayMessage = 'Lỗi server: Phản hồi không phải JSON hợp lệ.';
          console.error(
            'Error parsing server response from Blob:',
            reader.result,
            e
          );
        } finally {
          this.snackBar.open(displayMessage, 'Đóng', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['error-snackbar'],
          });
        }
      };
      reader.readAsText(error);
      return;
    }

    if (typeof error === 'object' && error !== null && error.message) {
      displayMessage = error.message;
      if (Array.isArray(error.errorDetails) && error.errorDetails.length > 0) {
        displayMessage += lineBreak;
        displayMessage += error.errorDetails
          .map((errDetail: string, idx: number) => `${idx + 1}. ${errDetail}`)
          .join('\n');
      }

      this.snackBar.open(displayMessage, 'Đóng', {
        duration: undefined,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Lỗi HTTP hoặc các lỗi không xác định khác
    displayMessage = `Lỗi HTTP: ${statusCode || 'Không xác định'} - ${
      statusText || 'Unknown error'
    }`;
    console.error('Server error (non-JSON or missing message):', error);

    this.snackBar.open(displayMessage, 'Đóng', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['error-snackbar'],
    });
  }

  // Lắng nghe click ngoài
  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    if (
      this.exportMenuRef &&
      !this.exportMenuRef.nativeElement.contains(event.target) &&
      this.importMenuRef &&
      !this.importMenuRef.nativeElement.contains(event.target)
    ) {
      this.showImportOptions = false;
      this.showExportOptions = false;
    }
  }
}
