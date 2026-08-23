import {
    Component,
    Input,
    ElementRef,
    HostListener,
    OnInit,
    OnChanges,
    SimpleChanges,
    ViewChild,
    ChangeDetectorRef,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { RouterModule } from '@angular/router'
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { PageMetadata, ApiResponse, GirdInitData, Field, CalculationEngine, LookupApiResponse, CalculationRule, ValidationEngine } from '../models'
import { Router, ActivatedRoute } from '@angular/router'
import { FileAttachmentComponent, FileAttachmentData } from '../components/file-attachment/file-attachment.component'
import { FileHandleComponent } from '../file-handle/file-handle.component'
import { DynamicLookupComponent } from '../dynamic-lookup/dynamic-lookup.component'
import { TaxcodeInputComponent } from '../shared/taxcode-input/taxcode-input.component'
import { environment } from '../../environments/environment'
import { TranslateService, TranslateModule } from '@ngx-translate/core'
import { ArrowNavigationDirective } from '../components/directive/arrow-navigation.directive';
import { CKEditorModule } from '@ckeditor/ckeditor5-angular';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import DocumentEditor from "@ckeditor/ckeditor5-build-decoupled-document";
import { PageTitleService } from '../services/page-title.service';

@Component({
    selector: 'app-popup',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        FormsModule,
        FileHandleComponent,
        FileAttachmentComponent,
        DynamicLookupComponent,
        TranslateModule,
        TaxcodeInputComponent,
        ArrowNavigationDirective,
        CKEditorModule,
    ],
    templateUrl: './dynamic-popup.component.html',
    styleUrl: './dynamic-popup.component.scss',
})
export class DynamicPopupComponent implements OnInit {
    public Editor: any = DocumentEditor;
    public editorConfig: any = {
        licenseKey: 'GPL',
        language: {
            ui: 'vi',
            content: 'vi',
            direction: 'ltr'
        },
        toolbar: [
            'undo', 'redo', '|',
            'bold', 'italic', 'underline', '|',
            'numberedList', 'bulletedList', '|',
            'link', 'blockQuote'
        ]
    };
    @Input({ required: true }) id!: string;
    @Input({ required: true }) name!: string;

    @ViewChild(FileAttachmentComponent) fileAttachmentComponent?: FileAttachmentComponent;

    mode?: string;
    metadata?: PageMetadata;
    girdData?: GirdInitData;
    selectedTab = 0;
    selectedDetailIndex = 0;
    formData: { [key: number]: { [key: string]: any } } = {};
    fileAttachmentData?: FileAttachmentData = undefined;

    detailRowsData: { [tabIndex: number]: { [detailIndex: number]: any[] } } = {};
    filteredDetailRowsData: {
        [tabIndex: number]: { [detailIndex: number]: any[] }
    } = {};

    // Store original primary key values for comparison
    originalPrimaryKeyValues: { [key: string]: any } = {};

    errors: { [key: string]: string } = {};
    columnFiltersData: {
        [tabIndex: number]: { [detailIndex: number]: { [key: string]: string } }
    } = {};
    detailSortData: {
        [tabIndex: number]: { [detailIndex: number]: { key: string; direction: 'asc' | 'desc' | '' } }
    } = {};
    selectedDetailRows = new Set<any>();
    filterMode: 'all' | 'any' = 'all';

    masterAggregates: { [key: string]: any } = {};
    calculatedValues: { [key: string]: any } = {};

    masterSubtotals: { [key: string]: any } = {};

    lookupMap: Record<string, LookupApiResponse> = {};
    lookupDefaultMap: Record<string, any> = {};
    lookupControllerMap: Record<string, string> = {};
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
    // Dynamic summary
    currentSummaryData: any = null;
    // Flag để track việc đang load dữ liệu ban đầu
    private isInitialLoading = false;
    private isResizing: boolean = false;
    private resizingColumn: string = '';
    private startX: number = 0;
    private startWidth: number = 0;
    private columnWidths: { [key: string]: number } = {};
    private minColumnWidth: number = 50;
    private maxColumnWidth: number = 1000;
    detailErrors: Record<number, Record<string, string>> = {};
    masterSectionIndexByTab: Record<number, number> = {};
    private readonly defaultMasterSection = 'Thông tin chính';
    debtSummaryDialog = {
        open: false,
        title: 'Công nợ khách hàng',
        depositLabel: 'Đã đặt cọc',
        receivableLabel: 'Phải thu',
        payableLabel: 'Phải trả',
        deposit: 0,
        receivable: 0,
        payable: 0,
        loading: false,
    };
    receiptAllocationDialog = {
        open: false,
        loading: false,
        saving: false,
        title: 'Phân bổ phải thu',
        receiptAmount: 0,
        allocatedTotal: 0,
        remainingAmount: 0,
        remainingLabel: 'Chuyển thành đặt cọc',
        receiptType: 'CUSTOMER',
        rows: [] as any[],
        config: null as any,
    };

    constructor(
        private http: HttpClient,
        private router: Router,
        private route: ActivatedRoute,
        public translate: TranslateService,
        private cdr: ChangeDetectorRef,
        private pageTitleService: PageTitleService,
    ) {
        this.translate.setDefaultLang(localStorage.getItem("language") ?? "vi");
    }

    async ngOnInit(): Promise<void> {
        this.isInitialLoading = true;
        // Đảm bảo object tồn tại
        if (!this.formData[this.selectedTab]) {
            this.formData[this.selectedTab] = {};
        }

        // Expose debug methods to global window for console access
        (window as any).debugPopup = () => this.debugState();
        (window as any).debugLookupField = (rowIndex: number, fieldKey: string) => this.debugLookupField(rowIndex, fieldKey);
        (window as any).debugUIAfterChange = (rowIndex: number) => this.debugUIAfterChange(rowIndex);
        (window as any).debugAutoGenerate = () => this.debugAutoGenerateFields();

        const isQuickCreate = this.isQuickCreateWindow();
        const storageIds = this.getPopupStorageIds();
        const actionStorage = isQuickCreate ? null : this.getFirstLocalStorageItem(storageIds.map(id => `action_${id}`));
        const copyActionStorage = isQuickCreate ? null : this.getFirstLocalStorageItem(storageIds.map(id => `action_${id}_copy`));
        const actionStr = actionStorage?.value ?? null;
        const copyActionStr = copyActionStorage?.value ?? null;

        if (actionStr) {
            this.removePopupStorageItems(storageIds.map(id => `param_${id}`));
        }
        const girdDataStorage = isQuickCreate ? null : this.getFirstLocalStorageItem(storageIds.map(id => `param_${id}`));
        const girdDataStr = girdDataStorage?.value ?? null;


        this.girdData = girdDataStr
            ? (JSON.parse(girdDataStr) as GirdInitData)
            : undefined

        if (this.girdData) {
            this.http
                .post<ApiResponse>(
                    `${environment.apiUrl}/api/FormConfig/GetFormData`,
                    this.girdData.query.formId
                )
                .subscribe(async (meta) => {
                    this.metadata = meta.Data as PageMetadata
                    this.mode = this.girdData?.mode
                    this.updatePageTitle();
                    await this.initializeFormData()
                    this.loadInitialDetailData()

                    this.checkAndAutoAddRows()
                })
        } else if (copyActionStr) {
            // Xử lý copy mode với dữ liệu từ SyncData API
            // Xóa cả 2 key có thể có
            this.removePopupStorageItems(storageIds.map(id => `action_${id}_copy`));
            this.metadata = JSON.parse(copyActionStr) as PageMetadata;
            this.mode = 'copy';
            this.updatePageTitle();

            // Dữ liệu đã được prepare sẵn từ grid, chỉ cần initialize
            await this.initializeFormData()
            this.loadInitialDetailData()
            this.checkAndAutoAddRows()

            // Hiển thị thông báo copy
            // setTimeout(() => {
            //     alert('Dữ liệu đã được sao chép thành công! Vui lòng kiểm tra và cập nhật thông tin trước khi lưu.');
            // }, 500);

        } else if (actionStr) {
            this.removePopupStorageItems(storageIds.map(id => `action_${id}`));

            this.metadata = JSON.parse(actionStr) as PageMetadata;
            this.updatePageTitle();
            await this.initializeFormData()
            this.loadInitialDetailData()
            this.checkAndAutoAddRows()
            await this.openInitialReceiptAllocationIfNeeded()
        } else {

            this.http
                .put<PageMetadata>(
                    `${environment.apiUrl}/api/FormConfig/${this.name}`,
                    null
                )
                .subscribe(async (meta) => {
                    this.metadata = meta
                    this.updatePageTitle();
                    await this.initializeFormData()
                    this.loadInitialDetailData()
                    this.checkAndAutoAddRows()
                })
        }

        if (this.metadata) {
            this.initializeColumnWidths();
        }
    }

    private updatePageTitle(): void {
        const pageTitle =
            this.metadata?.title ||
            this.metadata?.tabs?.[0]?.form?.title ||
            this.metadata?.formId ||
            this.name ||
            '';

        this.pageTitleService.setTitle(pageTitle);
    }

    private getPopupStorageIds(): string[] {
        const id = (this.id || '').trim();
        if (!id) return [];

        const lowerId = id.charAt(0).toLowerCase() + id.slice(1);
        const capitalizedId = id.charAt(0).toUpperCase() + id.slice(1);

        return Array.from(new Set([id, lowerId, capitalizedId]));
    }

    private getFirstLocalStorageItem(keys: string[]): { key: string; value: string } | null {
        for (const key of keys) {
            const value = localStorage.getItem(key);
            if (value !== null) {
                return { key, value };
            }
        }

        return null;
    }

    private removePopupStorageItems(keys: string[]): void {
        keys.forEach(key => localStorage.removeItem(key));
    }


    handleOnChange(fieldConfig: any, value: any) {
        const onChange = fieldConfig.onChange
        // Build value array theo thứ tự params
        const values = onChange.params.map((param: string) => {
            // Ưu tiên lấy từ form, nếu không có thì lấy value vừa nhập
            return this.formData?.[this.selectedTab]?.[param] ?? value
        })

        const body = {
            userId: localStorage.getItem('userId'), // hoặc lấy từ context
            unit: localStorage.getItem('unit') ?? 'CTY',
            language: localStorage.getItem('language') ?? 'vi',
            params: onChange.params,
            dataType: onChange.dataType,
            value: values,
            query: onChange.query,
        }

        if (!this.isInitialLoading) {
            this.http
                .post(environment.apiUrl + onChange.api, body)
                .subscribe((res: any) => {
                    if (res && res.data && res.data.length > 0) {
                        const map = onChange.map
                        if (this.formData?.[this.selectedTab]) {
                            Object.keys(map).forEach((fieldKey) => {
                                const apiField = map[fieldKey]
                                if (this.formData[this.selectedTab][fieldKey] !== undefined) {
                                    this.formData[this.selectedTab][fieldKey] =
                                        res.data[0][apiField]
                                }
                            })
                        }
                    }
                })
        }
    }

    handleOnChangeDetail(fieldConfig: any, value: any, rowIndex: number) {
        const onChange = fieldConfig.onChange
        const row = this.currentFilteredDetailRows[rowIndex]

        if (!row) {
            return
        }
        // Set giá trị mới vào row trước khi lấy values
        row[fieldConfig.key] = value
        // Build value array theo thứ tự params
        const values = onChange.params.map((param: string) => {
            // Lấy giá trị từ row sau khi đã set giá trị mới
            const paramValue = row[param] || '';
            return paramValue;
        });

        const body = {
            userId: localStorage.getItem('userId'), // hoặc lấy từ context
            unit: localStorage.getItem('unit') ?? 'CTY',
            language: localStorage.getItem('language') ?? 'vi',
            params: onChange.params,
            dataType: onChange.dataType,
            value: values,
            query: onChange.query,
        }

        // Chỉ trigger onChange khi KHÔNG PHẢI đang initial loading
        if (!this.isInitialLoading) {
            this.http
                .post(environment.apiUrl + onChange.api, body)
                .subscribe({
                    next: (res: any) => {

                        if (res && res.data && res.data.length > 0) {
                            const map = onChange.map

                            // Map dữ liệu vào row hiện tại
                            Object.keys(map).forEach((fieldKey) => {
                                const apiField = map[fieldKey]

                                // Khởi tạo field nếu chưa tồn tại
                                if (!(fieldKey in row)) {
                                    row[fieldKey] = ''
                                }

                                // Gán giá trị từ API response
                                if (res.data[0][apiField] !== undefined) {
                                    const oldValue = row[fieldKey]
                                    row[fieldKey] = res.data[0][apiField]

                                    // Force change detection trigger
                                    /*
                                    if (fieldKey === 'uom') {
                                      this.cdr.detectChanges()
                                      setTimeout(() => {
                                        console.log('UOM field value after timeout:', row[fieldKey])
                                      }, 100)
                                    }
                                    */
                                } else {
                                    console.warn('API field not found:', apiField)
                                }
                            })

                            // Trigger calculations cho tất cả fields được map từ API
                            Object.keys(map).forEach((mappedFieldKey) => {
                                this.triggerRowCalculations(row, mappedFieldKey)
                            })
                        } else {
                            console.warn('No data in API response or empty response:', res)
                        }

                        // Trigger calculations cho field đang thay đổi
                        this.applyRowCalculations(row, fieldConfig)
                        this.triggerRowCalculations(row, fieldConfig.key)

                        // Update master calculations
                        this.updateMasterCalculations()
                        this.calculateAggregateValues()

                        // Force change detection after all mapping complete
                        this.cdr.detectChanges()

                        // Debug: Check field states after API call
                        this.debugRowFields(rowIndex)

                        // Debug UI after change detection
                        this.debugUIAfterChange(rowIndex)
                    },
                    error: (err) => {
                        console.error('Error in handleOnChangeDetail:', err)

                        // Vẫn trigger calculations ngay cả khi API call thất bại
                        this.applyRowCalculations(row, fieldConfig)
                        this.triggerRowCalculations(row, fieldConfig.key)

                        // Update master calculations
                        this.updateMasterCalculations()
                        this.calculateAggregateValues()
                    }
                })
        } else {
            // Nếu đang initial loading, chỉ apply calculations mà không gọi API
            this.applyRowCalculations(row, fieldConfig)
            this.triggerRowCalculations(row, fieldConfig.key)

            // Update master calculations
            this.updateMasterCalculations()
            this.calculateAggregateValues()
        }
    }

    isValidDateInput(value: string): boolean {
        const regex = /^\d{4}-\d{2}-\d{2}$/

        if (!regex.test(value)) return false

        const date = new Date(value)
        return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    }


    /**
     * Kiểm tra field có thuộc tính autoGenerate không
     * @param field Field config
     * @returns boolean - Trả về true nếu autoGenerate = true, false nếu không có hoặc = false
     */
    private hasAutoGenerate(field: any): boolean {
        // Kiểm tra thuộc tính autoGenerate có tồn tại và có giá trị true không
        // Nếu không có thuộc tính này thì mặc định là false
        return field && field.hasOwnProperty('autoGenerate') ? field.autoGenerate === true : false;
    }

    /**
     * Kiểm tra giá trị boolean một cách an toàn
     * @param value Giá trị cần kiểm tra
     * @returns boolean - Trả về true chỉ khi value === true
     */
    private isTrueBooleanValue(value: any): boolean {
        return value === true;
    }

