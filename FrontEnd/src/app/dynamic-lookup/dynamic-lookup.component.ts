import { Component, OnInit, Input, Output, EventEmitter, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LookupApiResponse } from '../models';
import { DraggableDirective } from './draggable.directive';
import { environment } from '../../environments/environment';

@Component({
  standalone: true,
  selector: 'app-lookup',
  templateUrl: './dynamic-lookup.component.html',
  styles: [`
    .lookup-selected-row {
      background-color: #5f7f4f !important;
    }

    .lookup-selected-row td {
      color: #ffffff !important;
    }
  `],
  imports: [CommonModule, FormsModule, DraggableDirective],
})
export class DynamicLookupComponent implements OnInit, OnChanges {
  @Input() multiple: boolean = true;
  @Input() value: any;
  @Input() response!: LookupApiResponse;
  @Input() disable: boolean = false;
  @Input() lookupQuery?: any;
  @Output() valueChange = new EventEmitter<any>();

  showPopup = false;

  selectedItem: any = null;
  selectedItems: any[] = [];

  searchText = '';
  searchName = '';
  filteredData: any[] = [];
  paginatedData: any[] = [];
  inlineQuery = '';
  showInlineDropdown = false;
  pageSize = 10;
  currentPage = 0;
  private quickCreateRequestId = '';
  private readonly quickCreateStorageKey = 'sinco_quick_create_result';
  private readonly quickCreateRouteMap: Record<string, string> = {
    customer: 'customer/popup',
    customerGroup: 'customer-group/popup',
    company: 'company/popup',
    employee: 'employee/popup',
    supplier: 'supplier/popup',
    industryGroup: 'industry-group/popup',
    deliveryLocation: 'delivery-location/popup',
    item: 'item/popup',
    itemGroup: 'item-group/popup',
    uom: 'uom/popup',
    job: 'job/popup',
    manufacturer: 'manufacturer/popup',
    position: 'position/popup',
    accountSinco: 'account-sinco/popup',
    tax: 'tax/popup',
    paymentslip: 'paymentslip/popup',
    poin: 'poin/popup',
    note: 'note/popup',
    incomeExpenditure: 'income-expenditure/popup',
    location: 'location/popup',
    roleEmployee: 'roleEmployee/popup',
  };
  get totalPages() {
    return Math.ceil(this.filteredData.length / this.pageSize);
  }

  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.syncResponseData();
    this.syncSelectedState(this.value);
    this.syncInlineQueryWithSelection();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['response'] && changes['response'].currentValue) {
      this.syncResponseData();
    }

    if (changes['value'] && !changes['value'].firstChange) {
      this.syncSelectedState(changes['value'].currentValue);
      this.syncInlineQueryWithSelection();
    }
  }

  @HostListener('window:storage', ['$event'])
  onStorageEvent(event: StorageEvent): void {
    if (event.key !== this.quickCreateStorageKey || !event.newValue) {
      return;
    }

    try {
      const payload = JSON.parse(event.newValue);
      const controller = typeof payload?.controller === 'string' ? payload.controller.trim() : '';
      if (!controller || controller !== this.getLookupController()) {
        return;
      }
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
      if (requestId && requestId !== this.quickCreateRequestId) {
        return;
      }

      this.reloadLookupData(payload);
    } catch (error) {
      console.warn('Unable to parse quick create payload:', error);
    }
  }

  togglePopup() {
    this.showInlineDropdown = false;
    this.showPopup = !this.showPopup;
  }

  onInlineQueryChange(value: string): void {
    this.inlineQuery = value ?? '';
    if (!this.disable && !this.multiple) {
      this.showInlineDropdown = true;
    }
  }

  onInlineInputFocus(): void {
    if (!this.disable && !this.multiple) {
      this.showInlineDropdown = true;
    }
  }

  onInlineInputClick(event: Event): void {
    if (this.disable || this.multiple) {
      return;
    }

    this.showInlineDropdown = true;

    const input = event.target as HTMLInputElement | null;
    input?.select();
  }

  onInlineInputBlur(): void {
    this.commitInlineSelection();
    setTimeout(() => {
      this.showInlineDropdown = false;
    }, 150);
  }

  onInlineEnter(event: Event): void {
    event.preventDefault();
    this.commitInlineSelection();
    this.showInlineDropdown = false;
  }

  selectInlineData(data: any): void {
    if (!this.response?.primaryKey?.length) {
      return;
    }

    const key = data[this.response.primaryKey[0]];
    this.selectData(key);
    this.showInlineDropdown = false;
  }

  getInlineFilteredData(): any[] {
    if (!this.response?.datas?.length) {
      return [];
    }

    const query = this.inlineQuery.trim().toLowerCase();
    const selectedDisplayText = this.getSelectedSingleDisplayText().toLowerCase();

    // Khi input đang hiển thị đúng giá trị đã chọn, vẫn nên xổ full list thay vì tự lọc còn 1 dòng.
    if (!query || (selectedDisplayText && query === selectedDisplayText)) {
      return this.response.datas.slice(0, 8);
    }

    const nameFields = this.getNameSearchFields();
    return this.response.datas
      .filter((data) => {
        const allFieldsMatch = Object.values(data).some((val) =>
          String(val ?? '').toLowerCase().includes(query)
        );

        const nameFieldMatch = nameFields.some((field) =>
          String(data?.[field] ?? '').toLowerCase().includes(query)
        );

        return allFieldsMatch || nameFieldMatch;
      })
      .slice(0, 8);
  }

  private getSelectedSingleDisplayText(): string {
    if (this.multiple || !this.response?.datas?.length) {
      return '';
    }

    const primaryField = this.getPrimaryField();
    const foundItem = this.response.datas.find(
      (data) => this.lookupValuesEqual(data?.[primaryField], this.selectedItem)
    );

    return foundItem ? this.getItemDisplayText(foundItem).trim() : '';
  }

  private commitInlineSelection(): void {
    if (this.disable || this.multiple || !this.response?.datas?.length) {
      return;
    }

    const query = this.inlineQuery.trim();
    if (!query) {
      if (this.selectedItem !== null && this.selectedItem !== undefined && this.selectedItem !== '') {
        this.selectedItem = null;
        this.valueChange.emit(null);
      }
      this.syncInlineQueryWithSelection();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const primaryField = this.getPrimaryField();

    const exactPrimary = this.response.datas.find(
      (data) => String(data?.[primaryField] ?? '').toLowerCase() === lowerQuery
    );
    if (exactPrimary) {
      this.selectInlineData(exactPrimary);
      return;
    }

    const exactAnyField = this.response.datas.find((data) =>
      Object.values(data).some((val) => String(val ?? '').toLowerCase() === lowerQuery)
    );
    if (exactAnyField) {
      this.selectInlineData(exactAnyField);
      return;
    }

    const candidates = this.getInlineFilteredData();
    if (candidates.length === 1) {
      this.selectInlineData(candidates[0]);
      return;
    }

    this.syncInlineQueryWithSelection();
  }

  canQuickCreate(): boolean {
    if (this.disable) {
      return false;
    }

    const controller = this.getLookupController();
    return !!controller && !!this.quickCreateRouteMap[controller];
  }

  openQuickCreate(): void {
    const controller = this.getLookupController();
    const popupRoute = controller ? this.quickCreateRouteMap[controller] : '';
    if (!controller || !popupRoute) {
      return;
    }

    this.quickCreateRequestId = `${controller}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const popupUrl = `${window.location.origin}/${popupRoute}?quickCreate=1&controller=${encodeURIComponent(controller)}&requestId=${encodeURIComponent(this.quickCreateRequestId)}`;
    const quickCreateWindow = window.open(
      popupUrl,
      '_blank',
      'popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes'
    );

    quickCreateWindow?.focus();
  }

  filterData() {
    const searchText = this.searchText.toLowerCase();
    const searchName = this.searchName.toLowerCase();
    const nameFields = this.getNameSearchFields();
    this.filteredData = this.response.datas.filter((data) => {
      const values = Object.values(data);
      let checkName = true;
      if (searchName) {
        checkName = nameFields.some((field) =>
          String(data?.[field] ?? '').toLowerCase().includes(searchName)
        );
      }

      return values.some((val) =>
        String(val).toLowerCase().includes(searchText)
      ) && checkName;
    }

    );
    this.setPage(0);
  }

  setPage(page: number) {
    this.currentPage = page;
    const start = page * this.pageSize;
    this.paginatedData = this.filteredData.slice(start, start + this.pageSize);
  }

  nextPage() {
    if (this.currentPage + 1 < this.totalPages)
      this.setPage(this.currentPage + 1);
  }
  prevPage() {
    if (this.currentPage > 0) this.setPage(this.currentPage - 1);
  }

  selectData(prikey: any) {
    if (this.multiple) {
      const exists = this.selectedItems.some((item) =>
        this.lookupValuesEqual(item, prikey)
      );
      if (exists) {
        this.selectedItems = this.selectedItems.filter(
          (item) => !this.lookupValuesEqual(item, prikey)
        );
      } else {
        this.selectedItems.push(prikey);
      }
      this.valueChange.emit(this.selectedItems);
    } else {
      const changed = !this.lookupValuesEqual(this.selectedItem, prikey);
      this.selectedItem = prikey;
      if (changed) {
        this.valueChange.emit(this.selectedItem);
      }
      this.syncInlineQueryWithSelection();
      this.showPopup = false;
    }
  }

  isSelected(data: any): boolean {
    return this.multiple
      ? this.selectedItems.some((item) => this.lookupValuesEqual(item, data))
      : this.lookupValuesEqual(this.selectedItem, data);
  }

  getDisplayText(): string {
    if (!this.response) {
      console.log('getDisplayText: No response data yet');
      return '';
    }


    if (this.multiple) {
      const primaryField = this.getPrimaryField();
      const displayText = this.response.datas
        .filter((data) =>
          this.selectedItems.some((item) =>
            this.lookupValuesEqual(item, data?.[primaryField])
          )
        )
        .map((item) =>
          this.response.fields.map((f) => item[f.field]).join(' - ')
        )
        .join(', ');

      return displayText;
    } else {
      const primaryField = this.getPrimaryField();
      const foundItem = this.response.datas.find(
        (data) => this.lookupValuesEqual(data?.[primaryField], this.selectedItem)
      );


      const displayText = Object.values(foundItem ?? []).join(' - ');
      return displayText;
    }
  }

  private getNameSearchFields(): string[] {
    const fields = this.response?.fields?.map((field) => field.field) ?? [];
    if (!fields.length) {
      return [];
    }

    const preferredFields = fields.filter((field) => {
      const normalizedField = field.toLowerCase();
      return (
        normalizedField.includes('name') ||
        normalizedField.includes('ten') ||
        normalizedField.endsWith('_name')
      );
    });

    if (preferredFields.length) {
      return preferredFields;
    }

    const nonPrimaryFields = fields.filter(
      (field) => !(this.response?.primaryKey ?? []).includes(field)
    );

    return nonPrimaryFields.length ? nonPrimaryFields : fields;
  }

  private syncResponseData(): void {
    this.filteredData = this.response?.datas ? [...this.response.datas] : [];
    this.setPage(0);
    this.syncInlineQueryWithSelection();
  }

  private syncSelectedState(value: any): void {
    if (this.multiple) {
      this.selectedItems = Array.isArray(value) ? value : [];
      return;
    }

    this.selectedItem = value;
  }

  private syncInlineQueryWithSelection(): void {
    if (this.multiple || !this.response?.datas?.length) {
      return;
    }

    const primaryField = this.getPrimaryField();
    const foundItem = this.response.datas.find(
      (data) => this.lookupValuesEqual(data?.[primaryField], this.selectedItem)
    );
    this.inlineQuery = foundItem ? this.getItemDisplayText(foundItem) : '';
  }

  private getPrimaryField(): string {
    return this.response?.primaryKey?.[0] || this.response?.fields?.[0]?.field || '';
  }

  private lookupValuesEqual(left: any, right: any): boolean {
    if (left === null || left === undefined || right === null || right === undefined) {
      return left === right;
    }

    return String(left) === String(right);
  }

  getItemDisplayText(item: any): string {
    return this.response.fields.map((f) => item?.[f.field]).join(' - ');
  }

  private getLookupController(): string {
    return typeof this.lookupQuery?.controller === 'string'
      ? this.lookupQuery.controller.trim()
      : '';
  }

  private reloadLookupData(quickCreatePayload?: any): void {
    if (!this.lookupQuery) {
      return;
    }

    this.http.post<any>(`${environment.apiUrl}/api/Lookup`, this.lookupQuery)
      .subscribe((res) => {
        this.response = res.data as LookupApiResponse;
        this.selectQuickCreatedRecord(quickCreatePayload);
        this.syncResponseData();
      });
  }

  private selectQuickCreatedRecord(payload?: any): void {
    if (!payload || !this.response?.primaryKey?.length) {
      return;
    }

    const primaryField = this.response.primaryKey[0];
    const primaryValue =
      payload?.primaryKeyValues?.[primaryField] ??
      payload?.record?.[primaryField];

    if (primaryValue === null || primaryValue === undefined || primaryValue === '') {
      return;
    }

    const found = this.response.datas?.some(
      (item) => `${item?.[primaryField] ?? ''}` === `${primaryValue}`,
    );

    if (!found && payload.record) {
      this.response.datas = [...(this.response.datas || []), payload.record];
    }

    if (this.multiple) {
      const exists = this.selectedItems.some((item) => `${item}` === `${primaryValue}`);
      if (!exists) {
        this.selectedItems = [...this.selectedItems, primaryValue];
        this.valueChange.emit(this.selectedItems);
      }
    } else {
      this.selectedItem = primaryValue;
      this.valueChange.emit(this.selectedItem);
      this.showPopup = false;
    }

    this.syncInlineQueryWithSelection();
  }
}