    /**
     * Kiểm tra field có thuộc tính readonly không (bao gồm cả autoGenerate)
     * @param field Field config
     * @returns boolean
     */
    isFieldReadonly(field: any): boolean {
        return this.isTrueBooleanValue(field?.readonly) || this.hasAutoGenerate(field);
    }

    /**
     * Debug method để kiểm tra cấu hình autoGenerate của các field
     */
    debugAutoGenerateFields(): void {

        if (!this.metadata) {
            return;
        }


        this.metadata.tabs.forEach((tab, tabIndex) => {
            if (tab.form) {

                tab.form.fields.forEach(field => {
                    const hasAutoGen = this.hasAutoGenerate(field);
                    const isReadonly = this.isFieldReadonly(field);
                    const currentValue = this.formData[tabIndex]?.[field.key];
                });

            }
        });


    }

    /**
     * Kiểm tra có phải đang ở chế độ insert không
     * @returns boolean
     */
    private isInsertMode(): boolean {
        const result = this.mode === 'insert' || this.mode === 'copy' || !this.girdData;
        console.log('🔍 isInsertMode check - mode:', this.mode, 'girdData:', !!this.girdData, 'result:', result);
        return result;
    }

    /**
     * Refresh lại giá trị auto-generate cho một field cụ thể
     * @param fieldKey Tên field cần refresh
     * @param tabIndex Index của tab (mặc định là tab hiện tại)
     */
    async refreshAutoGeneratedField(fieldKey: string, tabIndex?: number): Promise<void> {
        if (!this.metadata) return;

        const currentTabIndex = tabIndex ?? this.selectedTab;
        const tab = this.metadata.tabs[currentTabIndex];

        if (!tab?.form) return;

        const field = tab.form.fields.find(f => f.key === fieldKey);
        if (!field || !this.hasAutoGenerate(field)) return;

        try {
            const controller = this.metadata?.controller || this.metadata?.formId || '';
            const generatedValue = await this.getNextFieldNumber(controller, field.key, this.metadata?.formId);

            if (generatedValue) {
                if (!this.formData[currentTabIndex]) {
                    this.formData[currentTabIndex] = {};
                }
                this.formData[currentTabIndex][fieldKey] = generatedValue;
            }
        } catch (error) {
        }
    }

    private async initializeFormData(): Promise<void> {
        if (!this.metadata) return

        // Process each tab
        for (const [index, tab] of this.metadata.tabs.entries()) {
            if (tab.form) {
                // Process each field
                for (const field of tab.form.fields) {
                    let value = (tab.form as any)?.initialData?.[field.key]
                    if (field.type == 'lookup') {
                        this.loadLookupField(field.key, field.default)
                    }
                    const shouldApplyDefaultValue =
                        this.isInsertMode() &&
                        (value === undefined || value === null || value === '');

                    if (shouldApplyDefaultValue && field.type != "lookup" && field.default) {
                        if (field.type == "date" && field.default == "now") {
                            const today = new Date();
                            const yyyy = today.getFullYear();
                            const mm = String(today.getMonth() + 1).padStart(2, '0');
                            const dd = String(today.getDate()).padStart(2, '0');
                            value = `${yyyy}-${mm}-${dd}`;
                        }
                        else
                            value = field.default
                    }
                    // Kiểm tra tự động sinh số cho field có autoGenerate = true
                    if (this.hasAutoGenerate(field) && this.isInsertMode() && !value) {
                        try {
                            const controller = this.metadata?.controller || this.metadata?.formId || '';
                            if (controller) {
                                const generatedValue = await this.getNextFieldNumber(controller, field.key, this.metadata?.formId);
                                if (generatedValue) {
                                    value = generatedValue;
                                }
                            }
                        } catch (error) {

                        }
                    }

                    switch (field.type) {
                        case 'number':
                            if (isNaN(Number(value))) value = ''
                            break
                        case 'date':
                            value = value?.substring(0, 10) ?? ''
                            if (!this.isValidDateInput(value))
                                value = ''
                            break
                        default:
                            break
                    }

                    if (!this.formData[index]) {
                        this.formData[index] = {}
                    }
                    this.formData[index][field.key] = value || ''

                    // Store original primary key values for comparison (only when editing)
                    if (this.girdData && this.metadata?.primaryKey?.includes(field.key)) {
                        this.originalPrimaryKeyValues[field.key] = value || ''
                    }

                    // Đặc biệt xử lý idGui khi copy mode
                    if (this.mode === 'copy' && field.key === 'idGui' && value) {
                        // Giữ lại idGui từ API response khi copy
                        this.formData[index][field.key] = value;
                    }
                }
            }

            // Initialize detail data structures
            if (tab.detail && Array.isArray(tab.detail)) {
                this.detailRowsData[index] = {}
                this.filteredDetailRowsData[index] = {}
                this.columnFiltersData[index] = {}

                tab.detail.forEach((_, detailIndex) => {
                    this.detailRowsData[index][detailIndex] = []
                    this.filteredDetailRowsData[index][detailIndex] = []
                    this.columnFiltersData[index][detailIndex] = {}
                })
            }
        }
    }

    loadInitialDetailData(): void {
        if (!this.metadata) return

        this.metadata.tabs.forEach((tab, tabIndex) => {
            if (tab.detail && Array.isArray(tab.detail)) {
                tab.detail.forEach((detailSection, detailIndex) => {
                    let dateKeys: { [key: string]: boolean } = {}
                    detailSection.fields.forEach(field => {
                        if (field.type == 'date') {
                            dateKeys[field.key] = true
                        }
                        if (field.type == 'lookup') {
                            this.loadLookupField(field.key, field.default)
                        }
                    });
                    if (
                        detailSection.initialData &&
                        Array.isArray(detailSection.initialData)
                    ) {
                        for (let i = 0; i < detailSection.initialData.length; i++) {
                            for (const key in detailSection.initialData[i]) {
                                if (dateKeys[key]) {
                                    detailSection.initialData[i][key] = detailSection.initialData[i][key]?.substring(0, 10) ?? ''
                                }
                            }

                            // Gán idGui cho detail records khi copy mode
                            if (this.mode === 'copy' && this.metadata?.primaryKey?.includes('idGui')) {
                                const idGuiValue = this.formData[tabIndex]?.['idGui'];
                                if (idGuiValue) {
                                    detailSection.initialData[i]['idGui'] = idGuiValue;
                                }
                            }
                        }

                        this.detailRowsData[tabIndex][detailIndex] = [
                            ...detailSection.initialData,
                        ]

                    } else {
                        this.detailRowsData[tabIndex][detailIndex] = []
                    }
                })
            }
        })

        this.applyFilters()

        // Hoàn thành initial loading
        this.isInitialLoading = false
    }

    // Getter methods for current active detail section
    get currentDetailRows(): any[] {
        return (
            this.detailRowsData[this.selectedTab]?.[this.selectedDetailIndex] || []
        )
    }

    get currentFilteredDetailRows(): any[] {
        return (
            this.filteredDetailRowsData[this.selectedTab]?.[
            this.selectedDetailIndex
            ] || []
        )
    }

    get currentColumnFilters(): { [key: string]: string } {
        return (
            this.columnFiltersData[this.selectedTab]?.[this.selectedDetailIndex] || {}
        )
    }

    private ensureDetailState(
        tabIndex: number = this.selectedTab,
        detailIndex: number = this.selectedDetailIndex
    ): void {
        if (!this.detailRowsData[tabIndex]) {
            this.detailRowsData[tabIndex] = {}
        }
        if (!this.filteredDetailRowsData[tabIndex]) {
            this.filteredDetailRowsData[tabIndex] = {}
        }
        if (!this.columnFiltersData[tabIndex]) {
            this.columnFiltersData[tabIndex] = {}
        }
        if (!this.detailSortData[tabIndex]) {
            this.detailSortData[tabIndex] = {}
        }

        if (!Array.isArray(this.detailRowsData[tabIndex][detailIndex])) {
            this.detailRowsData[tabIndex][detailIndex] = []
        }
        if (!Array.isArray(this.filteredDetailRowsData[tabIndex][detailIndex])) {
            this.filteredDetailRowsData[tabIndex][detailIndex] = []
        }
        if (!this.columnFiltersData[tabIndex][detailIndex]) {
            this.columnFiltersData[tabIndex][detailIndex] = {}
        }
        if (!this.detailSortData[tabIndex][detailIndex]) {
            this.detailSortData[tabIndex][detailIndex] = { key: '', direction: '' }
        }
    }

    get currentDetailSections(): any[] {
        const currentTab = this.metadata?.tabs[this.selectedTab]
        return currentTab?.detail || []
    }

    get currentDetailSection(): any {
        return this.currentDetailSections[this.selectedDetailIndex]
    }

    hasVisibleDetailSections(tabIndex: number = this.selectedTab): boolean {
        const sections = this.metadata?.tabs?.[tabIndex]?.detail || [];
        return sections.some((section: any) => this.isDetailSectionVisible(section, tabIndex));
    }

    getVisibleDetailSectionCount(tabIndex: number = this.selectedTab): number {
        const sections = this.metadata?.tabs?.[tabIndex]?.detail || [];
        return sections.filter((section: any) => this.isDetailSectionVisible(section, tabIndex)).length;
    }

    isDetailSectionVisible(detailSection: any, tabIndex: number = this.selectedTab): boolean {
        return this.evaluateVisibilityRule(detailSection?.visibleWhen, tabIndex);
    }

    private evaluateVisibilityRule(rule: any, tabIndex: number = this.selectedTab): boolean {
        if (!rule) return true;

        if (Array.isArray(rule)) {
            return rule.every((item) => this.evaluateVisibilityRule(item, tabIndex));
        }

        if (rule.conditions && Array.isArray(rule.conditions)) {
            const mode = `${rule.logic ?? rule.mode ?? 'and'}`.toLowerCase();
            const results = rule.conditions.map((cond: any) => this.evaluateVisibilityRule(cond, tabIndex));
            return mode === 'or' ? results.some(Boolean) : results.every(Boolean);
        }

        const fieldKey = `${rule.field ?? rule.key ?? ''}`.trim();
        if (!fieldKey) return true;

        const operator = `${rule.operator ?? '='}`.toLowerCase().trim();
        const expected = rule.value;
        const actual = this.formData?.[tabIndex]?.[fieldKey];

        const actualNorm = this.normalizeVisibilityValue(actual);
        const expectedNorm = this.normalizeVisibilityValue(expected);

        switch (operator) {
            case '=':
            case '==':
            case 'eq':
                return actualNorm === expectedNorm;
            case '!=':
            case '<>':
            case 'neq':
                return actualNorm !== expectedNorm;
            case 'in': {
                const list = this.normalizeVisibilityList(expected);
                return list.includes(actualNorm);
            }
            case 'not_in':
            case 'not in': {
                const list = this.normalizeVisibilityList(expected);
                return !list.includes(actualNorm);
            }
            case 'contains':
                return actualNorm.includes(expectedNorm);
            case 'is_empty':
            case 'empty':
                return actualNorm === '';
            case 'is_not_empty':
            case 'not_empty':
                return actualNorm !== '';
            default:
                return actualNorm === expectedNorm;
        }
    }

    private normalizeVisibilityValue(value: any): string {
        if (value === null || value === undefined) return '';
        if (typeof value === 'boolean') return value ? '1' : '0';
        return `${value}`.trim().toLowerCase();
    }

    private normalizeVisibilityList(value: any): string[] {
        if (Array.isArray(value)) {
            return value.map((v) => this.normalizeVisibilityValue(v));
        }
        return `${value ?? ''}`
            .split(',')
            .map((v) => this.normalizeVisibilityValue(v))
            .filter((v) => v !== '');
    }

    private ensureSelectedDetailSectionVisible(): void {
        const sections = this.currentDetailSections;
        if (!sections.length) {
            this.selectedDetailIndex = 0;
            return;
        }

        const current = sections[this.selectedDetailIndex];
        if (current && this.isDetailSectionVisible(current, this.selectedTab)) {
            return;
        }

        const firstVisibleIndex = sections.findIndex((section: any) =>
            this.isDetailSectionVisible(section, this.selectedTab)
        );

        this.selectedDetailIndex = firstVisibleIndex >= 0 ? firstVisibleIndex : 0;
    }

    private clearHiddenDetailRowsForTab(tabIndex: number = this.selectedTab): void {
        const detailSections = this.metadata?.tabs?.[tabIndex]?.detail;
        if (!detailSections || !Array.isArray(detailSections)) {
            return;
        }

        detailSections.forEach((section: any, detailIndex: number) => {
            if (!section?.visibleWhen) {
                return;
            }
            if (this.isDetailSectionVisible(section, tabIndex)) {
                return;
            }

            if (this.detailRowsData?.[tabIndex]?.[detailIndex]?.length) {
                this.detailRowsData[tabIndex][detailIndex] = [];
            }
            if (this.filteredDetailRowsData?.[tabIndex]?.[detailIndex]?.length) {
                this.filteredDetailRowsData[tabIndex][detailIndex] = [];
            }
            if (this.columnFiltersData?.[tabIndex]?.[detailIndex]) {
                this.columnFiltersData[tabIndex][detailIndex] = {};
            }
        });
    }

    onSelectChange(): void {
        this.selectedDetailRows.clear()
        this.selectedDetailIndex = 0
        this.clearHiddenDetailRowsForTab(this.selectedTab)
        this.ensureSelectedDetailSectionVisible()
        this.applyFilters()
    }

    onDetailSectionChange(detailIndex: number): void {
        this.selectedDetailRows.clear()
        this.selectedDetailIndex = detailIndex
        this.applyFilters()
    }

    onSubmit(): void {
        this.validateForm()
        this.validateDetail()
        if (Object.keys(this.detailErrors).length > 0) {
            let message = 'Các dòng có lỗi:\n\n';

            for (const [rowIndex, fields] of Object.entries(this.detailErrors)) {
                message += `- Dòng ${+rowIndex + 1}:\n`;
                for (const [fieldKey, errorMsg] of Object.entries(fields)) {
                    message += `   • ${errorMsg}\n`;
                }
                message += '\n';
            }

            alert(message);
            return;
        }
        if (Object.keys(this.errors).length === 0 && Object.keys(this.detailErrors).length === 0) {
            const allocationError = this.validateReceiptAllocationBeforeSubmit();
            if (allocationError) {
                alert(allocationError);
                return;
            }

            // Show warning if primary key has changed

            const primaryKeyChanged = this.hasPrimaryKeyChanged()
            if (primaryKeyChanged) {
                const confirmed = confirm(
                    'Bạn đang thay đổi khóa chính của bản ghi. Bạn có chắc chắn muốn tiếp tục?'
                )
                if (!confirmed) {
                    return
                }
            }
            const payload = this.buildInsertPayload();

            if (!payload) {
                return;
            }
            this.http
                .post(
                    `${environment.apiUrl}/api/Dynamic/save`,
                    payload
                )
                .subscribe({
                    next: (response) => {
                        // Reset file attachment data sau khi save thành công
                        if (this.fileAttachmentComponent) {
                            this.fileAttachmentComponent.resetTempData();
                        }
                        this.fileAttachmentData = undefined;

                        if (this.isQuickCreateWindow()) {
                            this.notifyQuickCreateCompleted();
                            window.close();
                            return;
                        }

                        //this.router.navigate(['../'], { relativeTo: this.route })
                        this.router.navigate(['../'], {
                            relativeTo: this.route,
                            queryParamsHandling: 'merge'
                        });
                    },
                    error: (err) => {
                        alert(
                            !err?.error?.success
                                ? `${(err.error.errors as { message: string }[])?.map((e: { message: string }) => e.message).join('\n') || ''}`
                                : 'Lỗi không xác định'
                        );
                    },
                })
        } else {
            console.warn('Form có lỗi:', this.errors)
        }
    }

    getPopupActions(): any[] {
        return Array.isArray((this.metadata as any)?.popupActions)
            ? (this.metadata as any).popupActions
            : [];
    }

    shouldShowPopupAction(action: any): boolean {
        if (!action) return false;
        if (this.mode === 'view' && action.showInView === false) return false;
        if (!this.evaluateVisibilityRule(action?.visibleWhen, this.selectedTab)) return false;
        return true;
    }

    getPopupActionButtonClass(action: any): string {
        const style = (action?.style || '').toLowerCase();
        switch (style) {
            case 'primary': return 'btn-primary';
            case 'secondary': return 'btn-secondary';
            case 'warning': return 'btn-warning';
            case 'danger': return 'btn-danger';
            case 'success': return 'btn-success';
            case 'info':
            default:
                return 'btn-secondary';
        }
    }

    onPopupActionClick(action: any): void {
        if (!this.evaluateVisibilityRule(action?.visibleWhen, this.selectedTab)) {
            return;
        }
        const actionType = String(action?.type || action?.id || '').toLowerCase();
        if (actionType === 'customerdebt' || actionType === 'debt-summary' || actionType === 'customer-debt') {
            this.openCustomerDebtSummary(action);
            return;
        }
        if (actionType === 'receiptallocation' || actionType === 'receipt-allocation' || actionType === 'allocation') {
            this.openReceiptAllocation(action);
        }
    }

    closeDebtSummaryDialog(): void {
        this.debtSummaryDialog.open = false;
    }

    closeReceiptAllocationDialog(): void {
        this.receiptAllocationDialog.open = false;
    }

    private openCustomerDebtSummary(action: any): void {
        const config = action?.config || {};
        const depositField = config.depositField || 'depositAmount';
        const receivableField = config.receivableField || 'receivableAmount';
        const payableField = config.payableField || 'payableAmount';
        const currentData = this.formData?.[this.selectedTab] || {};

        this.debtSummaryDialog = {
            open: true,
            title: config.title || action?.label || 'Công nợ khách hàng',
            depositLabel: config.depositLabel || 'Đã đặt cọc',
            receivableLabel: config.receivableLabel || 'Phải thu',
            payableLabel: config.payableLabel || 'Phải trả',
            deposit: this.parseNumberInput(currentData[depositField]),
            receivable: this.parseNumberInput(currentData[receivableField]),
            payable: this.parseNumberInput(currentData[payableField]),
            loading: false,
        };

        const dataSource = config?.dataSource;
        if (!dataSource?.query) {
            return;
        }

        const apiPath = dataSource.api || '/api/CustomQuery/execute';
        const params: string[] = Array.isArray(dataSource.params) ? dataSource.params : [];
        const values = Array.isArray(dataSource.values)
            ? dataSource.values.map((item: any) => this.resolvePopupActionValue(item, currentData))
            : params.map((param) => this.resolvePopupActionValue(param, currentData));
        const dataType = Array.isArray(dataSource.dataType) && dataSource.dataType.length === params.length
            ? dataSource.dataType
            : params.map(() => 'String');

        const body = {
            userId: localStorage.getItem('userId'),
            unit: localStorage.getItem('unit') ?? 'CTY',
            language: localStorage.getItem('language') ?? 'vi',
            params,
            dataType,
            value: values,
            query: dataSource.query,
        };

        this.debtSummaryDialog.loading = true;
        this.http.post<any>(`${environment.apiUrl}${apiPath}`, body).subscribe({
            next: (res: any) => {
                const row = Array.isArray(res?.data) && res.data.length > 0 ? res.data[0] : {};
                const map = dataSource.map || {};
                const depositKey = map.deposit || depositField;
                const receivableKey = map.receivable || receivableField;
                const payableKey = map.payable || payableField;

                this.debtSummaryDialog.deposit = this.parseNumberInput(row?.[depositKey] ?? this.debtSummaryDialog.deposit);
                this.debtSummaryDialog.receivable = this.parseNumberInput(row?.[receivableKey] ?? this.debtSummaryDialog.receivable);
                this.debtSummaryDialog.payable = this.parseNumberInput(row?.[payableKey] ?? this.debtSummaryDialog.payable);
                this.debtSummaryDialog.loading = false;
            },
            error: () => {
                this.debtSummaryDialog.loading = false;
            },
        });
    }

    private async openReceiptAllocation(action: any): Promise<void> {
        const config = action?.config || {};
        const currentData = this.formData?.[this.selectedTab] || {};
        const receiptAmountField = config.receiptAmountField || 'total_amount';
        const receiptTypeField = config.receiptTypeField || 'receiptType';
        const allocationJsonField = config.allocationJsonField || 'allocationJson';
        const receiptType = String(currentData?.[receiptTypeField] || 'CUSTOMER').toUpperCase();

        this.receiptAllocationDialog = {
            open: true,
            loading: true,
            saving: false,
            title: config.title || action?.label || 'Phân bổ phải thu',
            receiptAmount: this.parseNumberInput(currentData?.[receiptAmountField]),
            allocatedTotal: 0,
            remainingAmount: 0,
            remainingLabel: receiptType === 'CUSTOMER' ? 'Chuyển thành đặt cọc' : 'Chưa phân bổ',
            receiptType,
            rows: [],
            config,
        };

        const openSource = config.openInvoiceDataSource;
        const loadSource = config.savedAllocationDataSource;
        if (!openSource?.query) {
            this.receiptAllocationDialog.loading = false;
            return;
        }

        try {
            const openRows = await this.executePopupDataSource(openSource, currentData);
            const rows = (openRows || []).map((r: any) => ({
                refIdGuiDN: r.refIdGuiDN || r.refIdguiDN || '',
                refLineNbrDN: this.parseNumberInput(r.refLineNbrDN),
                voucherNumber: r.voucherNumber || '',
                voucherDate: r.voucherDate || null,
                receivableAmount: this.parseNumberInput(r.receivableAmount || r.payableAmount || r.invoiceAmount),
                collectedAmount: this.parseNumberInput(
                    r.collectedAmount || r.paidAmount || Math.max(this.parseNumberInput(r.invoiceAmount) - this.parseNumberInput(r.outstandingAmount), 0)
                ),
                outstandingAmount: this.parseNumberInput(r.outstandingAmount),
                invoiceAmount: this.parseNumberInput(r.invoiceAmount || r.receivableAmount || r.payableAmount),
                allocatedAmount: this.parseNumberInput(r.allocatedAmount),
                note: r.note || '',
            }));

            const pendingRows = this.parseReceiptAllocationJson(currentData?.[allocationJsonField]);

            if (loadSource?.query) {
                const savedRows = await this.executePopupDataSource(loadSource, currentData);
                (savedRows || []).forEach((s: any) => {
                    const ref = s.refIdGuiDN || s.refIdguiDN || '';
                    const lineNbr = this.parseNumberInput(s.refLineNbrDN);
                    const found = rows.find((x: any) =>
                        (x.refIdGuiDN || '') === ref &&
                        this.parseNumberInput(x.refLineNbrDN) === lineNbr
                    );
                    if (found) {
                        found.allocatedAmount = this.parseNumberInput(s.allocatedAmount);
                        found.note = s.note || found.note || '';
                    } else if (ref) {
                        rows.push({
                            refIdGuiDN: ref,
                            refLineNbrDN: lineNbr,
                            voucherNumber: s.invoiceNumber || '',
                            voucherDate: s.invoiceDate || null,
                            receivableAmount: this.parseNumberInput(s.receivableAmount || s.payableAmount || s.invoiceAmount),
                            collectedAmount: this.parseNumberInput(
                                s.collectedAmount || s.paidAmount || Math.max(this.parseNumberInput(s.invoiceAmount) - this.parseNumberInput(s.outstandingAmount), 0)
                            ),
                            outstandingAmount: this.parseNumberInput(s.outstandingAmount),
                            invoiceAmount: this.parseNumberInput(s.invoiceAmount || s.receivableAmount || s.payableAmount),
                            allocatedAmount: this.parseNumberInput(s.allocatedAmount),
                            note: s.note || '',
                        });
                    }
                });
            }

            pendingRows.forEach((pending: any) => {
                const ref = pending.refIdGuiDN || pending.refIdguiDN || '';
                const lineNbr = this.parseNumberInput(pending.refLineNbrDN);
                const found = rows.find((x: any) =>
                    (x.refIdGuiDN || '') === ref &&
                    this.parseNumberInput(x.refLineNbrDN) === lineNbr
                );
                if (found) {
                    found.allocatedAmount = this.parseNumberInput(pending.allocatedAmount);
                    found.note = pending.note || found.note || '';
                } else if (ref) {
                    rows.push({
                        refIdGuiDN: ref,
                        refLineNbrDN: lineNbr,
                        voucherNumber: pending.voucherNumber || pending.invoiceNumber || '',
                        voucherDate: pending.voucherDate || pending.invoiceDate || null,
                        receivableAmount: this.parseNumberInput(pending.receivableAmount || pending.invoiceAmount),
                        collectedAmount: this.parseNumberInput(pending.collectedAmount),
                        outstandingAmount: this.parseNumberInput(pending.outstandingAmount),
                        invoiceAmount: this.parseNumberInput(pending.invoiceAmount || pending.receivableAmount),
                        allocatedAmount: this.parseNumberInput(pending.allocatedAmount),
                        note: pending.note || '',
                    });
                }
            });

            this.receiptAllocationDialog.rows = rows.sort((a: any, b: any) => {
                const selectedDiff = Number(this.parseNumberInput(b.allocatedAmount) > 0) - Number(this.parseNumberInput(a.allocatedAmount) > 0);
                if (selectedDiff !== 0) return selectedDiff;
                const dateA = a.voucherDate ? new Date(a.voucherDate).getTime() : 0;
                const dateB = b.voucherDate ? new Date(b.voucherDate).getTime() : 0;
                return dateA - dateB || String(a.voucherNumber || '').localeCompare(String(b.voucherNumber || ''));
            });
            this.recalculateReceiptAllocationTotals();
        } finally {
            this.receiptAllocationDialog.loading = false;
        }
    }

    onReceiptAllocationChange(row: any, value: any): void {
        if (!row) return;
        let v = this.parseNumberInput(value);
        if (v < 0) v = 0;
        const max = this.parseNumberInput(row.outstandingAmount);
        if (max > 0 && v > max) v = max;
        row.allocatedAmount = v;
        this.recalculateReceiptAllocationTotals();
    }

    formatAllocationInput(value: any): string {
        if (value === null || value === undefined || value === '') {
            return '';
        }
        const numeric = this.parseNumberInput(value);
        if (numeric === 0) {
            return '0';
        }
        return this.formatNumber(numeric);
    }

    onReceiptAllocationFocus(event: any, row: any): void {
        const input = event?.target as HTMLInputElement;
        if (!input || !row) return;
        const numeric = this.parseNumberInput(row.allocatedAmount);
        input.value = numeric === 0 ? '0' : String(numeric);
    }

    onReceiptAllocationBlur(event: any, row: any): void {
        const input = event?.target as HTMLInputElement;
        if (!input || !row) return;
        this.onReceiptAllocationChange(row, input.value);
        input.value = this.formatAllocationInput(row.allocatedAmount);
    }

    autoAllocateReceiptByFifo(): void {
        const rows = this.receiptAllocationDialog.rows || [];
        let remaining = this.parseNumberInput(this.receiptAllocationDialog.receiptAmount);
        rows.forEach((r: any) => r.allocatedAmount = 0);
        for (const r of rows) {
            if (remaining <= 0) break;
            const debt = Math.max(0, this.parseNumberInput(r.outstandingAmount));
            const alloc = Math.min(debt, remaining);
            r.allocatedAmount = alloc;
            remaining -= alloc;
        }
        this.recalculateReceiptAllocationTotals();
    }

    clearReceiptAllocation(): void {
        (this.receiptAllocationDialog.rows || []).forEach((r: any) => r.allocatedAmount = 0);
        this.recalculateReceiptAllocationTotals();
    }

    saveReceiptAllocation(): void {
        const config = this.receiptAllocationDialog.config || {};
        const currentData = this.formData?.[this.selectedTab] || {};
        const allocationJsonField = config.allocationJsonField || 'allocationJson';

        this.recalculateReceiptAllocationTotals();
        if (this.receiptAllocationDialog.allocatedTotal > this.receiptAllocationDialog.receiptAmount) {
            alert('Tổng phân bổ vượt số tiền phiếu thu.');
            return;
        }

        const payloadRows = (this.receiptAllocationDialog.rows || [])
            .filter((r: any) => this.parseNumberInput(r.allocatedAmount) > 0)
            .map((r: any, idx: number) => ({
                refIdGuiDN: r.refIdGuiDN,
                refLineNbrDN: this.parseNumberInput(r.refLineNbrDN),
                receiptLineNbr: idx + 1,
                invoiceNumber: r.voucherNumber || '',
                invoiceDate: r.voucherDate || null,
                invoiceAmount: this.parseNumberInput(r.invoiceAmount || 0),
                outstandingAmount: this.parseNumberInput(r.outstandingAmount || 0),
                allocatedAmount: this.parseNumberInput(r.allocatedAmount || 0),
                note: r.note || '',
            }));

        currentData[allocationJsonField] = JSON.stringify(payloadRows);
        const remaining = Math.max(0, this.receiptAllocationDialog.remainingAmount);
        const suffix = this.receiptAllocationDialog.receiptType === 'CUSTOMER' && remaining > 0
            ? ` Phần dư ${this.formatCurrency(remaining)} sẽ chuyển thành tiền đặt cọc khi xác nhận.`
            : '';
        alert(`Đã cập nhật phân bổ. Nhấn Lưu phiếu để ghi nhận.${suffix}`);
        this.closeReceiptAllocationDialog();
    }

    isSelectOptionDisabled(field: any, option: any): boolean {
        if (option?.disabled === true) return true;
        if (option?.legacyOnly !== true) return false;
        const currentValue = String(this.formData?.[this.selectedTab]?.[field?.key] ?? '');
        return currentValue !== String(option?.value ?? '');
    }

    private parseReceiptAllocationJson(value: any): any[] {
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string' || value.trim() === '') return [];
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private async openInitialReceiptAllocationIfNeeded(): Promise<void> {
        const action = this.getPopupActions().find((item: any) => {
            const actionType = String(item?.type || item?.id || '').toLowerCase();
            if (!['receiptallocation', 'receipt-allocation', 'allocation'].includes(actionType)) return false;
            const allocationJsonField = item?.config?.allocationJsonField || 'allocationJson';
            return this.parseReceiptAllocationJson(this.formData?.[this.selectedTab]?.[allocationJsonField]).length > 0;
        });
        if (action && this.evaluateVisibilityRule(action?.visibleWhen, this.selectedTab)) {
            await this.openReceiptAllocation(action);
        }
    }

    private validateReceiptAllocationBeforeSubmit(): string | null {
        const action = this.getPopupActions().find((item: any) => {
            const actionType = String(item?.type || item?.id || '').toLowerCase();
            return ['receiptallocation', 'receipt-allocation', 'allocation'].includes(actionType);
        });
        if (!action) return null;

        const config = action.config || {};
        const currentData = this.formData?.[this.selectedTab] || {};
        const receiptType = String(currentData?.[config.receiptTypeField || 'receiptType'] || '').toUpperCase();
        if (!['CUSTOMER', 'DEPOSIT_OFFSET'].includes(receiptType)) return null;

        const isConfirmed = String(currentData?.['status'] ?? '0') === '1' || this.isCheckboxChecked(currentData?.['isReceived']);
        if (!isConfirmed) return null;

        const rawAllocation = currentData?.[config.allocationJsonField || 'allocationJson'];
        const rows = this.parseReceiptAllocationJson(rawAllocation);
        if (!rows.length && !this.girdData) {
            return 'Phiếu thu công nợ phải phân bổ ít nhất một phiếu xuất trước khi xác nhận.';
        }
        if (!rows.length) return null;

        const receiptAmount = this.parseNumberInput(currentData?.[config.receiptAmountField || 'total_amount']);
        const allocatedTotal = rows.reduce(
            (sum: number, row: any) => sum + Math.max(0, this.parseNumberInput(row?.allocatedAmount)),
            0,
        );
        if (allocatedTotal <= 0) {
            return 'Phiếu thu công nợ phải có số tiền phân bổ lớn hơn 0.';
        }
        if (allocatedTotal > receiptAmount) {
            return 'Tổng phân bổ không được vượt số tiền phiếu thu.';
        }
        if (receiptType === 'DEPOSIT_OFFSET' && allocatedTotal !== receiptAmount) {
            return 'Thu công nợ từ tiền đặt cọc phải phân bổ hết số tiền cấn trừ.';
        }
        return null;
    }

    private recalculateReceiptAllocationTotals(): void {
        const total = (this.receiptAllocationDialog.rows || [])
            .reduce((sum: number, r: any) => sum + this.parseNumberInput(r.allocatedAmount), 0);
        this.receiptAllocationDialog.allocatedTotal = total;
        this.receiptAllocationDialog.remainingAmount =
            this.parseNumberInput(this.receiptAllocationDialog.receiptAmount) - total;
    }

    private executePopupDataSource(dataSource: any, currentData: Record<string, any>, overrides: Record<string, any> = {}): Promise<any[]> {
        const apiPath = dataSource.api || '/api/CustomQuery/execute';
        const params: string[] = Array.isArray(dataSource.params) ? dataSource.params : [];
        const mergedData = { ...(currentData || {}), ...(overrides || {}) };
        const values = Array.isArray(dataSource.values)
            ? dataSource.values.map((item: any) => this.resolvePopupActionValue(item, mergedData))
            : params.map((param) => this.resolvePopupActionValue(param, mergedData));
        const dataType = Array.isArray(dataSource.dataType) && dataSource.dataType.length === params.length
            ? dataSource.dataType
            : params.map(() => 'String');

        const body = {
            userId: localStorage.getItem('userId'),
            unit: localStorage.getItem('unit') ?? 'CTY',
            language: localStorage.getItem('language') ?? 'vi',
            params,
            dataType,
            value: values,
            query: dataSource.query,
        };

        return new Promise((resolve, reject) => {
            this.http.post<any>(`${environment.apiUrl}${apiPath}`, body).subscribe({
                next: (res: any) => resolve(Array.isArray(res?.data) ? res.data : []),
                error: (err) => reject(err),
            });
        });
    }

    private resolvePopupActionValue(input: any, currentData: Record<string, any>): any {
        if (input === null || input === undefined) {
            return '';
        }

        if (typeof input !== 'string') {
            return input;
        }

        if (input.startsWith('@')) {
            const key = input.substring(1);
            const normalizedKey = key.toLowerCase();

            // Global context tokens for popupActions dataSource values
            if (normalizedKey === 'unit' || normalizedKey === 'unitcode') {
                return localStorage.getItem('unit') ?? 'CTY';
            }
            if (normalizedKey === 'userid' || normalizedKey === 'user_id' || normalizedKey === 'user') {
                return localStorage.getItem('userId') ?? '';
            }
            if (normalizedKey === 'language' || normalizedKey === 'lang') {
                return localStorage.getItem('language') ?? 'vi';
            }

            return currentData?.[key] ?? '';
        }

        return currentData?.[input] ?? input;
    }

    @HostListener('document:keydown', ['$event'])
    onPopupKeyboardShortcut(event: KeyboardEvent): void {
        const isCancelShortcut =
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey &&
            ((event.key || '').toUpperCase() === 'ESCAPE' || (event.code || '').toUpperCase() === 'ESCAPE');
        const isSaveShortcut =
            this.isFunctionKey(event, 'F9') || this.isCtrlShiftLetter(event, 'S');
        if (!isCancelShortcut && !isSaveShortcut) return;

        event.preventDefault();
        if (isCancelShortcut) {
            this.onCancel();
            return;
        }

        if (this.mode === 'view') return;
        this.onSubmit();
    }

    private isFunctionKey(event: KeyboardEvent, key: string): boolean {
        const normalizedKey = (event.key || '').toUpperCase();
        const normalizedCode = (event.code || '').toUpperCase();
        const target = key.toUpperCase();
        return (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey &&
            (normalizedKey === target || normalizedCode === target)
        );
    }

    private isCtrlShiftLetter(event: KeyboardEvent, letter: string): boolean {
        const normalizedKey = (event.key || '').toUpperCase();
        const normalizedCode = (event.code || '').toUpperCase();
        const expectedCode = `KEY${letter.toUpperCase()}`;
        const expectedKey = letter.toUpperCase();
        return (
            event.ctrlKey &&
            event.shiftKey &&
            !event.metaKey &&
            !event.altKey &&
            (normalizedKey === expectedKey || normalizedCode === expectedCode)
        );
    }

    onCancel(): void {
        if (this.isQuickCreateWindow()) {
            window.close();
            return;
        }
        //this.router.navigate(['../'], { relativeTo: this.route })
        this.router.navigate(['../'], {
            relativeTo: this.route,
            queryParamsHandling: 'merge'
        });
    }

    @HostListener('window:storage', ['$event'])
    onStorageEvent(event: StorageEvent): void {
        if (event.key !== this.quickCreateStorageKey || !event.newValue) {
            return;
        }

        try {
            const payload = JSON.parse(event.newValue);
            const controller = typeof payload?.controller === 'string' ? payload.controller : '';
            if (!controller) {
                return;
            }

            this.refreshLookupOptionsByController(controller);
        } catch (error) {
            console.warn('Unable to parse quick create payload:', error);
        }
    }

    private loadLookupField(fieldKey: string, lookupDefault: any): void {
        if (!fieldKey || !lookupDefault) {
            return;
        }

        this.lookupDefaultMap[fieldKey] = lookupDefault;

        const controller = typeof lookupDefault?.controller === 'string'
            ? lookupDefault.controller.trim()
            : '';

        if (controller) {
            this.lookupControllerMap[fieldKey] = controller;
        }

        this.http.post<any>(`${environment.apiUrl}/api/Lookup`, lookupDefault)
            .subscribe((res) => {
                this.lookupMap[fieldKey] = res.data as LookupApiResponse;
            });
    }

    canQuickCreateLookup(field: any): boolean {
        if (this.mode === 'view' || field?.type !== 'lookup') {
            return false;
        }

        const controller = this.getLookupController(field);
        if (!controller) {
            return false;
        }

        return !!this.quickCreateRouteMap[controller];
    }

    openQuickCreate(field: any): void {
        const controller = this.getLookupController(field);
        const popupRoute = controller ? this.quickCreateRouteMap[controller] : '';
        if (!controller || !popupRoute) {
            return;
        }

        const popupUrl = this.router.serializeUrl(
            this.router.createUrlTree([`/${popupRoute}`], {
                queryParams: {
                    quickCreate: 1,
                    controller,
                },
            })
        );

        const quickCreateWindow = window.open(
            popupUrl,
            `_blank`,
            'popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes'
        );

        quickCreateWindow?.focus();
    }

    private getLookupController(field: any): string {
        return typeof field?.default?.controller === 'string'
            ? field.default.controller.trim()
            : '';
    }

    private isQuickCreateWindow(): boolean {
        return this.route.snapshot.queryParamMap.get('quickCreate') === '1';
    }

    private notifyQuickCreateCompleted(): void {
        const controller = this.route.snapshot.queryParamMap.get('controller')?.trim();
        if (!controller) {
            return;
        }
        const requestId = this.route.snapshot.queryParamMap.get('requestId')?.trim() || '';

        const record = this.normalizeValues(this.mergeFormData());
        const primaryKeys = this.metadata?.primaryKey || [];
        const primaryKeyValues = primaryKeys.reduce((acc: Record<string, any>, key: string) => {
            acc[key] = record?.[key];
            return acc;
        }, {});

        localStorage.setItem(
            this.quickCreateStorageKey,
            JSON.stringify({
                controller,
                requestId,
                primaryKeys,
                primaryKeyValues,
                record,
                updatedAt: Date.now(),
            })
        );
    }

    private refreshLookupOptionsByController(controller: string): void {
        if (!controller) {
            return;
        }

        Object.entries(this.lookupControllerMap).forEach(([fieldKey, lookupController]) => {
            if (lookupController === controller) {
                this.reloadLookupField(fieldKey);
            }
        });
    }

    private reloadLookupField(fieldKey: string): void {
        const lookupDefault = this.lookupDefaultMap[fieldKey];
        if (!lookupDefault) {
            return;
        }

        this.loadLookupField(fieldKey, lookupDefault);
    }

    mergeFormData(): { [key: string]: any } {
        const result: { [key: string]: any } = {}

        for (const key in this.formData) {
            Object.assign(result, this.formData[key])
        }

        return result
    }

    getMasterSections(form: any): string[] {
        const fields: Field[] = form?.fields || [];
        const sections: string[] = [];

        fields.forEach((field) => {
            if (field?.type === 'hidden') {
                return;
            }
            if (!this.evaluateVisibilityRule((field as any)?.visibleWhen, this.selectedTab)) {
                return;
            }

            const sectionName = this.getFieldMasterSection(field);
            if (!sections.includes(sectionName)) {
                sections.push(sectionName);
            }
        });

        return sections.length > 0 ? sections : [this.defaultMasterSection];
    }

    hasMasterUiTabs(form: any): boolean {
        return this.getMasterSections(form).length > 1;
    }

    getSelectedMasterSectionIndex(): number {
        return this.masterSectionIndexByTab[this.selectedTab] ?? 0;
    }

    setSelectedMasterSectionIndex(index: number): void {
        this.masterSectionIndexByTab[this.selectedTab] = index;
    }

    isFieldVisibleInMasterSection(form: any, field: Field): boolean {
        if (!this.evaluateVisibilityRule((field as any)?.visibleWhen, this.selectedTab)) {
            return false;
        }

        const sections = this.getMasterSections(form);
        if (sections.length <= 1) {
            return true;
        }

        const selectedIndex = this.getSelectedMasterSectionIndex();
        const safeIndex = Math.min(Math.max(selectedIndex, 0), sections.length - 1);
        const currentSection = sections[safeIndex];

        return this.getFieldMasterSection(field) === currentSection;
    }

    shouldShowMasterSubtotalInline(field: Field): boolean {
        return !!field?.subtotal && !this.hasVisibleDetailSections();
    }

    private getFieldMasterSection(field: Field): string {
        const rawSectionName = (field as any)?.uiTab;
        const sectionName = `${rawSectionName ?? ''}`.trim();
        return sectionName || this.defaultMasterSection;
    }

    // Check if primary key values have changed
    hasPrimaryKeyChanged(): boolean {
        if (this.isQuickCreateWindow() || this.mode === 'insert' || this.mode === 'copy') {
            return false
        }
        if (!this.girdData || !this.metadata?.primaryKey) {
            return false // New record or no primary key defined
        }

        const currentFormData = this.mergeFormData()

        for (const pkField of this.metadata.primaryKey) {
            const originalValue = this.originalPrimaryKeyValues[pkField]
            const currentValue = currentFormData[pkField]

            // Compare values (handle null/undefined/empty string cases)
            const normalizedOriginal = originalValue ?? ''
            const normalizedCurrent = currentValue ?? ''

            if (String(normalizedOriginal) !== String(normalizedCurrent)) {
                console.log(`Primary key field '${pkField}' changed from '${normalizedOriginal}' to '${normalizedCurrent}'`)
                return true
            }
        }

        return false
    }

    buildInsertPayload(): any {
        const metadataPostActions = this.metadata?.dataProcessing?.actions?.post
        const postActions = Array.isArray(metadataPostActions)
            ? metadataPostActions.map((action: any) => ({
                ...action,
                query: action?.query ?? ''
            }))
            : []
        const details: any[] = []

        if (Array.isArray(postActions)) {
            this.metadata?.tabs.forEach((tab, selectedTab) => {
                // Handle multiple detail sections
                if (tab?.detail && Array.isArray(tab.detail)) {
                    tab.detail.forEach((detailSection, detailIndex) => {
                        if (!this.isDetailSectionVisible(detailSection, selectedTab)) {
                            return;
                        }
                        const detailData =
                            this.detailRowsData[selectedTab]?.[detailIndex] || []
                        if (detailData.length > 0) {
                            details.push({
                                controllerDetail: detailSection.controllerDetail,
                                formIdDetail: detailSection.formId,
                                foreignKey: detailSection.foreignKey,
                                //data: detailData
                                data: detailData.map((row) => this.normalizeValues(row)),
                            })
                        }
                    })
                }
            })
        }

        // const formData = this.mergeFormData()
        const formData = this.normalizeValues(this.mergeFormData())

        // Determine action based on whether this is a new record or update
        let action = 'insert'
        if (this.girdData) {
            // This is an update operation
            if (this.hasPrimaryKeyChanged()) {
                action = 'update_primary_key'
                console.log('🔄 Using update_primary_key action due to primary key changes')
                console.log('📋 Original PK values:', this.originalPrimaryKeyValues)
                console.log('📋 Current PK values:', this.metadata?.primaryKey?.reduce((acc, pk) => {
                    acc[pk] = formData[pk]
                    return acc
                }, {} as any))
            } else {
                action = 'update'
                console.log('✅ Using standard update action (no primary key changes)')
            }
        } else {
            console.log('🆕 Using insert action for new record')
        }

        const payload = {
            controller: this.metadata?.controller,
            formId: this.metadata?.formId,
            action: action,
            type: this.metadata?.type,
            userId: localStorage.getItem('userId'),
            unit: localStorage.getItem('unit') ?? 'CTY',
            language: localStorage.getItem('language') ?? 'vi',
            VCDate: this.metadata?.VCDate ? formData[this.metadata?.VCDate] : '',
            idVC: this.metadata?.idVC,
            primaryKey: this.metadata?.primaryKey,
            // Thêm originalPrimaryKeyValues để backend biết khóa chính cũ
            originalPrimaryKeyValues: this.originalPrimaryKeyValues,
            data: {
                ...formData,
                details: details,
            },
            fileAttachments: this.fileAttachmentData,
            dataProcessing: {
                actions: {
                    post: postActions
                }
            },
        }

        // Nếu là voucher, lấy ngày từ voucherDate
        if (this.metadata?.type === 'voucher') {
            const voucherDate = this.formData[this.selectedTab]?.['voucherDate']
            if (voucherDate) {
                // Đảm bảo đúng format yyyy-MM-dd
                payload.VCDate =
                    typeof voucherDate === 'string'
                        ? voucherDate
                        : this.formatDate(voucherDate)
            }
        }

        return payload
    }

    private validateForm(): void {
        this.errors = {}
        const currentTab = this.metadata?.tabs[this.selectedTab]

        if (currentTab?.form) {
            currentTab.form.fields.forEach((field) => {
                if (field.required && !this.formData[this.selectedTab][field.key]) {
                    this.errors[field.key] = `${field.label} là bắt buộc`
                }
            })
        }
    }

    private validateDetail(): void {
        this.detailErrors = {}
        this.currentDetailRows.forEach((row, rowIndex) => {
            this.detailErrors[rowIndex] = {}

            for (const field of this.getAllDetailFields()) {
                if (field.required && (row[field.key] === '' || row[field.key] === null || row[field.key] === undefined)) {
                    this.detailErrors[rowIndex][field.key] = `${field.label || field.key} là bắt buộc`;
                }
            }



            if (Object.keys(this.detailErrors[rowIndex]).length === 0) {
                delete this.detailErrors[rowIndex]
            }
        })
    }

    getFieldError(fieldKey: string): string | null {
        return this.errors[fieldKey] || null
    }

    getAllDetailFields(): any[] {
        return this.currentDetailSection?.fields || []
    }

    addDetailRow(): void {
        if (!this.currentDetailSection) return

        const newRow: any = {}
        const currentRows = this.currentDetailRows

        // Get the highest line_nbr and increment
        const maxId = currentRows.reduce(
            (max, row) => Math.max(max, row.line_nbr || 0),
            0
        )

        // Initialize ALL fields (including hidden ones) with default values
        this.getAllDetailFields().forEach((field) => {
            if (field.type === 'lookup') {
                newRow[field.key] = ''
            } else {
                newRow[field.key] = field.default || ''
            }
        })

        // Đảm bảo tất cả fields từ mapping config được khởi tạo
        this.getAllDetailFields().forEach((field) => {
            if (field.onChange && field.onChange.map) {
                Object.keys(field.onChange.map).forEach((mappedField) => {
                    if (!(mappedField in newRow)) {
                        newRow[mappedField] = ''
                        //console.log('PhongNN2 - Initialized mapped field:', mappedField)
                    }
                })
            }
        })
        newRow.line_nbr = maxId + 1
        this.detailRowsData[this.selectedTab][this.selectedDetailIndex].push(
            newRow
        )
        this.applyFilters()
    }

    removeDetailRow(index: number): void {
        const rowToRemove = this.currentFilteredDetailRows[index]
        const actualIndex = this.currentDetailRows.findIndex(
            (row) => row === rowToRemove
        )

        if (actualIndex > -1) {
            this.selectedDetailRows.delete(rowToRemove)
            this.detailRowsData[this.selectedTab][this.selectedDetailIndex].splice(
                actualIndex,
                1
            )
            this.applyFilters()
        }
        this.updateMasterCalculations()
    }

    isDetailRowSelected(row: any): boolean {
        return this.selectedDetailRows.has(row)
    }

    toggleDetailRowSelection(row: any, event: Event): void {
        const checked = (event.target as HTMLInputElement | null)?.checked ?? false
        if (checked) {
            this.selectedDetailRows.add(row)
        } else {
            this.selectedDetailRows.delete(row)
        }
    }

    areAllVisibleDetailRowsSelected(): boolean {
        return this.currentFilteredDetailRows.length > 0 &&
            this.currentFilteredDetailRows.every((row) => this.selectedDetailRows.has(row))
    }

    areSomeVisibleDetailRowsSelected(): boolean {
        const selectedVisibleCount = this.currentFilteredDetailRows.filter(
            (row) => this.selectedDetailRows.has(row)
        ).length

        return selectedVisibleCount > 0 && selectedVisibleCount < this.currentFilteredDetailRows.length
    }

    toggleAllVisibleDetailRows(event: Event): void {
        const checked = (event.target as HTMLInputElement | null)?.checked ?? false
        this.currentFilteredDetailRows.forEach((row) => {
            if (checked) {
                this.selectedDetailRows.add(row)
            } else {
                this.selectedDetailRows.delete(row)
            }
        })
    }

    removeSelectedDetailRows(): void {
        const rowsToRemove = this.currentDetailRows.filter(
            (row) => this.selectedDetailRows.has(row)
        )
        if (rowsToRemove.length === 0) return

        const confirmed = confirm(`Bạn có chắc chắn muốn xóa ${rowsToRemove.length} dòng đã chọn không?`)
        if (!confirmed) return

        const rowsToRemoveSet = new Set(rowsToRemove)
        const remainingRows = this.currentDetailRows.filter(
            (row) => !rowsToRemoveSet.has(row)
        )
        remainingRows.forEach((row, index) => {
            row.line_nbr = index + 1
        })

        this.detailRowsData[this.selectedTab][this.selectedDetailIndex] = remainingRows
        this.selectedDetailRows.clear()
        this.detailErrors = {}
        this.applyFilters()
        this.updateMasterCalculations()
        this.calculateAggregateValues()
    }
    /////////

    // Trigger calculations for fields that depend on the changed field
    triggerRowCalculations(row: any, changedFieldKey: string, visited: Set<string> = new Set()): void {
        if (visited.has(changedFieldKey)) {
            return
        }
        visited.add(changedFieldKey)

        const allFields = this.getAllDetailFields()

        // Find fields that should be calculated when changedFieldKey changes
        const triggeredFields = allFields.filter(field => {
            if (field.key === changedFieldKey) {
                return false
            }

            // Check if this field's calculation depends on changedFieldKey
            if (field.calculation?.calculations) {
                const hasDependency = field.calculation.calculations.some((calc: any) =>
                    calc.dependencies?.includes(changedFieldKey)
                )
                if (hasDependency) {
                    return true
                }
            }

            // Also check trigger array (backward compatibility)
            if (field.trigger?.includes(changedFieldKey)) {
                return true
            }

            return false
        })

        console.log(`Fields triggered by ${changedFieldKey}:`, triggeredFields.map(f => f.key))

        // Calculate each triggered field
        for (const field of triggeredFields) {
            if (field.calculation?.calculations) {
                const result = CalculationEngine.applyCalculations(field, row, this.currentDetailRows)
                if (result !== null) {
                    console.log(`Calculated ${field.key} = ${result}`)
                    row[field.key] = result

                    // Recursively trigger fields that depend on this calculated field
                    this.triggerRowCalculations(row, field.key, visited)
                }
            }
        }
    }

    // Apply calculations for a specific row
    applyRowCalculations(row: any, changedField: Field): void {
        const allFields = this.getAllDetailFields()

        // Find fields that should be calculated based on this change
        const fieldsToCalculate = allFields.filter(field =>
            field.calculation?.calculations?.some((calc: CalculationRule) =>
                calc.dependencies.includes(changedField.key)
            )
        )

        // Apply calculations with enhanced support
        for (const field of fieldsToCalculate) {
            const result = CalculationEngine.applyCalculations(field, row, this.currentDetailRows)
            if (result !== null) {
                row[field.key] = result

                // Log which formula was used (for debugging)
                if (field.calculation?.calculations?.length > 1) {
                    console.log(`Field ${field.key} calculated using multiple formulas, result: ${result}`)
                }
            }
        }
    }
    calculateAggregation(config: any): number {
        const detailRows = this.currentDetailRows
        let result = 0

        switch (config.type) {
            case 'sum':
                result = detailRows.reduce((sum, row) =>
                    sum + (parseFloat(row[config.sourceField]) || 0), 0)
                break
            case 'count':
                if (config.sourceField) {
                    result = detailRows.filter(row =>
                        row[config.sourceField] !== null &&
                        row[config.sourceField] !== undefined &&
                        row[config.sourceField] !== ''
                    ).length
                } else {
                    result = detailRows.length
                }
                break
            case 'average':
                if (detailRows.length > 0) {
                    const sum = detailRows.reduce((sum, row) =>
                        sum + (parseFloat(row[config.sourceField]) || 0), 0)
                    result = sum / detailRows.length
                }
                break
        }

        return config.precision !== undefined ?
            Number(result.toFixed(config.precision)) : result
    }

    calculateField(field: any): number | null {
        if (!field.calculation?.calculations) return null;

        for (const calc of field.calculation.calculations) {
            if (calc.formula.includes('SUM([')) {
                // Use CalculationEngine with detail data for SUM formulas
                const result = CalculationEngine.evaluateFormula(
                    calc.formula,
                    this.formData[this.selectedTab], // Master data
                    this.currentDetailRows // Detail data for SUM operations
                );

                return calc.precision !== undefined ?
                    Number(result.toFixed(calc.precision)) : result;
            }
        }

        return null;
    }

    updateCalculatedFields(currentTab: any): void {
        const calculatedFields = currentTab.form.fields.filter((f: any) => f.calculation?.calculations)

        for (let iteration = 0; iteration < 3; iteration++) {
            calculatedFields.forEach((field: any) => {
                const value = this.calculateField(field)
                if (value !== null) {
                    this.formData[this.selectedTab][field.key] = value
                }
            })
        }
    }

    updateAggregationFields(currentTab: any): void {
        const aggregateFields = currentTab.form.fields.filter((f: any) => f.aggregation)

        aggregateFields.forEach((field: any) => {
            const value = this.calculateAggregation(field.aggregation)
            this.formData[this.selectedTab][field.key] = value
        })
    }

    updateMasterCalculations(): void {
        const currentTab = this.metadata?.tabs[this.selectedTab]
        if (!currentTab?.form) return

        this.updateAggregationFields(currentTab)

        this.updateCalculatedFields(currentTab)

        this.updateMasterSubtotals()
        this.updateAmountInWord()
    }

    calculateMasterFormValues(): void {
        const currentTab = this.metadata?.tabs[this.selectedTab]
        if (!currentTab?.form) return

        for (const field of currentTab.form.fields) {
            if (field.calculation?.calculations) {
                const mergedData = {
                    ...this.formData[this.selectedTab],
                    ...this.calculatedValues
                }
                const result = CalculationEngine.applyCalculations(field, mergedData)

                if (result !== null) {
                    this.formData[this.selectedTab][field.key] = result
                }
            }
        }
    }

    calculateAggregateValues(): void {
        const currentDetailSection = this.currentDetailSection
        if (!currentDetailSection?.calculations) return

        const detailData = this.currentDetailRows

        for (const calc of currentDetailSection.calculations) {
            const result = CalculationEngine.evaluateFormula(calc.formula, {}, detailData)

            // Extract field name from formula (e.g., "[subtotal]" -> "subtotal")
            const fieldMatch = calc.formula.match(/\[([^\]]+)\]\s*=/)
            if (fieldMatch) {
                const fieldName = fieldMatch[1]
                this.calculatedValues[fieldName] = calc.precision !== undefined ?
                    Number(result.toFixed(calc.precision)) : result
            }
        }

        // Trigger master form calculations that depend on detail calculations
        this.calculateMasterFormValues()
        this.updateAmountInWord()
    }

    calculateDetailAggregate(config: any, detailRows: any[]): number {
        // Apply condition filter if specified
        let filteredRows = detailRows;
        if (config.condition) {
            filteredRows = detailRows.filter(row => {
                try {
                    const condition = config.condition!.replace(/\[([^\]]+)\]/g, (_: string, fieldName: string) => {
                        const value = row[fieldName];
                        return typeof value === 'string' ? `"${value}"` : (value || 0);
                    });
                    return new Function('return ' + condition)();
                } catch {
                    return true;
                }
            });
        }

        let result = 0;
        switch (config.type) {
            case 'sum':
                result = filteredRows.reduce((sum, row) =>
                    sum + (parseFloat(row[config.sourceField]) || 0), 0);
                break;
        }

        return config.precision !== undefined ?
            Number(result.toFixed(config.precision)) : result;
    }

    // Get master field value for summary display
    getCurrentMasterFields(): any[] {
        return this.metadata?.tabs[this.selectedTab]?.form?.fields || [];
    }

    getSummaryFields(): any[] {
        return this.getCurrentMasterFields().filter(field =>
            field.type !== 'hidden' &&
            !!field.subtotal &&
            this.evaluateVisibilityRule((field as any)?.visibleWhen, this.selectedTab)
        );
    }

    // Get master field value for summary display
    getMasterFieldValue(fieldKey: string): any {
        return this.formData[this.selectedTab]?.[fieldKey] || 0;
    }
    isCurrencyField(fieldKey: string, fieldObject?: any): boolean {
        if (!fieldKey) return false

        if (fieldObject && fieldObject.currency) {
            return true
        }
        return false
    }

    private isQuantityField(fieldKey?: string): boolean {
        const normalizedKey = (fieldKey || '').replace(/[_\s]/g, '').toLowerCase();
        return normalizedKey.includes('quantity') || normalizedKey.includes('soluong') || normalizedKey === 'qty';
    }

    private getFieldFractionDigits(fieldKey?: string, fieldObject?: any): number {
        if (fieldObject && fieldObject.precision !== undefined && fieldObject.precision !== null) {
            const precision = Number(fieldObject.precision);
            if (!Number.isNaN(precision) && precision >= 0) {
                return precision;
            }
        }

        if (this.isQuantityField(fieldKey)) {
            return 2;
        }

        return 0;
    }

    formatCurrencyNumber(amount: number, fieldKey?: string, fieldObject?: any): string {
        if (amount === null || amount === undefined || isNaN(amount)) {
            return ''
        }

        // Get currency type directly from field object or default to 'VN'
        const currencyType = fieldObject?.currency || 'VN'

        // Get appropriate locale for the currency type
        const locale = this.getLocaleForCurrency(currencyType)
        const fractionDigits = this.getFieldFractionDigits(fieldKey, fieldObject);

        return new Intl.NumberFormat(locale, {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits
        }).format(amount)
    }

    parseNumberInput(value: any): number {
        if (typeof value === 'number') {
            return value
        }

        if (typeof value === 'string') {
            const cleanValue = value
                .replace(/[₫$€£¥]/g, '') // Remove currency symbols
                .replace(/\s/g, '') // Remove spaces
                .trim()

            if (!cleanValue) {
                return 0
            }

            const lastDot = cleanValue.lastIndexOf('.')
            const lastComma = cleanValue.lastIndexOf(',')
            const hasDot = lastDot >= 0
            const hasComma = lastComma >= 0

            let normalizedValue = cleanValue
            if (hasDot && hasComma) {
                // Quy ước nghiệp vụ: dấu phẩy (,) là thập phân, dấu chấm (.) là phân tách hàng nghìn
                normalizedValue = cleanValue.replace(/\./g, '').replace(/,/g, '.')
            } else if (hasComma) {
                // Chỉ có dấu phẩy: xử lý như số thập phân
                normalizedValue = cleanValue.replace(/\./g, '').replace(/,/g, '.')
            } else {
                // Không có dấu phẩy: tất cả dấu chấm đều là phân tách hàng nghìn
                normalizedValue = cleanValue.replace(/\./g, '')
            }

            const numericValue = parseFloat(normalizedValue)
            return isNaN(numericValue) ? 0 : numericValue
        }

        return 0
    }

    onNumberFocus(event: Event): void {
        const inputElement = event.target as HTMLInputElement | null;
        if (!inputElement) return;

        if (this.parseNumberInput(inputElement.value) === 0) {
            inputElement.value = '';
        }
    }

    onCurrencyBlur(event: any, rowIndex: number, fieldKey: string): void {
        const inputElement = event.target;
        const numericValue = this.parseNumberInput(inputElement.value);

        // Get the row
        const row = this.currentFilteredDetailRows[rowIndex];
        if (!row) return;

        
        if (this.detailErrors[rowIndex] && this.detailErrors[rowIndex][fieldKey]) {
            delete this.detailErrors[rowIndex][fieldKey];
        }
        // Update the row value first
        row[fieldKey] = numericValue;

        // Find field config
        const field = this.getAllDetailFields().find(f => f.key === fieldKey);

        // Format the display
        inputElement.value = this.formatCurrencyNumber(numericValue, fieldKey, field);

        if (field) {
            // Apply calculations for this row
            this.applyRowCalculations(row, field);

            // Trigger dependent field calculations
            this.triggerRowCalculations(row, fieldKey);

            // Update master calculations
            this.updateMasterCalculations();
            this.calculateAggregateValues();
        }
    }

    getLocaleForCurrency(currencyType: string): string {
        const localeMap: { [key: string]: string } = {
            'VN': 'vi-VN',
            'USD': 'en-US',
            'EUR': 'de-DE',
            'GBP': 'en-GB',
            'JPY': 'ja-JP',
            'KRW': 'ko-KR',
            'CNY': 'zh-CN',
            'THB': 'th-TH',
            'SGD': 'en-SG',
            'MYR': 'ms-MY'
        }

        return localeMap[currencyType.toUpperCase()] || 'vi-VN'
    }
    onDetailFieldChange(rowIndex: number, fieldKey: string, value: any): void {
        const row = this.currentFilteredDetailRows[rowIndex]
        if (!row) return
        if (this.detailErrors[rowIndex] && this.detailErrors[rowIndex][fieldKey]) {
            delete this.detailErrors[rowIndex][fieldKey];
        }
        // Apply calculations for this row
        const field = this.getAllDetailFields().find(f => f.key === fieldKey)
        if (field) {
            // Handle onChange if field has onChange configuration
            if (field.onChange) {
                // handleOnChangeDetail sẽ tự set giá trị vào row
                this.handleOnChangeDetail(field, value, rowIndex)
            } else {
                // Nếu không có onChange thì set giá trị và apply calculations
                row[fieldKey] = value

                // Apply calculations for this row
                this.applyRowCalculations(row, field)

                // Trigger calculations for dependent fields in the same row
                this.triggerRowCalculations(row, fieldKey)
            }
        } else {
            // Nếu không tìm thấy field config thì chỉ set giá trị
            row[fieldKey] = value
        }

        // Update master calculations
        this.updateMasterCalculations()

        // Re-apply filters if the changed field has a filter
        if (this.currentColumnFilters[fieldKey]) {
            this.applyFilters()
        }
        // Recalculate aggregate values
        this.calculateAggregateValues()
        // Update master calculations
        this.updateMasterCalculations()
    }

    trackByIndex(index: number, item: any): any {
        return item.line_nbr || index
    }

    // Filter methods updated for multiple detail sections
    onFilterChange(fieldKey: string, value: string): void {
        this.ensureDetailState()
        const filters =
            this.columnFiltersData[this.selectedTab][this.selectedDetailIndex]
        if (value && value.trim()) {
            filters[fieldKey] = value.trim()
        } else {
            delete filters[fieldKey]
        }
        this.applyFilters()
    }
    private normalizeValues(obj: any): any {
        const normalized: any = {}
        for (const key in obj) {
            let value = obj[key]
            if (typeof value === 'string' && value.trim() === '') {
                value = null // Chuỗi rỗng chuyển thành null
            }
            normalized[key] = value
        }
        return normalized
    }

    applyFilters(): void {
        this.ensureDetailState()
        const currentRows = this.currentDetailRows
        if (!currentRows || currentRows.length === 0) {
            this.filteredDetailRowsData[this.selectedTab][this.selectedDetailIndex] =
                []
            return
        }

        const filters = this.currentColumnFilters
        const validFieldKeys = new Set(
            (this.getAllDetailFields() || []).map((f) => f.key)
        )
        const activeFilters = Object.keys(filters).filter(
            (key) => validFieldKeys.has(key) && filters[key] && filters[key].trim()
        )

        if (activeFilters.length === 0) {
            this.filteredDetailRowsData[this.selectedTab][this.selectedDetailIndex] =
                this.applyDetailSort([...currentRows])
            return
        }

        this.filteredDetailRowsData[this.selectedTab][this.selectedDetailIndex] =
            this.applyDetailSort(currentRows.filter((row) => {
                const matches = activeFilters.map((fieldKey) => {
                    const filterValue = filters[fieldKey].toLowerCase()
                    const rawRowValue = row[fieldKey]
                    const rowValue = (rawRowValue || '').toString().toLowerCase()

                    const field = this.getAllDetailFields()?.find(
                        (f) => f.key === fieldKey
                    )

                    if (field?.type === 'select') {
                        return rowValue === filterValue
                    } else if (field?.type === 'lookup') {
                        const displayValue = this.getLookupDisplayValue(
                            fieldKey,
                            rawRowValue
                        ).toLowerCase()
                        return displayValue.includes(filterValue)
                    } else if (field?.type === 'number') {
                        return this.applyNumberFilter(rowValue, filterValue)


                    }
                    else if (field?.type === 'date') {
                        return this.applyDateFilter(rowValue, filterValue)
                    }
                    else {
                        // String/text fields - case insensitive contains
                        const searchValue = filterValue.toLowerCase()

                        return rowValue.includes(searchValue)
                    }
                })

                return this.filterMode === 'all'
                    ? matches.every((match) => match)
                    : matches.some((match) => match)
            }))
    }

    onDetailSortClick(field: any): void {
        if (!field?.key || field.type === 'hidden') {
            return
        }

        this.ensureDetailState()
        const currentSort = this.detailSortData[this.selectedTab][this.selectedDetailIndex]
        let nextDirection: 'asc' | 'desc' | '' = 'asc'

        if (currentSort.key === field.key) {
            nextDirection =
                currentSort.direction === 'asc'
                    ? 'desc'
                    : currentSort.direction === 'desc'
                        ? ''
                        : 'asc'
        }

        this.detailSortData[this.selectedTab][this.selectedDetailIndex] = {
            key: nextDirection ? field.key : '',
            direction: nextDirection,
        }
        this.applyFilters()
    }

    getDetailSortDirection(fieldKey: string): 'asc' | 'desc' | '' {
        const sort = this.detailSortData[this.selectedTab]?.[this.selectedDetailIndex]
        return sort?.key === fieldKey ? sort.direction : ''
    }

    private applyDetailSort(rows: any[]): any[] {
        const sort = this.detailSortData[this.selectedTab]?.[this.selectedDetailIndex]
        if (!sort?.key || !sort.direction) {
            return rows
        }

        const field = this.getAllDetailFields()?.find((f) => f.key === sort.key)
        const direction = sort.direction === 'asc' ? 1 : -1

        return [...rows].sort((a, b) => {
            const aValue = this.getDetailSortValue(a, sort.key, field)
            const bValue = this.getDetailSortValue(b, sort.key, field)

            if (aValue === bValue) return 0
            if (aValue === null || aValue === undefined || aValue === '') return 1
            if (bValue === null || bValue === undefined || bValue === '') return -1

            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return (aValue - bValue) * direction
            }

            return `${aValue}`.localeCompare(`${bValue}`, undefined, {
                numeric: true,
                sensitivity: 'base',
            }) * direction
        })
    }

    private getDetailSortValue(row: any, fieldKey: string, field: any): any {
        const rawValue = row?.[fieldKey]
        if (field?.type === 'lookup') {
            return this.getLookupDisplayValue(fieldKey, rawValue)
        }
        if (field?.type === 'number') {
            const numericValue = Number(`${rawValue ?? ''}`.replace(/,/g, ''))
            return Number.isNaN(numericValue) ? rawValue : numericValue
        }
        if (field?.type === 'date' || field?.type === 'datetime') {
            const time = new Date(rawValue).getTime()
            return Number.isNaN(time) ? rawValue : time
        }
        return rawValue
    }

    private getLookupDisplayValue(fieldKey: string, rawValue: any): string {
        const lookup = this.lookupMap[fieldKey]
        if (!lookup || rawValue === null || rawValue === undefined) {
            return (rawValue || '').toString()
        }

        const primaryField = lookup.fields?.[0]?.field
        if (!primaryField) {
            return (rawValue || '').toString()
        }

        const found = lookup.datas?.find((item) => item[primaryField] == rawValue)
        if (!found) {
            return (rawValue || '').toString()
        }

        return lookup.fields
            .map((f) => found[f.field])
            .filter((v) => v !== null && v !== undefined && `${v}`.trim() !== '')
            .join(' - ')
    }

    private applyNumberFilter(rawValue: any, filterValue: string): boolean {
        const numericValue = this.parseNumberInput(rawValue)

        // Handle comparison operators
        if (filterValue.startsWith('>=')) {
            const num = parseFloat(filterValue.substring(2).trim())
            return !isNaN(num) && numericValue >= num
        }
        else if (filterValue.startsWith('<=')) {
            const num = parseFloat(filterValue.substring(2).trim())
            return !isNaN(num) && numericValue <= num
        }
        else if (filterValue.startsWith('>')) {
            const num = parseFloat(filterValue.substring(1).trim())
            return !isNaN(num) && numericValue > num
        }
        else if (filterValue.startsWith('<')) {
            const num = parseFloat(filterValue.substring(1).trim())
            return !isNaN(num) && numericValue < num
        }
        else if (filterValue.startsWith('=')) {
            const num = parseFloat(filterValue.substring(1).trim())
            return !isNaN(num) && numericValue === num
        }
        else if (filterValue.startsWith('!=') || filterValue.startsWith('<>')) {
            const num = parseFloat(filterValue.substring(2).trim())
            return !isNaN(num) && numericValue !== num
        }
        else if (filterValue.includes('..')) {
            // Range with .. separator (e.g., "10..20")
            const [min, max] = filterValue.split('..').map(v => parseFloat(v.trim()))
            return !isNaN(min) && !isNaN(max) && numericValue >= min && numericValue <= max
        }
        else if (filterValue.includes('-') && !filterValue.startsWith('-')) {
            // Range with - separator (e.g., "10-20"), but not negative numbers
            const parts = filterValue.split('-')
            if (parts.length === 2) {
                const [min, max] = parts.map(v => parseFloat(v.trim()))
                return !isNaN(min) && !isNaN(max) && numericValue >= min && numericValue <= max
            }
        }

        // Default: exact match or contains for partial numbers
        const searchNum = parseFloat(filterValue)
        if (!isNaN(searchNum)) {
            return numericValue === searchNum
        } else {
            // Allow partial matching for numbers (e.g., searching "12" finds "120", "1234", etc.)
            return numericValue.toString().includes(filterValue)
        }
    }

    private applyDateFilter(rawValue: any, filterValue: string): boolean {
        if (!rawValue || !filterValue) return false

        const dateValue = new Date(rawValue)
        const filterDate = new Date(filterValue)

        // If filter value is not a valid date, try partial matching
        if (isNaN(filterDate.getTime())) {
            const dateString = rawValue.toString()
            return dateString.includes(filterValue)
        }

        // Normalize dates to compare only date parts (ignore time)
        const normalizeDate = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

        const normalizedDateValue = normalizeDate(dateValue)
        const normalizedFilterDate = normalizeDate(filterDate)

        return normalizedDateValue.getTime() === normalizedFilterDate.getTime()
    }

    clearFilter(fieldKey: string): void {
        this.ensureDetailState()
        delete this.columnFiltersData[this.selectedTab][this.selectedDetailIndex][
            fieldKey
        ]
        this.applyFilters()
    }

    clearAllFilters(): void {
        this.ensureDetailState()
        this.columnFiltersData[this.selectedTab][this.selectedDetailIndex] = {}
        this.applyFilters()
    }

    hasActiveFilters(): boolean {
        const filters = this.currentColumnFilters
        return Object.keys(filters).some(
            (key) => filters[key] && filters[key].trim()
        )
    }

    getActiveFilterCount(): number {
        const filters = this.currentColumnFilters
        return Object.keys(filters).filter(
            (key) => filters[key] && filters[key].trim()
        ).length
    }

    toggleFilterMode(): void {
        this.filterMode = this.filterMode === 'all' ? 'any' : 'all'
        this.applyFilters()
    }

    getColumnWidth(fieldType: string): string {
        const widthMap: { [key: string]: string } = {
            text: '200px',
            number: '120px',
            select: '150px',
            date: '130px',
        }
        return widthMap[fieldType] || '120px'
    }

    shouldShowSummary(): boolean {
        return this.currentDetailRows.length > 0 && this.hasVisibleDetailSections(this.selectedTab)
    }

    calculateSubtotal(): number {
        return this.currentDetailRows.reduce((sum, row) => {
            const quantity = parseFloat(row.quantity) || 0
            const price = parseFloat(row.price) || 0
            return sum + quantity * price
        }, 0)
    }

    calculateTax(): number {
        const subtotal = this.calculateSubtotal()
        const taxRate = 0.1
        return subtotal * taxRate
    }

    calculateDiscount(): number {
        return 0
    }

    calculateTotal(): number {
        return (
            this.calculateSubtotal() + this.calculateTax() - this.calculateDiscount()
        )
    }

    calculateTotalQuantity(): number {
        return this.currentDetailRows.reduce((sum, row) => {
            return sum + (parseFloat(row.quantity) || 0)
        }, 0)
    }

    calculateFilteredSubtotal(): number {
        return this.currentFilteredDetailRows.reduce((sum, row) => {
            const quantity = parseFloat(row.quantity) || 0
            const price = parseFloat(row.price) || 0
            return sum + quantity * price
        }, 0)
    }

    calculateFilteredQuantity(): number {
        return this.currentFilteredDetailRows.reduce((sum, row) => {
            return sum + (parseFloat(row.quantity) || 0)
        }, 0)
    }

    calculateFilteredPercentage(): string {
        const total = this.calculateSubtotal()
        const filtered = this.calculateFilteredSubtotal()
        if (total === 0) return '0'
        return ((filtered / total) * 100).toFixed(1)
    }

    formatValue(value: any, fieldType: string): string {
        if (!value) return ''

        switch (fieldType) {
            case 'number':
                return this.formatNumber(value)
            case 'date':
                return this.formatDate(value)
            default:
                return value.toString()
        }
    }

    formatFieldValue(row: any, field: any): string {
        const value = row[field.key]
        if (value === null || value === undefined || value === '') return ''

        switch (field.type) {
            case 'number':
                if (field.key === 'total' || field.key === 'price') {
                    return this.formatCurrency(parseFloat(value))
                }
                return this.formatNumber(value)
            case 'date':
                return this.formatDate(value)
            default:
                return value.toString()
        }
    }

    onCurrencyFilterChange(fieldKey: string, event: any): void {
        const inputElement = event.target
        const rawValue = inputElement.value

        this.onFilterChange(fieldKey, rawValue)
    }

    onCurrencyFilterBlur(fieldKey: string, event: any, field: any): void {
        const inputElement = event.target
        const rawValue = inputElement.value

        const numericValue = this.parseNumberInput(rawValue)
        if (!isNaN(numericValue) && numericValue !== 0) {
            inputElement.value = this.formatCurrencyNumber(numericValue, fieldKey, field)
        }
    }

    getFormattedMasterValue(fieldKey: string, field: any): string {
        const fieldValue = this.formData[this.selectedTab][fieldKey];

        // Return empty string for null/undefined/empty values
        if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
            return '';
        }

        // For currency fields, format the number
        if (this.isCurrencyField(fieldKey, field)) {
            const numericValue = this.parseNumberInput(fieldValue);
            if (!isNaN(numericValue) && numericValue !== 0) {
                return this.formatCurrencyNumber(numericValue, fieldKey, field);
            }
        }

        return fieldValue.toString();
    }

    onMasterCurrencyInput(fieldKey: string, event: any, field: any): void {
        const inputElement = event.target;
        const rawValue = inputElement.value;

        const numericValue = this.parseNumberInput(rawValue);
        this.formData[this.selectedTab][fieldKey] = numericValue;
        this.updateMasterSubtotals();

    }

    onMasterCurrencyBlur(fieldKey: string, event: any, field: any): void {
        const inputElement = event.target;
        const numericValue = this.formData[this.selectedTab][fieldKey];

        if (!isNaN(numericValue) && numericValue !== null && numericValue !== undefined) {
            const formattedValue = this.formatCurrencyNumber(numericValue, fieldKey, field);
            inputElement.value = formattedValue;

            if (field.onChange) {
                this.handleOnChange(field, numericValue);
            }
        } else {

            inputElement.value = '';
            this.formData[this.selectedTab][fieldKey] = null;
            this.updateMasterSubtotals();
        }
    }

    /**
     * Xử lý khi field được focus - gợi ý số tự động nếu field có autoIncrement = true
     */
    onFieldFocus(fieldKey: string, event: any, field: any): void {
        if (field.type === 'number') {
            this.onNumberFocus(event);
        }

        // Chỉ xử lý cho field có autoIncrement = true và chưa có giá trị
        if (field.autoIncrement && (!this.formData[this.selectedTab][fieldKey] || this.formData[this.selectedTab][fieldKey] === '')) {
            this.getNextFieldNumberForFocus(fieldKey, field);
        }
    }

    /**
     * Lấy số tiếp theo cho field từ API (async version)
     */
    async getNextFieldNumber(controller: string, field: string, formId?: string): Promise<string> {
        try {
            let params = new HttpParams()
                .set('controller', controller)
                .set('field', field);

            if (formId) {
                params = params.set('formId', formId);
            }

            const response = await this.http.get<any>(
                `${environment.apiUrl}/api/Dynamic/next-field-number-preview`,
                { params }
            ).toPromise();

            if (response?.success && response?.data) {
                return response.data;
            } else {
                return '';
            }
        } catch (error) {
            console.warn(`Failed to get next field number for ${field}:`, error);
            return '';
        }
    }

    /**
     * Lấy số tiếp theo cho field từ API (sync version cho focus event)
     */
    private getNextFieldNumberForFocus(fieldKey: string, field: any): void {
        if (!this.metadata?.formId) {
            console.warn('FormId not available for auto increment');
            return;
        }

        const params = new HttpParams()
            .set('controller', this.metadata.formId)
            .set('field', fieldKey);

        this.http.get<any>(environment.apiUrl + '/api/Dynamic/next-field-number-preview', { params })
            .subscribe({
                next: (response) => {
                    if (response.success && response.data) {
                        // Chỉ gợi ý nếu field vẫn còn trống
                        if (!this.formData[this.selectedTab][fieldKey] || this.formData[this.selectedTab][fieldKey] === '') {
                            this.formData[this.selectedTab][fieldKey] = response.data;
                            console.log(`Auto suggested value for ${fieldKey}: ${response.data}`);
                        }
                    }
                },
                error: (error) => {
                    console.warn(`Failed to get next field number for ${fieldKey}:`, error);
                }
            });
    }

    getFormattedFilterValue(fieldKey: string, field: any): string {
        const filterValue = this.currentColumnFilters[fieldKey]
        if (!filterValue) return ''

        // If it's a currency field and the filter value is a number, format it
        if (this.isCurrencyField(fieldKey, field)) {
            const numericValue = this.parseNumberInput(filterValue)
            if (!isNaN(numericValue) && numericValue !== 0) {
                // Check if the filter contains operators (>, <, =, etc.)
                if (/^[><=!]/.test(filterValue.trim())) {
                    return filterValue // Keep operators as-is
                }
                return this.formatCurrencyNumber(numericValue, fieldKey, field)
            }
        }

        return filterValue
    }
    formatCurrency(amount: number): string {
        return new Intl.NumberFormat('vi-VN', {
            style: 'currency',
            currency: 'VND',
        }).format(amount)
    }

    formatNumber(value: number): string {
        return new Intl.NumberFormat('vi-VN').format(value)
    }

    formatDate(date: string): string {
        if (!date) return ''
        return new Date(date).toLocaleDateString('vi-VN', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        })
    }

    getOptionLabel(fieldKey: string, value: string): string {
        const field = this.getAllDetailFields().find((f) => f.key === fieldKey)
        if (!field || !field.options) return value

        const option = field.options.find((opt: any) => opt.value === value)
        return option ? option.label : value
    }

    getFieldWidth(field: Field): string {
        if (field.width) {
            return field.width;
        }

        // Return default width based on field type
        return '200px';
    }

    onValueChange(data: any, key: string): void {
        this.formData[0][key] = data
    }

    /**
     * Lấy controller name từ metadata
     */
    getController(): string {
        return this.metadata?.controller || '';
    }

    /**
     * Tính sysKey từ primary key values
     * Nếu có nhiều primary key thì nối bằng dấu '|'
     */
    getSysKey(): string {
        if (!this.metadata?.primaryKey || this.metadata.primaryKey.length === 0) {
            return '';
        }

        const currentFormData = this.mergeFormData();
        const keyValues: string[] = [];

        // Lấy giá trị của từng primary key
        for (const pkField of this.metadata.primaryKey) {
            const value = currentFormData[pkField];
            // Chuyển về string và xử lý null/undefined
            const stringValue = value != null ? String(value).trim() : '';
            keyValues.push(stringValue);
        }

        // Nối các giá trị bằng dấu '|'
        return keyValues.join('|');
    }

    /**
     * Handle file attachment data changes từ file attachment component
     */
    onFileAttachmentDataChange(fileData: FileAttachmentData): void {
        this.fileAttachmentData = fileData;
        console.log('File attachment data changed:', fileData);
    }

    onFieldValueChange(value: any, field: any) {
        this.formData[this.selectedTab][field.key] = value
        this.clearHiddenDetailRowsForTab(this.selectedTab)
        this.ensureSelectedDetailSectionVisible();
        if (field.onChange) {
            this.handleOnChange(field, value)
        }

        this.updateMasterSubtotals();
    }


    onDetailLookupChange(rowIndex: number, fieldKey: string, value: any): void {
        const row = this.currentFilteredDetailRows[rowIndex];
        if (!row) {
            return;
        }
        if (this.detailErrors[rowIndex] && this.detailErrors[rowIndex][fieldKey]) {
            delete this.detailErrors[rowIndex][fieldKey];
        }
        // Find field config and handle onChange if exists
        const field = this.getAllDetailFields().find(f => f.key === fieldKey)
        if (field) {

            if (field.onChange) {
                console.log('onChange config:', JSON.stringify(field.onChange, null, 2))
            }

            // Handle onChange if field has onChange configuration
            if (field.onChange) {
                // handleOnChangeDetail sẽ tự set giá trị vào row
                this.handleOnChangeDetail(field, value, rowIndex)
            } else {
                // Nếu không có onChange thì set giá trị và apply calculations
                row[fieldKey] = value

                // Apply calculations for this row
                this.applyRowCalculations(row, field)

                // Trigger calculations for dependent fields in the same row
                this.triggerRowCalculations(row, fieldKey)
            }
        } else {
            // Nếu không tìm thấy field config thì chỉ set giá trị
            row[fieldKey] = value
        }

        // Update master calculations
        this.updateMasterCalculations()

        // Re-apply filters if the changed field has a filter
        if (this.currentColumnFilters[fieldKey]) {
            this.applyFilters()
        }

        // Recalculate aggregate values
        this.calculateAggregateValues()
    }

    // Debug method to check field values
    debugRowFields(rowIndex: number): void {
        const row = this.currentFilteredDetailRows[rowIndex]
        if (row) {
         
            // Check if fields exist in metadata
            const allFields = this.getAllDetailFields()
            const uomField = allFields.find(f => f.key === 'uom')
            const itemCodeField = allFields.find(f => f.key === 'itemCode')
            
        } else {
            console.error(' No row found at index:', rowIndex)
        }
    }

    // Global debug method - call this from browser console
    debugState(): void {
        console.log('===  DEBUG STATE ===');
        console.log('isInitialLoading:', this.isInitialLoading);
        console.log('selectedTab:', this.selectedTab);
        console.log('selectedDetailIndex:', this.selectedDetailIndex);
        console.log('metadata:', this.metadata);
        console.log('currentDetailRows length:', this.currentDetailRows.length);
        console.log('currentFilteredDetailRows length:', this.currentFilteredDetailRows.length);

        if (this.currentFilteredDetailRows.length > 0) {
            console.log('First row:', JSON.stringify(this.currentFilteredDetailRows[0], null, 2));

            // Debug lookup fields specifically
            const allFields = this.getAllDetailFields();
            const lookupFields = allFields.filter(f => f.type === 'lookup');
            console.log('Lookup fields in metadata:', lookupFields.map(f => ({ key: f.key, multiple: f.multiple, hasOnChange: !!f.onChange })));

            lookupFields.forEach(field => {
                const currentValue = this.currentFilteredDetailRows[0][field.key];
                console.log(`Lookup field "${field.key}" current value:`, currentValue);
                console.log(`Lookup field "${field.key}" default query:`, field.default);
            });
        }

        const allFields = this.getAllDetailFields();
        console.log('All detail fields:', allFields.map(f => ({ key: f.key, type: f.type, hasOnChange: !!f.onChange })));

        console.log('=== END DEBUG STATE ===');
    }

    // Debug specific row and field
    debugLookupField(rowIndex: number, fieldKey: string): void {
        console.log(`=== DEBUG LOOKUP FIELD ${fieldKey} ===`);
        const row = this.currentFilteredDetailRows[rowIndex];
        if (!row) {
            console.error('Row not found at index:', rowIndex);
            return;
        }

        const field = this.getAllDetailFields().find(f => f.key === fieldKey);
        if (!field) {
            console.error('Field not found:', fieldKey);
            return;
        }

        console.log('Field config:', JSON.stringify(field, null, 2));
        console.log('Current row value:', row[fieldKey]);
        console.log('Field type:', field.type);
        console.log('Field has onChange:', !!field.onChange);

        if (field.onChange) {
            console.log('onChange config:', JSON.stringify(field.onChange, null, 2));
        }

        console.log('=== END DEBUG LOOKUP FIELD ===');
    }

    // Debug UI after change detection
    debugUIAfterChange(rowIndex: number): void {
        console.log('=== DEBUG UI AFTER CHANGE ===');
        setTimeout(() => {
            const row = this.currentFilteredDetailRows[rowIndex];
            if (row) {
                console.log('Row data after change detection:', JSON.stringify(row, null, 2));

                // Check lookup components specifically
                const lookupElements = document.querySelectorAll('app-lookup');
                console.log('Number of lookup components found:', lookupElements.length);

                lookupElements.forEach((el, index) => {
                    console.log(`Lookup component ${index}:`, el);
                });
            }
            console.log('=== END DEBUG UI AFTER CHANGE ===');
        }, 200);
    }



    getMasterSubtotalFields(): any[] {
        return this.getCurrentMasterFields().filter(field =>
            (field.subtotal_master && field.type !== 'hidden') ||
            (field.masterSubtotalConfig && field.type !== 'hidden')
        );
    }


    calculateMasterSubtotal(targetField: Field): number {
        const currentFormData = this.formData[this.selectedTab];

        if (targetField.masterSubtotalConfig?.calculations) {
            const result = CalculationEngine.applyCalculations(
                {
                    key: targetField.key,
                    calculation: targetField.masterSubtotalConfig
                } as Field,
                currentFormData
            );
            return result !== null ? result : 0;
        }

        return this.getCurrentMasterFields()
            .filter(f => f.type === 'number' && f.key !== targetField.key && !f.disabled)
            .reduce((sum, field) => {
                return sum + (Number(currentFormData[field.key]) || 0);
            }, 0);
    }

    updateMasterSubtotals(): void {
        const masterSubtotalFields = this.getMasterSubtotalFields();

        masterSubtotalFields.forEach(field => {
            const calculatedValue = this.calculateMasterSubtotal(field);
            this.formData[this.selectedTab][field.key] = calculatedValue;
            this.masterSubtotals[field.key] = calculatedValue;
        });
    }
    onMasterFieldChange(fieldKey: string, value: any): void {
        this.formData[this.selectedTab][fieldKey] = value;
        this.clearHiddenDetailRowsForTab(this.selectedTab)
        this.ensureSelectedDetailSectionVisible();
        this.updateMasterSubtotals();
        const field = this.getCurrentMasterFields().find(f => f.key === fieldKey);
        if (field?.onChange) {
            this.handleOnChange(field, value);
        }
    }

    isCheckboxChecked(value: any): boolean {
        return value === true || value === 1 || value === '1';
    }

    onMasterCheckboxChange(fieldKey: string, checked: boolean): void {
        const normalizedValue = checked ? 1 : 0;
        this.onMasterFieldChange(fieldKey, normalizedValue);
    }

    onDetailCheckboxChange(rowIndex: number, fieldKey: string, checked: boolean): void {
        const normalizedValue = checked ? 1 : 0;
        this.onDetailFieldChange(rowIndex, fieldKey, normalizedValue);
    }

    updateLineNumbers(startIndex: number = 0, check: number): void {
        // 0: up, 1: down
        const currentRows = this.detailRowsData[this.selectedTab][this.selectedDetailIndex];

        if (check == 0) { // moveRowUp - row moved from startIndex to startIndex-1
            // The row that moved up gets the smaller line number
            currentRows[startIndex - 1].line_nbr = startIndex// 1-based indexing
            // The row that moved down gets the larger line number  
            currentRows[startIndex].line_nbr = startIndex + 1; // 1-based indexing
        } else { // moveRowDown - row moved from startIndex to startIndex+1
            // The row that moved down gets the larger line number
            currentRows[startIndex + 1].line_nbr = startIndex + 2; // 1-based indexing
            // The row that moved up gets the smaller line number
            currentRows[startIndex].line_nbr = startIndex + 1; // 1-based indexing
        }
    }
    moveRowUp(index: number): void {
        const rowToMove = this.currentFilteredDetailRows[index];
        const actualIndex = this.currentDetailRows.findIndex(row => row === rowToMove);

        if (actualIndex > 0) {
            const currentRows = this.detailRowsData[this.selectedTab][this.selectedDetailIndex];

            // Swap positions
            [currentRows[actualIndex], currentRows[actualIndex - 1]] =
                [currentRows[actualIndex - 1], currentRows[actualIndex]];

            // Update line numbers
            this.updateLineNumbers(actualIndex, 0);

            // Re-apply filters to maintain correct display
            this.applyFilters();

            // Trigger change detection
            this.cdr.detectChanges();
        }
    }

    moveRowDown(index: number): void {
        const rowToMove = this.currentFilteredDetailRows[index];
        const actualIndex = this.currentDetailRows.findIndex(row => row === rowToMove);
        const currentRows = this.detailRowsData[this.selectedTab][this.selectedDetailIndex];

        if (actualIndex < currentRows.length - 1) {
            // Swap positions
            [currentRows[actualIndex], currentRows[actualIndex + 1]] =
                [currentRows[actualIndex + 1], currentRows[actualIndex]];

            // Update line numbers
            this.updateLineNumbers(actualIndex, 1);

            // Re-apply filters to maintain correct display
            this.applyFilters();

            // Trigger change detection
            this.cdr.detectChanges();
        }
    }

    canMoveUp(index: number): boolean {
        const rowToMove = this.currentFilteredDetailRows[index];
        const actualIndex = this.currentDetailRows.findIndex(row => row === rowToMove);
        return actualIndex > 0;
    }

    canMoveDown(index: number): boolean {
        const rowToMove = this.currentFilteredDetailRows[index];
        const actualIndex = this.currentDetailRows.findIndex(row => row === rowToMove);
        const currentRows = this.detailRowsData[this.selectedTab][this.selectedDetailIndex];
        return actualIndex < currentRows.length - 1;
    }

    initializeColumnWidths(): void {
        const savedWidths = localStorage.getItem(`columnWidths_${this.metadata?.formId || 'default'}`);
        if (savedWidths) {
            try {
                this.columnWidths = JSON.parse(savedWidths);
            } catch (e) {
                this.setDefaultColumnWidths();
            }
        } else {
            this.setDefaultColumnWidths();
        }
    }

    setDefaultColumnWidths(): void {
        this.columnWidths = {
            'actions': 80,
            'rowNumber': 40
        };

        this.getAllDetailFields().forEach(field => {
            this.columnWidths[field.key] = this.getDefaultWidthForField(field);
        });
    }

    getDefaultWidthForField(field: any): number {
        if (this.isWideCodeField(field?.key)) {
            return 220;
        }

        const widthMap: { [key: string]: number } = {
            'text': 150,
            'number': 100,
            'select': 120,
            'date': 120,
            'lookup': 180
        };
        return field.width ? parseInt(field.width) : (widthMap[field.type] || 150);
    }

    private isWideCodeField(fieldKey: string | undefined): boolean {
        const normalizedKey = (fieldKey || '').replace(/[_\s]/g, '').toLowerCase();
        if (!normalizedKey) {
            return false;
        }

        const exactMatches = new Set([
            'customercode',
            'customerid',
            'itemcode',
            'itemid',
            'suppliercode',
            'supplierid',
            'employeecode',
            'employeeid',
            'jobcode',
            'jobid',
            'vendorcode',
            'vendorid',
        ]);

        if (exactMatches.has(normalizedKey)) {
            return true;
        }

        return /^(customer|item|supplier|employee|job|vendor).*(code|id)$/.test(normalizedKey);
    }

    // Resize event handlers
    startResize(event: MouseEvent, fieldKey: string): void {
        event.preventDefault();
        event.stopPropagation();

        this.isResizing = true;
        this.resizingColumn = fieldKey;
        this.startX = event.clientX;
        this.startWidth = this.columnWidths[fieldKey] || 150;

        const resizeHandle = event.target as HTMLElement;
        resizeHandle.classList.add('resizing');

        // Show resize line
        const resizeLine = document.getElementById('resizeLine');
        if (resizeLine) {
            resizeLine.style.display = 'block';
            resizeLine.style.left = event.clientX + 'px';
        }

        // Add global mouse event listeners
        document.addEventListener('mousemove', this.handleResize.bind(this));
        document.addEventListener('mouseup', this.stopResize.bind(this));

        // Prevent text selection during resize
        document.body.style.userSelect = 'none';
    }

    handleResize(event: MouseEvent): void {
        if (!this.isResizing) return;

        const deltaX = event.clientX - this.startX;
        const newWidth = Math.max(
            this.minColumnWidth,
            Math.min(this.maxColumnWidth, this.startWidth + deltaX)
        );

        // Update column width
        this.columnWidths[this.resizingColumn] = newWidth;

        // Update resize line position
        const resizeLine = document.getElementById('resizeLine');
        if (resizeLine) {
            resizeLine.style.left = event.clientX + 'px';
        }

        // Show width indicator
        this.showWidthIndicator(event.clientX, event.clientY, newWidth);

        // Apply new width immediately
        this.updateColumnWidthInDOM(this.resizingColumn, newWidth);
    }

    stopResize(event: MouseEvent): void {
        if (!this.isResizing) return;

        this.isResizing = false;

        // Remove resize styling
        const resizeHandles = document.querySelectorAll('.resize-handle.resizing');
        resizeHandles.forEach(handle => handle.classList.remove('resizing'));

        // Hide resize line and width indicator
        const resizeLine = document.getElementById('resizeLine');
        const widthIndicator = document.getElementById('widthIndicator');
        if (resizeLine) resizeLine.style.display = 'none';
        if (widthIndicator) widthIndicator.style.display = 'none';

        // Remove global listeners
        document.removeEventListener('mousemove', this.handleResize.bind(this));
        document.removeEventListener('mouseup', this.stopResize.bind(this));

        // Restore text selection
        document.body.style.userSelect = '';

        // Save column widths
        this.saveColumnWidths();

        // Trigger change detection
        this.cdr.detectChanges();

        this.resizingColumn = '';
    }

    updateColumnWidthInDOM(fieldKey: string, width: number): void {
        const headers = document.querySelectorAll(`th[data-field-key="${fieldKey}"]`);
        const cellSelector = `td:nth-child(${this.getColumnIndex(fieldKey) + 1})`;
        const cells = document.querySelectorAll(cellSelector);

        const widthPx = width + 'px';
        headers.forEach(header => (header as HTMLElement).style.width = widthPx);
        cells.forEach(cell => (cell as HTMLElement).style.width = widthPx);
    }

    getColumnIndex(fieldKey: string): number {
        if (fieldKey === 'actions') return 0;
        if (fieldKey === 'rowNumber') return 1;

        const fields = this.getAllDetailFields();
        const fieldIndex = fields.findIndex(f => f.key === fieldKey);
        return fieldIndex >= 0 ? fieldIndex + 2 : -1;
    }

    showWidthIndicator(x: number, y: number, width: number): void {
        const indicator = document.getElementById('widthIndicator');
        if (indicator) {
            indicator.textContent = `${width}px`;
            indicator.style.left = (x + 10) + 'px';
            indicator.style.top = (y - 30) + 'px';
            indicator.style.display = 'block';
        }
    }

    autoResizeColumn(event: MouseEvent, fieldKey: string): void {
        event.preventDefault();
        event.stopPropagation();

        const optimalWidth = this.calculateOptimalWidth(fieldKey);
        this.columnWidths[fieldKey] = optimalWidth;
        this.updateColumnWidthInDOM(fieldKey, optimalWidth);
        this.saveColumnWidths();
        this.cdr.detectChanges();
    }

    calculateOptimalWidth(fieldKey: string): number {
        const field = this.getAllDetailFields().find(f => f.key === fieldKey);
        if (!field) return 150;

        let maxLength = field.label?.length || 0;

        // Check content length in current data
        this.currentFilteredDetailRows.forEach(row => {
            const value = this.getFieldDisplayValue(row, field);
            maxLength = Math.max(maxLength, value.length);
        });

        // Convert character length to pixels (approximate)
        const charWidth = 8;
        const padding = 20;
        const calculatedWidth = (maxLength * charWidth) + padding;

        return Math.max(
            this.minColumnWidth,
            Math.min(this.maxColumnWidth, calculatedWidth)
        );
    }

    getFieldDisplayValue(row: any, field: any): string {
        const value = row[field.key];
        if (value === null || value === undefined || value === '') return '';

        switch (field.type) {
            case 'number':
                if (this.isCurrencyField(field.key, field)) {
                    return this.formatCurrencyNumber(parseFloat(value));
                }
                return this.formatNumber(value);
            case 'date':
                return this.formatDate(value);
            case 'select':
                return this.getOptionLabel(field.key, value);
            default:
                return value.toString();
        }
    }

    resetAllColumnWidths(): void {
        this.setDefaultColumnWidths();
        this.applyAllColumnWidths();
        this.saveColumnWidths();
    }

    autoResizeAllColumns(): void {
        this.getAllDetailFields().forEach(field => {
            const optimalWidth = this.calculateOptimalWidth(field.key);
            this.columnWidths[field.key] = optimalWidth;
        });
        this.applyAllColumnWidths();
        this.saveColumnWidths();
    }

    applyAllColumnWidths(): void {
        Object.keys(this.columnWidths).forEach(fieldKey => {
            this.updateColumnWidthInDOM(fieldKey, this.columnWidths[fieldKey]);
        });
        this.cdr.detectChanges();
    }

    saveColumnWidths(): void {
        localStorage.setItem(
            `columnWidths_${this.metadata?.formId || 'default'}`,
            JSON.stringify(this.columnWidths)
        );
    }

    isInputDisabled(field: any): boolean {
        return this.mode === 'view' || !!field.disabled;
    }


    private checkAndAutoAddRows(): void {
        const autoAddRowsStr = localStorage.getItem(`autoAddRows_${this.id}`);

        if (autoAddRowsStr) {
            const rowCount = parseInt(autoAddRowsStr, 10);

            localStorage.removeItem(`autoAddRows_${this.id}`);

            if (rowCount > 0 && !this.girdData) {
                setTimeout(() => {
                    console.log(`Auto-adding ${rowCount} detail rows...`);

                    for (let i = 0; i < rowCount; i++) {
                        this.addDetailRow();
                    }

                    console.log(`Successfully added ${rowCount} rows`);
                }, 300);
            }
        }
    }

    // VND Reader functions
    readVND(amount: number): string {
        if (amount === 0) return 'Không đồng';
        if (amount < 0) return 'Âm ' + this.readVND(-amount);

        const roundedAmount = Math.floor(amount);
        const result = this.convertToWords(roundedAmount);

        return result + ' đồng';
    }

    private convertToWords(num: number): string {
        if (num === 0) return 'không';

        const ones = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
        const tens = ['', '', 'hai mươi', 'ba mươi', 'bốn mươi', 'năm mươi', 'sáu mươi', 'bảy mươi', 'tám mươi', 'chín mươi'];
        const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

        const groups = this.splitIntoGroups(num);
        const parts: string[] = [];

        for (let i = groups.length - 1; i >= 0; i--) {
            const group = groups[i];
            if (group > 0) {
                const groupWords = this.convertGroup(group, ones, tens);
                const scale = scales[i];
                parts.push(groupWords + (scale ? ' ' + scale : ''));
            }
        }

        return this.cleanupResult(parts.join(' '));
    }

    private splitIntoGroups(num: number): number[] {
        const groups: number[] = [];
        while (num > 0) {
            groups.push(num % 1000);
            num = Math.floor(num / 1000);
        }
        return groups;
    }

    private convertGroup(num: number, ones: string[], tens: string[]): string {
        if (num === 0) return '';

        const hundreds = Math.floor(num / 100);
        const remainder = num % 100;
        const tensDigit = Math.floor(remainder / 10);
        const onesDigit = remainder % 10;

        let result = '';

        if (hundreds > 0) {
            result += ones[hundreds] + ' trăm';
        }

        if (remainder > 0) {
            if (result) result += ' ';

            if (tensDigit === 0 && onesDigit > 0) {
                if (hundreds > 0) {
                    result += 'lẻ ' + ones[onesDigit];
                } else {
                    result += ones[onesDigit];
                }
            } else if (tensDigit === 1) {
                result += 'mười';
                if (onesDigit > 0) {
                    if (onesDigit === 5) {
                        result += ' lăm';
                    } else {
                        result += ' ' + ones[onesDigit];
                    }
                }
            } else if (tensDigit > 1) {
                result += tens[tensDigit];
                if (onesDigit > 0) {
                    if (onesDigit === 1) {
                        result += ' mốt';
                    } else if (onesDigit === 5) {
                        result += ' lăm';
                    } else {
                        result += ' ' + ones[onesDigit];
                    }
                }
            }
        }

        return result.trim();
    }

    private cleanupResult(text: string): string {
        return text
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^(.)/, (match) => match.toUpperCase());
    }

    private fieldExistsInMetadata(fieldKey: string): boolean {
        if (!this.metadata) return false;

        return this.metadata.tabs.some(tab =>
            tab.form?.fields.some(field => field.key === fieldKey)
        );
    }


    private getAmountInWordSourceField(): string {
        const currentTab = this.metadata?.tabs?.[this.selectedTab];
        const amountInWordField = currentTab?.form?.fields?.find((f: any) => f?.key === 'amount_in_word') as any;

        if (!amountInWordField) {
            return 'amount_total';
        }

        const sourceFromDirect = typeof amountInWordField.amountInWordSource === 'string'
            ? amountInWordField.amountInWordSource.trim()
            : '';
        if (sourceFromDirect) {
            return sourceFromDirect;
        }

        const sourceFromNested = typeof amountInWordField?.numberToWords?.sourceField === 'string'
            ? amountInWordField.numberToWords.sourceField.trim()
            : '';
        if (sourceFromNested) {
            return sourceFromNested;
        }

        const sourceFromCommon = typeof amountInWordField.sourceField === 'string'
            ? amountInWordField.sourceField.trim()
            : '';
        if (sourceFromCommon) {
            return sourceFromCommon;
        }

        return 'amount_total';
    }

    private updateAmountInWord(): void {
        if (!this.fieldExistsInMetadata('amount_in_word')) {
            return;
        }

        const sourceField = this.getAmountInWordSourceField();
        const sourceValue = this.formData[this.selectedTab]?.[sourceField];
        const amountNumber = Number(sourceValue);

        if (sourceValue !== null && sourceValue !== undefined && !isNaN(amountNumber)) {
            const amountInWord = this.readVND(amountNumber);
            this.formData[this.selectedTab]['amount_in_word'] = amountInWord;
        } else {
            this.formData[this.selectedTab]['amount_in_word'] = '';
        }
    }

    handleTaxInfo = (info: any) => {
        if (!info) {
            return;
        }

        const nameField =
            this.fieldExistsInMetadata('customer_name') ? 'customer_name' :
            this.fieldExistsInMetadata('supplier_name') ? 'supplier_name' :
            this.fieldExistsInMetadata('company_name') ? 'company_name' :
            this.fieldExistsInMetadata('name') ? 'name' :
            null;

        if (nameField) {
            this.formData[this.selectedTab][nameField] = info.companyName;
        }

        if (this.fieldExistsInMetadata('address')) {
            this.formData[this.selectedTab]['address'] = info.address;
        }
    };
}
