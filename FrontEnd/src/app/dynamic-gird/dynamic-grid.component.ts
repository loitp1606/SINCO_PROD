import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import {
  ListApiResponse,
  GirdInitData,
  GirdHeader,
  GridAction,
  ApiResponse,
  FilterCondition,
  Field,
  PageMetadata,
  LookupApiResponse,
} from '../models';
import { DynamicPaginationComponent } from '../dynamic-pagination/dynamic-pagination.component';
import {
  AdvancedFilterComponent,
  type FilterResult,
} from '../shared/advanced-filter';
import { Router, ActivatedRoute } from '@angular/router';
import { FileHandleComponent } from '../file-handle/file-handle.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FileService } from '../services/file.service';
import { environment } from '../../environments/environment';
import { CKEditorModule } from '@ckeditor/ckeditor5-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import DocumentEditor from '@ckeditor/ckeditor5-build-decoupled-document';
import { DynamicLookupComponent } from '../dynamic-lookup/dynamic-lookup.component';
import { firstValueFrom, Subscription } from 'rxjs';
import { PageTitleService } from '../services/page-title.service';
import { ShortcutHelpService } from '../services/shortcut-help.service';

@Component({
  selector: 'app-grid',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    DynamicPaginationComponent,
    AdvancedFilterComponent,
    FileHandleComponent,
    MatButtonModule,
    MatIconModule,
    TranslateModule,
    CKEditorModule,
    DynamicLookupComponent,
  ],
  templateUrl: './dynamic-grid.component.html',
})
export class DynamicGridComponent implements OnInit, OnDestroy {
  readonly pageSizeOptions = [10, 20, 50, 100, 200];
  private readonly defaultPageSize = 200;
  private readonly selectionColumnWidth = 44;
  filterColumns: { [key: string]: string } = {};
  filteredData: any[] = [];
  @Input({ required: true }) girdData!: GirdInitData;
  @ViewChild('fileHandler') fileHandler!: FileHandleComponent;
  @ViewChild('stickyControls')
  set stickyControls(ref: ElementRef<HTMLElement> | undefined) {
    this.stickyControlsResizeObserver?.disconnect();
    this.stickyControlsElement = ref?.nativeElement;

    if (this.stickyControlsElement && typeof ResizeObserver !== 'undefined') {
      this.stickyControlsResizeObserver = new ResizeObserver(() =>
        this.scheduleStickyHeaderOffsetUpdate(),
      );
      this.stickyControlsResizeObserver.observe(this.stickyControlsElement);
    }

    this.scheduleStickyHeaderOffsetUpdate();
  }
  @ViewChild('masterScrollZone')
  set masterScrollZone(ref: ElementRef<HTMLElement> | undefined) {
    this.masterScrollZoneElement = ref?.nativeElement;
    this.scheduleStickyHeaderOffsetUpdate();
  }
  @ViewChild('detailScrollZone')
  set detailScrollZone(ref: ElementRef<HTMLElement> | undefined) {
    this.detailScrollZoneElement = ref?.nativeElement;
    this.scheduleStickyHeaderOffsetUpdate();
  }
  response?: ListApiResponse;
  showFilter: boolean = false;
  selectedTab = 0;
  selectedDetailIndex = 0;
  metadata?: PageMetadata;
  public Editor: any = DocumentEditor;
  public editorConfig: any = {
    licenseKey: 'GPL',
    language: {
      ui: 'vi',
      content: 'vi',
      direction: 'ltr',
    },
    toolbar: [
      'undo',
      'redo',
      '|',
      'bold',
      'italic',
      'underline',
      '|',
      'numberedList',
      'bulletedList',
      '|',
      'link',
      'blockQuote',
    ],
  };
  initFilter: FilterCondition[] = [];
  exportData: { [key: string]: any[] } = {};
  userData: { [key: string]: string } = {};
  masterPrimaryKeys: string[] = [];
  primarykey: string = '';
  controll = '';
  rowHeights: { [key: number]: number } = {};
  columnWidths: { [key: string]: number } = {};
  isFileHandle: string | undefined = 'both'; //"import" | "export" | "both"
  isListNotSuccess: boolean = false;
  objectKeys = Object.keys;
  private exportCount = 0;
  private exportKeyMap: Record<string, string> = {};
  selectedOptions: Record<string, any> = {};
  currentLanguage: string = 'vi'; // Track current language
  expandedRowId: any = null;
  private activeMasterRow: Record<string, any> | null = null;
  activeDetailRowIndex: number = 0;
  paneMinHeight = 140;
  masterPaneHeight = 360;
  detailPaneHeight = 240;
  private paneUserResized = false;
  private quickEditPaneSnapshot: { master: number; detail: number } | null = null;
  private readonly quickEditMasterPaneHeight = 96;
  private readonly documentShortcutListener = (event: KeyboardEvent) =>
    this.onGridKeyboardShortcut(event);
  detailPanelHidden = false;
  showShortcutHelp = false;
  gridSummaryValue = 0;
  gridSummaryLoading = false;
  selectingAllFilteredRows = false;
  private gridSummaryCache = new Map<string, number>();
  private gridSummaryRequestId = 0;
  private headerFilterDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lookupControllerMap: Record<string, string> = {};
  private shortcutHelpSubscription?: Subscription;
  private stickyControlsElement?: HTMLElement;
  private masterScrollZoneElement?: HTMLElement;
  private detailScrollZoneElement?: HTMLElement;
  private stickyControlsResizeObserver?: ResizeObserver;
  private stickyHeaderOffsetFrame: number | null = null;

  // Detail
  detailRowsData: { [tabIndex: number]: { [detailIndex: number]: any[] } } = {};
  filteredDetailRowsData: {
    [tabIndex: number]: { [detailIndex: number]: any[] };
  } = {};
  columnFiltersData: {
    [tabIndex: number]: { [detailIndex: number]: { [key: string]: string } };
  } = {};
  detailSortData: {
    [tabIndex: number]: { [detailIndex: number]: { key: string; direction: 'asc' | 'desc' | '' } };
  } = {};

  // loopup map
  lookupMap: Record<string, LookupApiResponse> = {};
  filterMode: 'all' | 'any' = 'all';
  private isHeaderLookupLoading = false;
  private readonly quickSaveExcludedFields = new Set([
    'user_id0',
    'user_id2',
    'datetime0',
    'datetime2',
  ]);
  quickEditDetailMode = false;
  quickEditSaving = false;
  private quickEditDetailSnapshot: any[] | null = null;
  quickBulkValues: Record<string, any> = {};
  quickBulkEnabled: Record<string, boolean> = {};
  private quickBulkSelectedRows = new Set<any>();
  quickEditMasterMode = false;
  quickEditMasterSaving = false;
  private quickEditMasterSnapshot: Record<string, any> | null = null;
  private quickEditMasterRowId: any = null;

  constructor(
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute,
    public translate: TranslateService,
    private pageTitleService: PageTitleService,
    private shortcutHelpService: ShortcutHelpService,
    private hostElement: ElementRef<HTMLElement>,
  ) {
    this.currentLanguage = localStorage.getItem('language') ?? 'vi';
    this.translate.setDefaultLang(this.currentLanguage);
    this.translate.use(this.currentLanguage);
  }

  toggleFilter() {
    this.showFilter = !this.showFilter;
    this.scheduleStickyHeaderOffsetUpdate();
  }

  isVoucherType(): boolean {
    return this.girdData?.query?.formId?.type === 'voucher';
  }

  isDetailPanelVisible(): boolean {
    return this.isVoucherType() && !this.detailPanelHidden;
  }

  toggleDetailPanelVisibility(): void {
    if (!this.isVoucherType()) return;
    if (!this.detailPanelHidden && this.quickEditDetailMode) {
      this.cancelQuickEditDetail(false);
    }
    this.detailPanelHidden = !this.detailPanelHidden;
  }

  showDetailPanel(): void {
    if (!this.isVoucherType()) return;
    this.detailPanelHidden = false;
    if (this.activeMasterRow) {
      this.toggleRow(this.activeMasterRow as Record<string, string>, true);
    }
  }

  ngOnInitOld(): void {
    // Subscribe to language changes
    this.translate.onLangChange.subscribe((event) => {
      this.currentLanguage = event.lang;
      localStorage.setItem('language', this.currentLanguage);
      this.lookupMap = {};
      this.isHeaderLookupLoading = false;
      // Update form language in query
      if (this.girdData.query.formId) {
        this.girdData.query.formId.language = this.currentLanguage;
      }
    });
    this.loadData();
  }
  async ngOnInit(): Promise<void> {
    await this.loadGridConfigFromBrowser();
    this.pageTitleService.setTitle(this.girdData?.title ?? '');
    this.initializePaneHeights();
    this.translate.onLangChange.subscribe((event) => {
      this.currentLanguage = event.lang;
      localStorage.setItem('language', this.currentLanguage);
      this.lookupMap = {};
      this.isHeaderLookupLoading = false;
      if (this.girdData.query.formId) {
        this.girdData.query.formId.language = this.currentLanguage;
      }
    });

    this.route.queryParams.subscribe((p) => {
      this.girdData.query.page = +p['page'] || 1;
      this.girdData.query.pageSize =
        +p['pageSize'] || this.girdData.query.pageSize || this.defaultPageSize;
      this.loadData();
    });

    this.shortcutHelpSubscription = this.shortcutHelpService.toggleShortcutHelp$.subscribe(() => {
      this.toggleShortcutHelp();
    });

    // Capture phase để không bị listener khác chặn mất phím tắt.
    document.addEventListener('keydown', this.documentShortcutListener, true);
  }

  private async loadGridConfigFromBrowser(): Promise<void> {
    const configId = (this.girdData?.id || '').trim();
    if (!configId) return;

    try {
      const response = await firstValueFrom(
        this.http.get<{ data?: Partial<GirdInitData> }>(
          `${environment.apiUrl}/api/data/browser/${encodeURIComponent(configId)}`,
        ),
      );

      const browserConfig = response?.data;
      if (!browserConfig?.id) return;

      const currentFormId = this.girdData?.query?.formId || ({} as any);
      const remoteFormId = browserConfig.query?.formId || ({} as any);

      const mergedFormId = {
        ...currentFormId,
        ...remoteFormId,
        language: localStorage.getItem('language') ?? 'vi',
        unit: localStorage.getItem('unit') ?? 'CTY',
        userId: localStorage.getItem('userId') ?? '',
        value: Array.isArray(remoteFormId.value)
          ? remoteFormId.value
          : (currentFormId.value ?? []),
      };

      this.girdData = {
        ...this.girdData,
        ...browserConfig,
        headers: browserConfig.headers ?? this.girdData.headers ?? [],
        actions: browserConfig.actions ?? this.girdData.actions ?? [],
        sort: browserConfig.sort ?? this.girdData.sort ?? '',
        query: {
          ...(this.girdData.query || {}),
          ...(browserConfig.query || {}),
          formId: mergedFormId,
        },
      } as GirdInitData;
    } catch {
      // Keep existing hardcoded initData as fallback when browser config is not provided.
    }
  }

  // Method to switch language
  switchLanguage(language: 'vi' | 'en'): void {
    this.currentLanguage = language;
    this.translate.use(language);
    localStorage.setItem('language', language);
    this.lookupMap = {};
    this.isHeaderLookupLoading = false;
    this.gridSummaryCache.clear();

    // Update form language and reload data
    if (this.girdData.query.formId) {
      this.girdData.query.formId.language = language;
    }
    this.loadData();
  }

  loadData() {
    if (!this.girdData?.query?.formId?.controller || !this.girdData?.query?.formId?.formId) {
      console.warn(
        `[DynamicGrid] Missing browser config for id='${this.girdData?.id || ''}'. ` +
          `Please create BackEnd/Server/Controllers/Browser/${this.girdData?.id || '<id>'}.list.json`,
      );
      return;
    }

    if (this.quickEditMasterMode) {
      this.cancelQuickEditMaster(false);
    }

    this.ensureHeaderLookupDataLoaded();

    const headers = new HttpHeaders({
      Authorization: `Bearer ${localStorage.getItem(`token`)}`,
      'Custom-Header': 'CustomValue',
    });
    const params = this.buildDynamicQueryParams();

    // Reset toàn bộ khi loadData
    this.selectedOptions = {};
    this.exportData = {};
    this.primarykey = '';
    localStorage.removeItem(`selection_${this.girdData.id}`);
    localStorage.removeItem(`exportData_${this.girdData.id}`);

    this.http
      .get<ListApiResponse>(`${environment.apiUrl}/api/Dynamic/filter`, {
        params,
        headers,
      })
      .subscribe({
        next: (reqData) => {
          this.response = reqData;
          this.controll = this.response.tableName;
          this.userData = {
            user_id0: this.girdData.query.formId.userId,
            datetime0: new Date().toISOString(),
          };
          this.isFileHandle = this.response.isFileHandle;
          if (this.controll == 'QuotationPaper') this.isListNotSuccess = true;
          this.preloadHeaderLookupFromFirstRow();
          this.filteredData = this.response.data ? [...this.response.data] : [];
          this.activeMasterRow = this.filteredData.length ? this.filteredData[0] : null;
          this.refreshGridSummary();
        },
        error: (error) => {
          console.error('Error loading grid metadata:', error);
        },
      });
  }

  onColumnFilterChange() {
    if (this.headerFilterDebounceTimer) {
      clearTimeout(this.headerFilterDebounceTimer);
    }

    this.headerFilterDebounceTimer = setTimeout(() => {
      this.girdData.query.page = 1;
      if ((this.route.snapshot.queryParamMap.get('page') ?? '1') === '1') {
        this.loadData();
        return;
      }
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { page: 1 },
        queryParamsHandling: 'merge',
      });
    }, 250);
  }

  getRawExportHeaders(): Array<{ key: string; label: string }> {
    return (this.girdData?.headers || [])
      .filter((header) => !header.hidden && (header.key || '').toLowerCase() !== 'idgui')
      .map((header) => ({
        key: header.key,
        label: this.resolveViLabel(header.label || header.key),
      }));
  }

  private resolveViLabel(label: string): string {
    if (!label) return '';
    if (!label.includes('.')) return label;

    const viTranslations = (this.translate as any)?.store?.translations?.['vi'];
    if (!viTranslations) {
      const fallback = this.translate.instant(label);
      return fallback && fallback !== label ? fallback : label;
    }

    const value = label.split('.').reduce((acc: any, key: string) => {
      if (acc && typeof acc === 'object' && key in acc) {
        return acc[key];
      }
      return undefined;
    }, viTranslations);

    return typeof value === 'string' && value.trim() ? value : label;
  }

  onHeaderSortClick(header: GirdHeader): void {
    if (!this.isHeaderSortable(header)) return;

    const currentDirection = this.getHeaderSortDirection(header.key);
    const nextDirection = currentDirection === 'asc' ? 'desc' : 'asc';
    this.girdData.sort = nextDirection === 'asc' ? header.key : `${header.key} desc`;

    this.gridSummaryCache.clear();
    this.girdData.query.page = 1;

    if ((this.route.snapshot.queryParamMap.get('page') ?? '1') === '1') {
      this.loadData();
      return;
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: 1 },
      queryParamsHandling: 'merge',
    });
  }

  isHeaderSortable(header: GirdHeader): boolean {
    return !!header?.key && !header.hidden && header.sortable !== false;
  }

  getHeaderSortDirection(key: string): 'asc' | 'desc' | '' {
    if (!key) return '';

    const sortParts = (this.girdData?.sort || '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const part of sortParts) {
      const segment = part.split(/\s+/).filter((s) => s.length > 0);
      const field = segment[0];
      if (!field || field !== key) continue;
      const dir = (segment[1] || '').toLowerCase();
      return dir === 'desc' ? 'desc' : 'asc';
    }

    return '';
  }

  setValue(data: Record<string, string>): void {
    this.girdData.query.formId.value = [];
    this.girdData.query.formId.primaryKey.forEach((prikey) => {
      this.girdData.query.formId.value.push(data[prikey]);
    });
    if (this.girdData.query.formId.type === 'voucher') {
      this.girdData.query.formId.VCDate = data['voucherDate'];
    }
  }

  buildDynamicQueryParams(): HttpParams {
    this.girdData.query.formId.action = 'loading';
    this.girdData.query.formId.language = this.currentLanguage;

    this.girdData.query.filter = this.getCombinedServerFilters();
    return new HttpParams()
      .set('formId', JSON.stringify(this.girdData.query.formId || {}))
      .set('filter', JSON.stringify(this.girdData.query.filter))
      .set('page', (this.girdData.query.page ?? 1).toString())
      .set('pageSize', (this.girdData.query.pageSize ?? this.defaultPageSize).toString())
      .set('sort', this.girdData.sort || '');
  }

  onPageChangeOld(newPage: number): void {
    if (newPage !== this.girdData.query.page) {
      this.girdData.query.page = newPage;
      this.loadData();
    }
  }

  onPageChange(newPage: number): void {
    if (newPage !== this.girdData.query.page) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          page: newPage,
          pageSize: this.girdData.query.pageSize || this.defaultPageSize,
        },
        queryParamsHandling: 'merge',
      });
    }
  }

  onItemsPerPageChange(newPageSize: number): void {
    if (newPageSize === (this.girdData.query.pageSize || this.defaultPageSize)) {
      return;
    }

    this.girdData.query.pageSize = newPageSize;
    this.girdData.query.page = 1;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: 1, pageSize: newPageSize },
      queryParamsHandling: 'merge',
    });
  }

  onFiltersApplied(result: FilterResult): void {
    const filterStorageKey = 'filter_' + this.girdData.id;
    const normalizedConditions = this.normalizeAdvancedFilterConditions(
      result.filterGroup.conditions ?? [],
    );
    const nextFilterValue = JSON.stringify(normalizedConditions);
    const currentFilterValue = localStorage.getItem(filterStorageKey) ?? '[]';
    const hasFilterChanged = currentFilterValue !== nextFilterValue;

    if (hasFilterChanged) {
      localStorage.setItem(filterStorageKey, nextFilterValue);
      this.girdData.query.page = 1;
      if ((this.route.snapshot.queryParamMap.get('page') ?? '1') === '1') {
        this.loadData();
        return;
      }
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { page: 1 },
        queryParamsHandling: 'merge',
      });
    }
  }

  ngOnDestroy(): void {
    if (this.headerFilterDebounceTimer) {
      clearTimeout(this.headerFilterDebounceTimer);
    }
    this.shortcutHelpSubscription?.unsubscribe();
    this.stickyControlsResizeObserver?.disconnect();
    if (this.stickyHeaderOffsetFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.stickyHeaderOffsetFrame);
    }
    document.removeEventListener('keydown', this.documentShortcutListener, true);
    this.pageTitleService.clearTitle();
  }

  private scheduleStickyHeaderOffsetUpdate(): void {
    if (typeof window === 'undefined' || this.stickyHeaderOffsetFrame !== null) {
      return;
    }

    this.stickyHeaderOffsetFrame = window.requestAnimationFrame(() => {
      this.stickyHeaderOffsetFrame = null;
      this.updateStickyHeaderOffsets();
    });
  }

  private updateStickyHeaderOffsets(): void {
    if (!this.stickyControlsElement) {
      return;
    }

    const controlsBottom = Math.max(
      0,
      Math.ceil(this.stickyControlsElement.getBoundingClientRect().bottom),
    );
    this.hostElement.nativeElement.style.setProperty(
      '--grid-sticky-controls-bottom',
      `${controlsBottom}px`,
    );

    this.setScrollZoneHeaderOffset(this.masterScrollZoneElement, controlsBottom, 62);
    this.setScrollZoneHeaderOffset(this.detailScrollZoneElement, controlsBottom, 54);
  }

  private setScrollZoneHeaderOffset(
    element: HTMLElement | undefined,
    controlsBottom: number,
    headerHeight: number,
  ): void {
    if (!element) {
      return;
    }

    const zoneTop = element.getBoundingClientRect().top;
    const availableOffset = Math.max(0, element.clientHeight - headerHeight);
    const overlap = Math.min(
      Math.max(0, controlsBottom - zoneTop),
      availableOffset,
    );
    element.style.setProperty('--grid-header-page-overlap', `${Math.ceil(overlap)}px`);
  }

  getAdvancedFilterFields(): GirdHeader[] {
    return (this.girdData.headers || [])
      .filter((header) => !header.hidden)
      .map((header) =>
        header.type === 'lookup' ? ({ ...header, type: 'text' } as GirdHeader) : header,
      );
  }

  handleClickDelete(data: Record<string, string>): void {
    const confirmed = confirm('Bạn có chắc chắn muốn xóa không?');
    if (!confirmed) {
      return;
    }

    this.setValue(data);
    this.girdData.query.formId.action = 'delete';
    this.girdData.query.formId.language = this.currentLanguage;

    this.http
      .post(
        `${environment.apiUrl}/api/dynamic/delete`,
        this.girdData.query.formId,
      )
      .subscribe({
        next: (response) => {
          const res = response as { message: string };
          alert(res.message || 'Thành công.');
          this.loadData();
        },
        error: (err) => {
          alert(
            !err?.error?.success
              ? `${
                  (err.error.errors as { message: string }[])
                    ?.map((e: { message: string }) => e.message)
                    .join('\n') || ''
                }`
              : 'Lỗi không xác định',
          );
        },
      });
  }
  handleClickAdd(): void {
    this.selectedRefresh();
    localStorage.setItem(`autoAddRows_${this.girdData.id}`, '1');
    //this.router.navigate([`${this.router.url}/popup`]);
    this.router.navigate(['popup'], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
    });
  }

  handleClickUpdate(data: Record<string, string>): void {
    this.selectedRefresh();
    this.setValue(data);

    this.girdData.mode = 'update';
    this.girdData.query.formId.language = this.currentLanguage;

    localStorage.setItem(
      `param_${this.girdData.id}`,
      JSON.stringify(this.girdData),
    );
    //this.router.navigate([`${this.router.url}/popup`]);
    this.router.navigate(['popup'], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
    });
  }

  handleClickView(data: Record<string, string>): void {
    this.selectedRefresh();
    this.setValue(data);

    this.girdData.mode = 'view';
    this.girdData.query.formId.language = this.currentLanguage;

    localStorage.setItem(
      `param_${this.girdData.id}`,
      JSON.stringify(this.girdData),
    );
    //this.router.navigate([`${this.router.url}/popup`]);
    this.router.navigate(['popup'], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.paneUserResized) {
      this.initializePaneHeights();
    }
    this.scheduleStickyHeaderOffsetUpdate();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.scheduleStickyHeaderOffsetUpdate();
  }

  private initializePaneHeights(): void {
    const viewport = Math.max(window.innerHeight || 0, 600);
    const total = Math.min(Math.max(viewport - 230, 420), 860);
    this.masterPaneHeight = Math.round(total * 0.58);
    this.detailPaneHeight = total - this.masterPaneHeight;
  }

  getMasterPaneMinHeight(): number {
    return this.quickEditDetailMode ? this.quickEditMasterPaneHeight : this.paneMinHeight;
  }

  private collapseMasterPaneForQuickEdit(): void {
    if (!this.isVoucherType() || !this.isDetailPanelVisible()) return;
    if (!this.quickEditPaneSnapshot) {
      this.quickEditPaneSnapshot = {
        master: this.masterPaneHeight,
        detail: this.detailPaneHeight,
      };
    }

    const total = this.masterPaneHeight + this.detailPaneHeight;
    const nextMaster = Math.min(
      this.quickEditMasterPaneHeight,
      Math.max(this.quickEditMasterPaneHeight, total - this.paneMinHeight),
    );
    this.masterPaneHeight = nextMaster;
    this.detailPaneHeight = total - nextMaster;
  }

  private restorePaneAfterQuickEdit(): void {
    if (!this.quickEditPaneSnapshot) return;
    this.masterPaneHeight = this.quickEditPaneSnapshot.master;
    this.detailPaneHeight = this.quickEditPaneSnapshot.detail;
    this.quickEditPaneSnapshot = null;
  }

  startPaneResize(event: MouseEvent): void {
    if (!this.isVoucherType()) return;

    event.preventDefault();
    event.stopPropagation();
    this.paneUserResized = true;

    const startY = event.clientY;
    const startMaster = this.masterPaneHeight;
    const startDetail = this.detailPaneHeight;
    const total = startMaster + startDetail;
    const min = this.getMasterPaneMinHeight();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextMaster = Math.min(Math.max(startMaster + delta, min), total - min);
      this.masterPaneHeight = nextMaster;
      this.detailPaneHeight = total - nextMaster;
    };

    const onMouseUp = () => {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  onGridButtonClick(action: GridAction): void {
    localStorage.removeItem(`param_${this.girdData.id}`);

    const dataSelectStr = localStorage.getItem(`selection_${this.girdData.id}`);
    let payload: string[] = [];
    const actId = action.id;

    if (dataSelectStr) {
      try {
        const data = JSON.parse(dataSelectStr);
        payload = Object.values(data).map((item: any) => item.idGui);
      } catch (err) {
        console.error('❌ Lỗi parse JSON:', err);
      }
    }

    const formId: any = {
      ...this.girdData.query.formId,
      ids: payload,
      IdSync: `${actId}`,
      language: this.currentLanguage,
    };

    const headers = new HttpHeaders({
      Authorization: `Bearer ${localStorage.getItem(`token`)}`,
      'Content-Type': 'application/json',
      'Custom-Header': 'CustomValue',
    });
    this.http
      .post(`${environment.apiUrl}/api/FormConfig/SyncData`, formId, {
        headers,
      })
      .subscribe(
        (meta: any) => {
          if (meta.StatusCode != 200) {
            alert(meta.message);
          } else {
            const storageKey = `action_${action.controller}`;
            console.log('storageKey', storageKey);
            localStorage.setItem(storageKey, JSON.stringify(meta.Data));
            // ✅ Mở tab mới
            const url = this.router.serializeUrl(
              this.router.createUrlTree([action.target]),
            );
            window.open(url, '_blank');
          }
        },
        (error) => {
          console.error('❌ Lỗi gọi API:', error);
          alert(error?.error?.message || 'Lỗi không xác định!');
        },
      );
  }

  onGridButtonClickV2(action: GridAction): void {
    localStorage.removeItem(`param_${this.girdData.id}`);

    localStorage.setItem(
      `action_${action.id}`,
      localStorage.getItem(`selection_${this.girdData.id}`) ?? '',
    );

    this.router.navigate([action.target]);
  }

  // Xử lý copy dữ liệu chứng từ
  onCopyDataClick(action: GridAction): void {
    localStorage.removeItem(`param_${this.girdData.id}`);

    const dataSelectStr = localStorage.getItem(`selection_${this.girdData.id}`);

    if (!dataSelectStr) {
      alert('Vui lòng chọn ít nhất một bản ghi để chép!');
      return;
    }

    let payload: string[] = [];
    try {
      const data = JSON.parse(dataSelectStr);
      payload = Object.values(data).map((item: any) => item.idGui);
    } catch (err) {
      alert('Dữ liệu selection không hợp lệ!');
      return;
    }

    if (payload.length === 0) {
      alert('Vui lòng chọn ít nhất một bản ghi để chép!');
      return;
    }

    if (payload.length > 1) {
      alert('Chỉ có thể chép một bản ghi tại một thời điểm!');
      return;
    }

    // Tạo formId giống như onGridButtonClick nhưng với copy flag
    const formId: any = {
      ...this.girdData.query.formId,
      ids: payload,
      IdSync: `${action.id}`,
      language: this.currentLanguage,
      isCopyMode: true, // Đánh dấu đây là copy mode
    };

    const headers = new HttpHeaders({
      Authorization: `Bearer ${localStorage.getItem(`token`)}`,
      'Content-Type': 'application/json',
      'Custom-Header': 'CustomValue',
    });

    this.http
      .post(`${environment.apiUrl}/api/FormConfig/SyncData`, formId, {
        headers,
      })
      .subscribe(
        (meta: any) => {
          if (meta.StatusCode != 200) {
            alert(meta.message);
          } else {
            // Xử lý dữ liệu copy trước khi lưu
            const copyData = this.prepareCopyDataFromSyncResponse(meta.Data);

            // Lưu với key unique để tránh xung đột
            const storageKey = `action_${action.controller}_copy`;
            localStorage.setItem(storageKey, JSON.stringify(copyData));

            // Reset selection và navigate
            this.selectedRefresh();

            // Mở popup
            const url = this.router.serializeUrl(
              this.router.createUrlTree([action.target]),
            );
            window.open(url, '_blank');
          }
        },
        (error) => {
          console.error('❌ Lỗi gọi API copy:', error);
          alert(
            error?.error?.message ||
              'Không thể chép dữ liệu. Vui lòng thử lại!',
          );
        },
      );
  }

  private prepareCopyDataFromSyncResponse(metadata: any): any {
    if (!metadata) return metadata;

    const copyMetadata = JSON.parse(JSON.stringify(metadata)); // Deep clone

    // Reset primary key và các field quan trọng trong master data
    copyMetadata.tabs?.forEach((tab: any) => {
      if (tab.form) {
        const masterData = tab.form.initialData || {};

        // Reset primary key nhưng giữ lại idGui từ API response
        if (copyMetadata.primaryKey && Array.isArray(copyMetadata.primaryKey)) {
          copyMetadata.primaryKey.forEach((pk: string) => {
            if (pk === 'idGui') {
              // Giữ lại idGui từ API response để sử dụng sau này
              // Không reset idGui, để nó được gán từ API
            } else {
              masterData[pk] = '';
            }
          });
        }

        // Reset các field thường cần reset khi copy
        const fieldsToReset = [
          'voucherNumber',
          'soChungTu',
          'soCT',
          'documentNumber',
        ];

        fieldsToReset.forEach((field: string) => {
          if (masterData.hasOwnProperty(field)) {
            masterData[field] = '';
          }
        });

        // Set ngày hiện tại cho voucherDate nếu có
        if (masterData.hasOwnProperty('voucherDate')) {
          const today = new Date().toISOString().split('T')[0];
          masterData['voucherDate'] = today;
        }

        tab.form.initialData = masterData;
      }

      // Xử lý detail data - reset primary key của detail
      if (tab.detail && Array.isArray(tab.detail)) {
        tab.detail.forEach((detail: any) => {
          if (detail.initialData && Array.isArray(detail.initialData)) {
            detail.initialData.forEach((detailRow: any) => {
              // Reset primary key của detail
              if (detail.primaryKey) {
                detailRow[detail.primaryKey] = '';
              }

              // Reset foreign key tới master nhưng giữ lại idGui
              if (
                copyMetadata.primaryKey &&
                Array.isArray(copyMetadata.primaryKey)
              ) {
                copyMetadata.primaryKey.forEach((pk: string) => {
                  if (detailRow.hasOwnProperty(pk)) {
                    if (pk === 'idGui') {
                      // Giữ lại idGui từ API response cho detail records
                      // Không reset idGui
                    } else {
                      detailRow[pk] = '';
                    }
                  }
                });
              }
            });
          }
        });
      }
    });

    // Đánh dấu đây là copy mode
    (copyMetadata as any).mode = 'copy';
    (copyMetadata as any).isCopyMode = true;

    return copyMetadata;
  }

  // ánh xạ primaryKey -> index export
  private loadFullRecordForExport(row: any): void {
    const primaryKeys = this.girdData.query.formId.primaryKey;
    const keyValues = primaryKeys.map((k) => row?.[k]);
    const rowKey = row[primaryKeys[0]];

    // Nếu chưa có ánh xạ thì gán mới
    if (this.exportKeyMap[rowKey] === undefined) {
      const voucherDate = row['voucherDate'];
      if (voucherDate) {
        // convert sang yyyyMM
        const d = new Date(voucherDate);
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');

        this.exportKeyMap[rowKey] = `$${year}${month}$${this.exportCount++}`; // => $202509$exportCount
      } else {
        this.exportKeyMap[rowKey] = '$' + (this.exportCount++).toString(); // Dùng số thứ tự nếu không có voucherDate
      }
    }

    const suffix = this.exportKeyMap[rowKey];

    // Nếu còn export dạng list thì xóa (chuyển sang detail)
    const listKey = this.controll.toLowerCase();
    if (this.exportData[listKey]) {
      delete this.exportData[listKey];
    }

    const formId: any = {
      ...this.girdData.query.formId,
      value: keyValues,
      action: 'update',
      language: this.currentLanguage,
    };

    if (formId.type === 'voucher') {
      formId.VCDate = row['voucherDate'];
    }

    this.http
      .post<any>(`${environment.apiUrl}/api/FormConfig/GetFormData`, formId)
      .subscribe({
        next: (res) => {
          const metadata = res.Data;
          const pk = metadata.primaryKey as string;
          const masterKey = `${metadata.formId}${suffix}`;
          // let detailKey : string[] = [];
          const masterData = metadata.tabs
            .filter((tab: any) => !!tab.form)
            .map((tab: any) => tab.form.initialData || {})
            .reduce((a: any, b: any) => ({ ...a, ...b }), {});
          const pkVal = masterData[pk];
          if (pkVal) {
            this.masterPrimaryKeys.push(pkVal);
          }
          console.log('masterPrimaryKeys khi chọn: ', this.masterPrimaryKeys);

          // const detailData: any[] = [];
          // metadata.tabs.forEach((tab: any) => {
          //   if (Array.isArray(tab.detail)) {
          //     tab.detail.forEach((detail: any) => {
          //       if (Array.isArray(detail.initialData)) {
          //         detailKey.push(`${detail.formId}${suffix}`);
          //         // detailData.push(...detail.initialData);
          //       }
          //     });
          //   }
          // });

          this.exportData[masterKey] = pkVal;
          // if(detailKey.length > 0){
          //   detailKey.forEach((dk) => {
          //     this.exportData[dk] = pkVal;
          //   });
          // }

          localStorage.setItem(
            `exportData_${this.girdData.id}`,
            JSON.stringify(this.exportData),
          );
          localStorage.setItem(
            `selection_${this.girdData.id}`,
            JSON.stringify(this.selectedOptions),
          );

          console.log(`Gán exportData[${masterKey}]`, this.exportData);
        },
        error: (err) => {
          console.error('Lỗi khi load full dữ liệu để export:', err);
        },
      });
  }

  handleSelection(event: Event, row: any) {
    const input = event.target as HTMLInputElement;
    this.setMasterRowSelection(row, !!input.checked);
  }

  async toggleSelectAllMaster(event: Event): Promise<void> {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    const checked = !!input.checked;
    if (!checked) {
      this.clearAllMasterSelection();
      return;
    }

    await this.selectAllFilteredRowsForTaxExport();
  }

  isMasterRowSelected(row: any): boolean {
    const key = row?.[this.girdData.query.formId.primaryKey[0]];
    return !!(key && this.selectedOptions[key] !== undefined);
  }

  isAllMasterRowsSelected(): boolean {
    const total = this.response?.total || 0;
    if (!total) return false;
    return this.countSelected() >= total;
  }

  isSomeMasterRowsSelected(): boolean {
    const total = this.response?.total || 0;
    const selectedCount = this.countSelected();
    return selectedCount > 0 && (!total || selectedCount < total);
  }

  private clearAllMasterSelection(): void {
    this.selectedOptions = {};
    this.exportData = {};
    this.exportKeyMap = {};
    this.masterPrimaryKeys = [];
    this.exportCount = 0;
    this.updateExportData();
    this.persistSelectionState();
  }

  private setMasterRowSelection(row: any, checked: boolean, persist: boolean = true): void {
    const key = row?.[this.girdData.query.formId.primaryKey[0]];
    if (!key) return;

    this.activeMasterRow = row;
    const listKey = this.controll.toLowerCase();
    if (this.exportData[listKey]) {
      delete this.exportData[listKey];
    }

    const isDetailExportEmpty = Object.keys(this.exportData).length === 0;
    if (isDetailExportEmpty) {
      this.updateExportData();
    }

    if (checked) {
      this.selectedOptions[key] = row;
      this.loadFullRecordForExport(row);
      if (this.isVoucherType() && !this.detailPanelHidden) {
        this.toggleRow(row, true);
      }
    } else {
      delete this.selectedOptions[key];

      const suffix = this.exportKeyMap[key];
      if (suffix !== undefined) {
        const masterPrefix = this.girdData.query.formId.formId || 'form';
        const masterKey = `${masterPrefix}${suffix}`;
        console.log(`Bỏ chọn xoá exportData[${masterKey}]`);
        delete this.exportData[masterKey];
        delete this.exportKeyMap[key];
      }
      this.masterPrimaryKeys = this.masterPrimaryKeys.filter((pk) => pk !== key);
      console.log(`pks sau khi bỏ chọn`, this.masterPrimaryKeys);
    }

    if (persist) {
      this.persistSelectionState();
    }
  }

  private persistSelectionState(): void {
    localStorage.setItem(
      `exportData_${this.girdData.id}`,
      JSON.stringify(this.exportData),
    );
    localStorage.setItem(
      `selection_${this.girdData.id}`,
      JSON.stringify(this.selectedOptions),
    );
  }

  private updateExportData() {
    // Chỉ nên dùng nếu muốn export list đơn giản (không gọi API chi tiết)
    const allowedKeys = this.girdData.headers.map((h) => h.key);
    const selectedRows = Object.values(this.selectedOptions);
    const exportRows =
      selectedRows.length > 0 ? selectedRows : (this.response?.data ?? []);

    const cleanData = exportRows.map((item) => {
      const filtered: any = {};
      allowedKeys.forEach((key) => (filtered[key] = item[key]));
      return filtered;
    });

    this.exportData = {
      [this.controll.toLowerCase()]: cleanData,
    };
  }

  countSelected(): number {
    return Object.values(this.selectedOptions).filter((v) => v).length;
  }

  getSelectedExportRows(): any[] {
    return Object.values(this.selectedOptions || {}).filter((row) => !!row);
  }

  async selectAllFilteredRowsForTaxExport(): Promise<void> {
    const totalRecords = this.response?.total || 0;
    if (totalRecords <= 0 || this.selectingAllFilteredRows) return;

    this.selectingAllFilteredRows = true;
    try {
      this.selectedOptions = {};
      this.exportData = {};
      this.exportKeyMap = {};
      this.masterPrimaryKeys = [];
      this.exportCount = 0;

      const headers = new HttpHeaders({
        Authorization: `Bearer ${localStorage.getItem(`token`)}`,
        'Custom-Header': 'CustomValue',
      });
      const chunkSize = Math.max(200, Math.min(1000, totalRecords));
      const totalPages = Math.ceil(totalRecords / chunkSize);
      const primaryKey = this.girdData.query.formId.primaryKey[0];

      for (let page = 1; page <= totalPages; page++) {
        const params = this.buildSummaryQueryParams(page, chunkSize);
        const response = await firstValueFrom(
          this.http.get<ListApiResponse>(`${environment.apiUrl}/api/Dynamic/filter`, {
            params,
            headers,
          }),
        );

        (response?.data || []).forEach((row: any) => {
          const key = row?.[primaryKey];
          if (key) {
            this.selectedOptions[key] = row;
          }
        });
      }

      this.updateExportData();
      this.persistSelectionState();
    } catch (error) {
      console.error('Không thể chọn tất cả dữ liệu theo bộ lọc:', error);
      alert('Không thể chọn tất cả dữ liệu theo bộ lọc.');
    } finally {
      this.selectingAllFilteredRows = false;
    }
  }

  selectedRefresh(): void {
    this.selectedOptions = {};
    this.exportData = {};
    this.exportCount = 0;

    // Xóa localStorage
    localStorage.removeItem(`selection_${this.girdData.id}`);
    localStorage.removeItem(`param_${this.girdData.id}`);
    localStorage.removeItem(`exportData_${this.girdData.id}`);
    localStorage.removeItem(`selection_${this.girdData.id}`);

    // Nếu muốn reset về export đơn giản (list thô)
    this.updateExportData();
    console.log(`Đã reset exportData:`, this.exportData);
  }
  getButtonClasses(color: string): string {
    switch (color) {
      case 'orange':
        return 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50';
      case 'green':
        return 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50';
      case 'red':
        return 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50';
      case 'white':
        return 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
      default:
        return 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
    }
  }
  async handleMultiDeleted(): Promise<void> {
    const selectedRows = Object.values(this.selectedOptions || {}).filter(
      (row) => !!row,
    ) as Record<string, any>[];

    if (!selectedRows.length) {
      alert('Không có dữ liệu để xóa');
      return;
    }

    const isConfirmed = confirm(
      `Bạn có chắc chắn muốn xóa ${selectedRows.length} phiếu đã chọn không?`,
    );
    if (!isConfirmed) return;

    let successCount = 0;
    let failedCount = 0;
    const errorMessages: string[] = [];

    for (const row of selectedRows) {
      try {
        const payload = {
          ...this.girdData.query.formId,
          action: 'delete',
          language: this.currentLanguage,
          value: this.girdData.query.formId.primaryKey.map((pk) => row?.[pk]),
          VCDate:
            this.girdData.query.formId.type === 'voucher'
              ? row?.['voucherDate'] || ''
              : '',
        };

        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/api/dynamic/delete`, payload),
        );
        successCount++;
      } catch (err: any) {
        failedCount++;
        const msg =
          err?.error?.message ||
          (Array.isArray(err?.error?.errors)
            ? err.error.errors.map((e: any) => e?.message || e).join(', ')
            : '') ||
          'Lỗi không xác định';
        errorMessages.push(msg);
      }
    }

    if (failedCount === 0) {
      alert(`Đã xóa thành công ${successCount}/${selectedRows.length} phiếu.`);
    } else {
      const firstErrors = errorMessages.slice(0, 3).join('\n');
      alert(
        `Đã xóa ${successCount}/${selectedRows.length} phiếu. Thất bại ${failedCount} phiếu.\n${firstErrors}`,
      );
    }

    this.selectedRefresh();
    this.loadData();
  }

  getFieldWidth(fieldOrKey: string | Pick<Field, 'key' | 'type' | 'width'> | GirdHeader): string {
    const key = typeof fieldOrKey === 'string' ? fieldOrKey : fieldOrKey.key;

    if (key === '__selection') {
      return `${this.selectionColumnWidth}px`;
    }

    if (this.columnWidths[key]) {
      return `${this.columnWidths[key]}px`;
    }

    if (typeof fieldOrKey !== 'string' && fieldOrKey.width) {
      return fieldOrKey.width;
    }

    if (this.isOrderColumnKey(key)) {
      return '70px';
    }

    const header = typeof fieldOrKey === 'string' ? this.getHeaderByKey(key) : fieldOrKey;
    if (header?.width) {
      return header.width;
    }

    return `${this.getDefaultColumnWidth(key, header?.type)}px`;
  }

  getGridTableClasses(): string {
    const baseClasses = 'min-w-full border-collapse hidden md:table break-words text-[11px]';
    return this.shouldStretchGridLayout()
      ? `${baseClasses} w-full table-auto`
      : `${baseClasses} w-max table-fixed`;
  }

  getHeaderCellStyle(key: string, isSelection: boolean = false): Record<string, string | null> {
    if (isSelection) {
      return { width: this.getFieldWidth('__selection') };
    }

    if (this.shouldStretchGridLayout()) {
      return { minWidth: this.getFieldWidth(key) };
    }

    return { width: this.getFieldWidth(key) };
  }

  onResizeColumn(event: MouseEvent, header: any) {
    const startX = event.pageX;
    const startWidth = event.target
      ? (event.target as HTMLElement).parentElement!.offsetWidth
      : 0;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const currentWidth = startWidth + (moveEvent.pageX - startX);
      if (currentWidth > 50) {
        this.updateColumnWidth(header.key, currentWidth);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  onResizeRow(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();

    const startY = event.pageY;
    const startHeight = this.rowHeights[index] || 38;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.pageY - startY;
      const newHeight = startHeight + deltaY;

      this.rowHeights[index] = newHeight > 30 ? newHeight : 30;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  updateColumnWidth(key: string, width: number) {
    this.columnWidths[key] = width;
  }

  private getDefaultColumnWidth(key: string, type?: string): number {
    const normalizedKey = (key || '').replace(/[_\s]/g, '').toLowerCase();

    if (this.isOrderColumnKey(key)) {
      return 70;
    }

    if (this.isWideCodeColumn(key)) {
      return 190;
    }

    if (
      normalizedKey.includes('customer') ||
      normalizedKey.includes('supplier') ||
      normalizedKey.includes('contact') ||
      normalizedKey.includes('address') ||
      normalizedKey.includes('name')
    ) {
      return 260;
    }

    if (
      normalizedKey.includes('status') ||
      normalizedKey.includes('state')
    ) {
      return 210;
    }

    if (
      normalizedKey.includes('amount') ||
      normalizedKey.includes('total') ||
      normalizedKey.includes('payment') ||
      normalizedKey.includes('price')
    ) {
      return 180;
    }

    switch ((type || '').toLowerCase()) {
      case 'lookup':
        return 220;
      case 'text':
        return 190;
      case 'select':
        return 170;
      case 'date':
        return 145;
      case 'number':
        return 150;
      default:
        return 170;
    }
  }

  private isWideCodeColumn(key: string): boolean {
    const normalizedKey = (key || '').replace(/[_\s]/g, '').toLowerCase();
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

    return /^(customer|item|supplier|employee|job|vendor).*(code|id)$/.test(
      normalizedKey,
    );
  }

  private isOrderColumnKey(key: string): boolean {
    const normalizedKey = (key || '').replace(/[_\s]/g, '').toLowerCase();
    return (
      normalizedKey === 'stt' ||
      normalizedKey === 'linenbr' ||
      normalizedKey === 'line' ||
      normalizedKey === 'rownum' ||
      normalizedKey === 'rownumber'
    );
  }

  private shouldStretchGridLayout(): boolean {
    const visibleHeaderCount = this.getVisibleHeaderCount();
    if (visibleHeaderCount <= 0) {
      return false;
    }

    const contentWidth = this.getEstimatedGridContentWidth();
    const viewportWidth = this.getMasterViewportWidth();
    if (viewportWidth <= 0) {
      return visibleHeaderCount <= 6;
    }

    return contentWidth <= viewportWidth;
  }

  private getVisibleHeaderCount(): number {
    return (this.girdData?.headers || []).filter((header) => !header.hidden).length;
  }

  private getEstimatedGridContentWidth(): number {
    const selectionWidth = this.selectionColumnWidth;
    const headers = (this.girdData?.headers || []).filter((header) => !header.hidden);

    return headers.reduce((sum, header) => {
      const key = header.key;
      if (this.columnWidths[key]) {
        return sum + this.columnWidths[key];
      }

      if (header.width) {
        const parsed = Number.parseFloat(`${header.width}`);
        if (!Number.isNaN(parsed) && parsed > 0) {
          return sum + parsed;
        }
      }

      return sum + this.getDefaultColumnWidth(key, header.type);
    }, selectionWidth);
  }

  private getMasterViewportWidth(): number {
    const masterScrollZone = document.querySelector('.master-scroll-zone') as HTMLElement | null;
    if (masterScrollZone?.clientWidth) {
      return Math.max(masterScrollZone.clientWidth - 16, 0);
    }

    return typeof window !== 'undefined' ? Math.max(window.innerWidth - 120, 0) : 0;
  }

  toggleRow(data: Record<string, string>, forceOpen: boolean = false) {
    if (this.quickEditDetailMode) {
      this.cancelQuickEditDetail(false);
    }

    this.setValue(data);
    this.girdData.mode = 'view';
    this.girdData.query.formId.language = this.currentLanguage;

    const primaryKey = this.girdData.query.formId.primaryKey[0];
    const rowId = data[primaryKey];

    this.expandedRowId = forceOpen ? rowId : this.expandedRowId === rowId ? null : rowId;
    if (this.expandedRowId) {
      this.http
        .post<ApiResponse>(
          `${environment.apiUrl}/api/FormConfig/GetFormData`,
          this.girdData.query.formId,
        )
        .subscribe(async (meta) => {
          this.metadata = meta.Data as PageMetadata;
          this.loadHeaderLookupData();
          await this.initializeFormData();
          this.loadInitialDetailData();
          this.activeDetailRowIndex = 0;
        });
    }
  }

  private loadHeaderLookupData(): void {
    if (!this.metadata?.tabs?.length) return;
    this.loadHeaderLookupDataFromMetadata(this.metadata);
  }

  private loadHeaderLookupDataFromMetadata(metadata: PageMetadata): void {
    if (!metadata?.tabs?.length) return;

    const headerLookupKeys = this.getHeaderLookupKeys();

    if (headerLookupKeys.length === 0) return;

    const headerLookupKeySet = new Set(headerLookupKeys);

    metadata.tabs.forEach((tab) => {
      const formFields = tab.form?.fields ?? [];
      formFields.forEach((field) => {
        if (headerLookupKeySet.has(field.key) && field.type === 'lookup') {
          this.loadLookupField(field.key, field.default);
        }
      });
    });
    this.refreshGridSummary();
  }

  private getHeaderLookupKeys(): string[] {
    return this.girdData.headers
      .filter((header) => header.type === 'lookup')
      .map((header) => header.key);
  }

  private hasAllHeaderLookupsLoaded(): boolean {
    const keys = this.getHeaderLookupKeys();
    if (keys.length === 0) return true;

    return keys.every((key) => !!this.lookupMap[key]);
  }

  private ensureHeaderLookupDataLoaded(): void {
    if (this.hasAllHeaderLookupsLoaded() || this.isHeaderLookupLoading) return;
    // GetFormData yêu cầu value[] không rỗng; chỉ preload lookup khi có dòng mẫu hợp lệ.
    this.preloadHeaderLookupFromFirstRow();
  }

  private preloadHeaderLookupFromFirstRow(): void {
    if (!this.response?.data?.length) return;
    if (this.hasAllHeaderLookupsLoaded()) return;

    const sampleRow = this.response.data[0];
    if (!sampleRow) return;

    const queryFormId = this.girdData.query.formId;
    const value = (queryFormId.primaryKey || []).map((k) => sampleRow?.[k]);

    if (!value.length || value.some((v) => v === undefined || v === null || v === '')) {
      return;
    }

    this.isHeaderLookupLoading = true;

    const formId = {
      ...queryFormId,
      action: 'loading',
      value,
      VCDate: sampleRow?.['voucherDate'] ?? '',
      language: this.currentLanguage,
    };

    this.http
      .post<ApiResponse>(`${environment.apiUrl}/api/FormConfig/GetFormData`, formId)
      .subscribe({
        next: (meta) => {
          const metadata = meta.Data as PageMetadata;
          this.loadHeaderLookupDataFromMetadata(metadata);
        },
        error: (err) => {
          console.error('Error preloading header lookup from first row:', err);
        },
        complete: () => {
          this.isHeaderLookupLoading = false;
        },
      });
  }

  private loadLookupField(fieldKey: string, lookupDefault: any): void {
    if (!fieldKey || !lookupDefault || this.lookupMap[fieldKey]) {
      return;
    }

    if (typeof lookupDefault?.controller === 'string' && lookupDefault.controller.trim()) {
      this.lookupControllerMap[fieldKey] = lookupDefault.controller.trim();
    }

    this.http
      .post<any>(`${environment.apiUrl}/api/Lookup`, lookupDefault)
      .subscribe((res) => {
        this.lookupMap[fieldKey] = res.data as LookupApiResponse;
      });
  }

  private async initializeFormData(): Promise<void> {
    if (!this.metadata) return;

    // Process each tab
    for (const [index, tab] of this.metadata.tabs.entries()) {
      // Initialize detail data structures
      if (tab.detail && Array.isArray(tab.detail)) {
        const existingTabFilters = this.columnFiltersData[index] || {};
        const existingTabSort = this.detailSortData[index] || {};
        this.detailRowsData[index] = {};
        this.filteredDetailRowsData[index] = {};
        this.columnFiltersData[index] = this.columnFiltersData[index] || {};
        this.detailSortData[index] = this.detailSortData[index] || {};

        tab.detail.forEach((_, detailIndex) => {
          this.detailRowsData[index][detailIndex] = [];
          this.filteredDetailRowsData[index][detailIndex] = [];
          this.columnFiltersData[index][detailIndex] =
            existingTabFilters[detailIndex] || {};
          this.detailSortData[index][detailIndex] =
            existingTabSort[detailIndex] || { key: '', direction: '' };
        });
      }
    }
  }

  loadInitialDetailData(): void {
    if (!this.metadata) return;

    this.metadata.tabs.forEach((tab, tabIndex) => {
      if (tab.detail && Array.isArray(tab.detail)) {
        tab.detail.forEach((detailSection, detailIndex) => {
          let dateKeys: { [key: string]: boolean } = {};
          detailSection.fields.forEach((field) => {
            if (field.type == 'date') {
              dateKeys[field.key] = true;
            }
            if (field.type == 'lookup') {
              this.loadLookupField(field.key, field.default);
            }
          });
          if (
            detailSection.initialData &&
            Array.isArray(detailSection.initialData)
          ) {
            for (let i = 0; i < detailSection.initialData.length; i++) {
              for (const key in detailSection.initialData[i]) {
                if (dateKeys[key]) {
                  detailSection.initialData[i][key] =
                    detailSection.initialData[i][key]?.substring(0, 10) ?? '';
                }
              }
            }

            this.detailRowsData[tabIndex][detailIndex] = [
              ...detailSection.initialData,
            ];
          } else {
            this.detailRowsData[tabIndex][detailIndex] = [];
          }
        });
      }
    });

    this.applyFilters();
  }

  get currentDetailRows(): any[] {
    return (
      this.detailRowsData[this.selectedTab]?.[this.selectedDetailIndex] || []
    );
  }

  get currentColumnFilters(): { [key: string]: string } {
    return (
      this.columnFiltersData[this.selectedTab]?.[this.selectedDetailIndex] || {}
    );
  }

  get currentDetailSections(): any[] {
    const currentTab = this.metadata?.tabs[this.selectedTab];
    return currentTab?.detail || [];
  }

  get currentDetailSection(): any {
    return this.currentDetailSections[this.selectedDetailIndex];
  }

  getAllDetailFields(): any[] {
    const fields = this.currentDetailSection?.fields || [];
    return fields
      .map((field: any, index: number) => ({ field, index }))
      .sort((a: { field: any; index: number }, b: { field: any; index: number }) => {
        const aQuick = a.field?.quickEditable === true ? 1 : 0;
        const bQuick = b.field?.quickEditable === true ? 1 : 0;
        if (aQuick !== bQuick) return bQuick - aQuick;
        return a.index - b.index;
      })
      .map((item: { field: any; index: number }) => item.field);
  }

  applyFilters(): void {
    const currentRows = this.currentDetailRows;
    if (!currentRows || currentRows.length === 0) {
      this.filteredDetailRowsData[this.selectedTab][this.selectedDetailIndex] =
        [];
      this.activeDetailRowIndex = 0;
      return;
    }

    const filters = this.currentColumnFilters;
    const validFieldKeys = new Set(
      (this.getAllDetailFields() || []).map((f) => f.key),
    );
    const activeFilters = Object.keys(filters).filter(
      (key) => validFieldKeys.has(key) && filters[key] && filters[key].trim(),
    );

    if (activeFilters.length === 0) {
      this.filteredDetailRowsData[this.selectedTab][this.selectedDetailIndex] =
        this.applyDetailSort([...currentRows]);
      this.syncActiveDetailRowIndex();
      return;
    }

    this.filteredDetailRowsData[this.selectedTab][this.selectedDetailIndex] =
      this.applyDetailSort(currentRows.filter((row) => {
        const matches = activeFilters.map((fieldKey) => {
          const filterValue = filters[fieldKey].toLowerCase();
          const rawRowValue = row[fieldKey];
          const rowValue = (rawRowValue || '').toString().toLowerCase();

          const field = this.getAllDetailFields()?.find(
            (f) => f.key === fieldKey,
          );

          if (field?.type === 'select') {
            return rowValue === filterValue;
          } else if (field?.type === 'lookup') {
            const displayValue = this.getLookupDisplayValue(
              fieldKey,
              rawRowValue,
            ).toLowerCase();
            return displayValue.includes(filterValue);
          } else if (field?.type === 'number') {
            return this.applyNumberFilter(rowValue, filterValue);
          } else if (field?.type === 'date') {
            return this.applyDateFilter(rowValue, filterValue);
          } else {
            // String/text fields - case insensitive contains
            const searchValue = filterValue.toLowerCase();

            return rowValue.includes(searchValue);
          }
        });

        return this.filterMode === 'all'
          ? matches.every((match) => match)
          : matches.some((match) => match);
      }));
    this.syncActiveDetailRowIndex();
  }

  onDetailSortClick(field: any): void {
    if (!field?.key || field.type === 'hidden') {
      return;
    }

    if (!this.detailSortData[this.selectedTab]) {
      this.detailSortData[this.selectedTab] = {};
    }
    const currentSort =
      this.detailSortData[this.selectedTab][this.selectedDetailIndex] ||
      { key: '', direction: '' as 'asc' | 'desc' | '' };
    let nextDirection: 'asc' | 'desc' | '' = 'asc';

    if (currentSort.key === field.key) {
      nextDirection =
        currentSort.direction === 'asc'
          ? 'desc'
          : currentSort.direction === 'desc'
            ? ''
            : 'asc';
    }

    this.detailSortData[this.selectedTab][this.selectedDetailIndex] = {
      key: nextDirection ? field.key : '',
      direction: nextDirection,
    };
    this.applyFilters();
  }

  getDetailSortDirection(fieldKey: string): 'asc' | 'desc' | '' {
    const sort = this.detailSortData[this.selectedTab]?.[this.selectedDetailIndex];
    return sort?.key === fieldKey ? sort.direction : '';
  }

  private applyDetailSort(rows: any[]): any[] {
    const sort = this.detailSortData[this.selectedTab]?.[this.selectedDetailIndex];
    if (!sort?.key || !sort.direction) {
      return rows;
    }

    const field = this.getAllDetailFields()?.find((f) => f.key === sort.key);
    const direction = sort.direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const aValue = this.getDetailSortValue(a, sort.key, field);
      const bValue = this.getDetailSortValue(b, sort.key, field);

      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined || aValue === '') return 1;
      if (bValue === null || bValue === undefined || bValue === '') return -1;

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction;
      }

      return `${aValue}`.localeCompare(`${bValue}`, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) * direction;
    });
  }

  private getDetailSortValue(row: any, fieldKey: string, field: any): any {
    const rawValue = row?.[fieldKey];
    if (field?.type === 'lookup') {
      return this.getLookupDisplayValue(fieldKey, rawValue);
    }
    if (field?.type === 'number') {
      const numericValue = Number(`${rawValue ?? ''}`.replace(/,/g, ''));
      return Number.isNaN(numericValue) ? rawValue : numericValue;
    }
    if (field?.type === 'date' || field?.type === 'datetime') {
      const time = new Date(rawValue).getTime();
      return Number.isNaN(time) ? rawValue : time;
    }
    return rawValue;
  }

  private getLookupDisplayValue(fieldKey: string, rawValue: any): string {
    const lookup = this.lookupMap[fieldKey];
    if (!lookup || rawValue === null || rawValue === undefined) {
      return (rawValue || '').toString();
    }

    const primaryField = lookup.fields?.[0]?.field;
    if (!primaryField) {
      return (rawValue || '').toString();
    }

    const found = lookup.datas?.find((item) => item[primaryField] == rawValue);
    if (!found) {
      return (rawValue || '').toString();
    }

    return lookup.fields
      .map((f) => found[f.field])
      .filter((v) => v !== null && v !== undefined && `${v}`.trim() !== '')
      .join(' - ');
  }

  getGridCellDisplayValue(data: any, header: GirdHeader): string {
    const derivedStatus = this.getDerivedDeliveryStatusLabel(data, header.key);
    if (derivedStatus !== null) {
      return derivedStatus;
    }

    const rawValue = data?.[header.key];
    if (header.type === 'lookup') {
      return this.getLookupDisplayValue(header.key, rawValue);
    }
    if (header.type === 'select') {
      const value = (rawValue ?? '').toString();
      const option = (header as any)?.options?.find((opt: any) => `${opt?.value ?? ''}` === value);
      return option?.label ?? value;
    }
    if (header.type === 'number') {
      if (rawValue === null || rawValue === undefined || rawValue === '') return '';
      const numericValue = this.parseNumberInput(rawValue);
      if (this.isCurrencyField(header.key, header) || header.format === 'currency') {
        return this.formatCurrency(numericValue);
      }
      return this.formatNumber(numericValue);
    }

    return (rawValue ?? '').toString();
  }

  private getDerivedDeliveryStatusLabel(row: any, key: string): string | null {
    if (!row || !key) return null;

    if (key === 'paymentStatus') {
      const raw = (row.paymentStatus ?? '').toString().toUpperCase();
      if (raw) return this.mapPaymentStatus(raw);

      const total = this.parseNumberInput(row.totalPayment ?? 0);
      const paid = this.parseNumberInput(row.paidAmount ?? 0);
      const debt = row.debtAmount !== null && row.debtAmount !== undefined && row.debtAmount !== ''
        ? this.parseNumberInput(row.debtAmount)
        : Math.max(total - paid, 0);
      const overdueDays = this.parseNumberInput(row.overdueDays ?? 0);

      if (debt <= 0 && total > 0) return 'Đã thu đủ';
      if (paid > 0 && debt > 0) return 'Thu một phần';
      if (overdueDays > 0 && debt > 0) return 'Quá hạn';
      if (total > 0) return 'Chưa thu';
      return '';
    }

    if (key === 'deliveryStatus') {
      const raw = (row.deliveryStatus ?? '').toString().toUpperCase();
      if (raw) return this.mapDeliveryStatus(raw);
      return row.status?.toString() === '1' ? 'Đã giao đủ' : 'Chưa giao';
    }

    if (key === 'receiveStatus') {
      const raw = (row.receiveStatus ?? '').toString().toUpperCase();
      if (raw) return this.mapReceiveStatus(raw);
      return '';
    }

    if (key === 'signReceiptStatus') {
      const raw = (row.signReceiptStatus ?? '').toString().toUpperCase();
      if (raw) return this.mapSignReceiptStatus(raw);

      const signedFiles = this.parseNumberInput(row.signedFileCount ?? 0);
      return signedFiles > 0 ? 'Đã nhận ký' : 'Chưa nhận ký';
    }

    if (key === 'alertLevel') {
      const raw = (row.alertLevel ?? '').toString().toUpperCase();
      if (raw) return this.mapAlertLevel(raw);

      const overdueDays = this.parseNumberInput(row.overdueDays ?? 0);
      if (overdueDays >= 7) return 'Nguy cơ cao';
      if (overdueDays > 0) return 'Cảnh báo';
      return 'Bình thường';
    }

    return null;
  }

  private mapPaymentStatus(value: string): string {
    switch (value) {
      case 'PAID': return 'Đã thu đủ';
      case 'PARTIAL': return 'Thu một phần';
      case 'OVERDUE': return 'Quá hạn';
      case 'UNPAID': return 'Chưa thu';
      default: return value;
    }
  }

  private mapDeliveryStatus(value: string): string {
    switch (value) {
      case 'DELIVERED': return 'Đã giao đủ';
      case 'PARTIAL': return 'Đã giao một phần';
      case 'NOT_DELIVERED': return 'Chưa giao';
      default: return value;
    }
  }

  private mapReceiveStatus(value: string): string {
    switch (value) {
      case 'RECEIVED': return 'Đã nhận hàng';
      case 'PARTIAL': return 'Đã nhận một phần';
      case 'NOT_RECEIVED': return 'Chưa nhận hàng';
      default: return value;
    }
  }

  private mapSignReceiptStatus(value: string): string {
    switch (value) {
      case 'RECEIVED': return 'Đã nhận ký';
      case 'MISSING': return 'Thiếu chứng từ';
      case 'PENDING': return 'Chưa nhận ký';
      default: return value;
    }
  }

  private mapAlertLevel(value: string): string {
    switch (value) {
      case 'CRITICAL': return 'Nguy cơ cao';
      case 'WARNING': return 'Cảnh báo';
      case 'NORMAL': return 'Bình thường';
      default: return value;
    }
  }

  private getSummaryConfig():
    | { field: string; label?: string; format?: 'number' | 'currency' }
    | null {
    const headers = this.girdData?.headers || [];
    const configured = this.girdData?.ui?.summary;
    if (configured?.field) return configured;

    const configuredByHeader = headers.find(
      (h) => h.type === 'number' && h.sum === true,
    );
    if (configuredByHeader) {
      return {
        field: configuredByHeader.key,
        label: 'Tổng cộng',
        format:
          configuredByHeader.currency || configuredByHeader.format === 'currency'
            ? 'currency'
            : 'number',
      };
    }

    // Backward compatibility: keep old behavior for pages already using total_amount
    const hasTotalAmount = headers.some((h) => h.key === 'total_amount');
    return hasTotalAmount
      ? { field: 'total_amount', label: 'Tổng tất cả trang', format: 'number' }
      : null;
  }

  hasGridSummary(): boolean {
    const summary = this.getSummaryConfig();
    if (!summary) return false;
    return (this.girdData?.headers || []).some((h) => h.key === summary.field);
  }

  getGridSummaryLabel(): string {
    return this.getSummaryConfig()?.label || 'Tổng tất cả trang';
  }

  getVisibleSummaryValue(): number {
    return this.gridSummaryValue;
  }

  getFormattedSummaryValue(): string {
    const summary = this.getSummaryConfig();
    const value = this.getVisibleSummaryValue();
    if (
      summary?.format === 'currency' ||
      this.isCurrencyField(summary?.field || '', this.getHeaderByKey(summary?.field || ''))
    ) {
      return this.formatCurrency(value);
    }
    return this.formatNumber(value);
  }

  private getHeaderByKey(key: string): GirdHeader | undefined {
    return (this.girdData?.headers || []).find((h) => h.key === key);
  }

  private hasClientColumnFilter(): boolean {
    return Object.values(this.filterColumns || {}).some(
      (value) => (value ?? '').toString().trim().length > 0,
    );
  }

  isHeaderFilterActive(): boolean {
    return this.hasClientColumnFilter();
  }

  getPaginationTotalItems(): number {
    return this.response?.total || 0;
  }

  getPaginationCurrentPage(): number {
    return this.response?.page || 1;
  }

  shouldShowPagination(): boolean {
    return !!this.response && this.getPaginationTotalItems() > 0;
  }

  private matchesHeaderFilters(row: any): boolean {
    return (this.girdData?.headers || []).every((header) => {
      if (header.hidden) return true;
      const filterValue = (this.filterColumns?.[header.key] || '').toString().trim();
      if (!filterValue) return true;
      const cellValue = row?.[header.key];
      if (header.type === 'date') {
        return (cellValue || '').toString().includes(filterValue);
      }
      if (header.type === 'lookup') {
        const displayValue = this.getLookupDisplayValue(header.key, cellValue);
        return displayValue.toLowerCase().includes(filterValue.toLowerCase());
      }
      return (cellValue || '')
        .toString()
        .toLowerCase()
        .includes(filterValue.toLowerCase());
    });
  }

  private refreshGridSummary(): void {
    const summary = this.getSummaryConfig();
    if (!summary) {
      this.gridSummaryValue = 0;
      this.gridSummaryLoading = false;
      return;
    }

    const currentRows = this.filteredData || [];
    const currentPageSum = currentRows.reduce((sum, row) => {
      return sum + this.parseNumberInput(row?.[summary.field]);
    }, 0);
    this.gridSummaryValue = currentPageSum;

    const totalRecords = this.response?.total || 0;
    if (!totalRecords || totalRecords <= currentRows.length) {
      this.gridSummaryLoading = false;
      return;
    }

    const cacheKey = this.buildGridSummaryCacheKey(summary.field);
    const cached = this.gridSummaryCache.get(cacheKey);
    if (cached !== undefined) {
      this.gridSummaryValue = cached;
      this.gridSummaryLoading = false;
      return;
    }

    const requestId = ++this.gridSummaryRequestId;
    this.gridSummaryLoading = true;
    this.loadSummaryAcrossPages(summary.field)
      .then((totalSum) => {
        if (requestId !== this.gridSummaryRequestId) return;
        this.gridSummaryValue = totalSum;
        this.gridSummaryCache.set(cacheKey, totalSum);
      })
      .catch((error) => {
        console.error('Error loading full grid summary:', error);
      })
      .finally(() => {
        if (requestId === this.gridSummaryRequestId) {
          this.gridSummaryLoading = false;
        }
      });
  }

  private buildGridSummaryCacheKey(field: string): string {
    return JSON.stringify({
      controller: this.girdData?.query?.formId?.controller,
      formId: this.girdData?.query?.formId?.formId,
      idVC: this.girdData?.query?.formId?.idVC,
      unit: this.girdData?.query?.formId?.unit,
      language: this.currentLanguage,
      field,
      sort: this.girdData?.sort || '',
      filter: this.girdData?.query?.filter || [],
      columnFilter: this.filterColumns || {},
    });
  }

  private buildSummaryQueryParams(page: number, pageSize: number): HttpParams {
    const formId = {
      ...(this.girdData?.query?.formId || {}),
      action: 'loading',
      language: this.currentLanguage,
    };
    return new HttpParams()
      .set('formId', JSON.stringify(formId))
      .set('filter', JSON.stringify(this.getCombinedServerFilters()))
      .set('page', page.toString())
      .set('pageSize', pageSize.toString())
      .set('sort', this.girdData?.sort || '');
  }

  private async loadSummaryAcrossPages(field: string): Promise<number> {
    const totalRecords = this.response?.total || 0;
    if (totalRecords <= 0) return 0;

    const headers = new HttpHeaders({
      Authorization: `Bearer ${localStorage.getItem(`token`)}`,
      'Custom-Header': 'CustomValue',
    });
    const chunkSize = Math.max(200, Math.min(1000, this.girdData?.query?.pageSize || 50));
    const totalPages = Math.ceil(totalRecords / chunkSize);

    let sum = 0;
    for (let page = 1; page <= totalPages; page++) {
      const params = this.buildSummaryQueryParams(page, chunkSize);
      const response = await firstValueFrom(
        this.http.get<ListApiResponse>(`${environment.apiUrl}/api/Dynamic/filter`, {
          params,
          headers,
        }),
      );
      const rows = response?.data || [];
      for (const row of rows) {
        sum += this.parseNumberInput(row?.[field]);
      }
      if (!rows.length) break;
    }
    return sum;
  }

  private getStoredAdvancedFilters(): FilterCondition[] {
    const filterStr = localStorage.getItem(`filter_${this.girdData.id}`);
    this.initFilter = this.normalizeAdvancedFilterConditions(
      filterStr ? (JSON.parse(filterStr) as FilterCondition[]) : [],
    );
    return this.initFilter;
  }

  private getHeaderServerFilters(): FilterCondition[] {
    return Object.entries(this.filterColumns || {})
      .map(([field, rawValue], index) => {
        const value = (rawValue ?? '').toString().trim();
        if (!value) return null;

        const header = this.getHeaderByKey(field);
        // Các giá trị select là mã được lưu trong DB (thường là số/status),
        // nên phải so sánh chính xác thay vì LIKE như các trường text.
        const operator = header?.type === 'date' || header?.type === 'select' ? '=' : 'like';

        return {
          id: `header_${field}_${index}`,
          field,
          operator,
          value,
          columnType: header?.type,
          lookupController:
            header?.type === 'lookup'
              ? this.resolveLookupControllerForFilter(field, header)
              : undefined,
        } as FilterCondition;
      })
      .filter((item): item is FilterCondition => item !== null);
  }

  private resolveLookupControllerForFilter(field: string, header?: GirdHeader): string | undefined {
    const explicitController = header?.lookupController?.trim();
    if (explicitController) return explicitController;

    const runtimeController = this.lookupControllerMap[field]?.trim();
    if (runtimeController) return runtimeController;

    const normalized = (field || '').trim().toLowerCase();
    if (!normalized) return undefined;

    const stripped = normalized
      .replace(/^(ma_|id_)/, '')
      .replace(/(_id|id)$/i, '')
      .replace(/_code$/i, '')
      .replace(/code$/i, '');

    return stripped || undefined;
  }

  private getCombinedServerFilters(): FilterCondition[] {
    const advancedFilters = this.getStoredAdvancedFilters();
    const headerFilters = this.getHeaderServerFilters();
    return this.sanitizeFilterConditions([...advancedFilters, ...headerFilters]);
  }

  private normalizeAdvancedFilterConditions(conditions: FilterCondition[]): FilterCondition[] {
    return (conditions || []).map((condition) => {
      const header = this.getHeaderByKey(condition.field);
      if (!header) return condition;

      const normalized: FilterCondition = {
        ...condition,
        columnType: header.type,
      };

      if (header.type === 'lookup') {
        normalized.lookupController = this.resolveLookupControllerForFilter(
          header.key,
          header,
        );
      } else {
        normalized.lookupController = undefined;
      }

      return normalized;
    });
  }

  private sanitizeFilterConditions(conditions: FilterCondition[]): FilterCondition[] {
    const validHeaders = new Map((this.girdData?.headers || []).map((h) => [h.key, h]));

    return (conditions || [])
      .map((condition) => {
        const field = (condition?.field || '').trim();
        const header = validHeaders.get(field);
        if (!field || !header) return null;

        const value = condition?.value;
        const normalizedValue =
          typeof value === 'string' ? value.trim() : value;

        const normalized: FilterCondition = {
          ...condition,
          field,
          value: normalizedValue,
          columnType: header.type,
        };

        if (header.type === 'lookup') {
          normalized.lookupController = this.resolveLookupControllerForFilter(field, header);
        } else {
          normalized.lookupController = undefined;
        }

        if (
          normalizedValue === '' ||
          normalizedValue === null ||
          normalizedValue === undefined
        ) {
          const op = (normalized.operator || '').toLowerCase();
          if (op !== 'is null' && op !== 'is not null') {
            return null;
          }
        }

        return normalized;
      })
      .filter((item): item is FilterCondition => item !== null);
  }


  private applyNumberFilter(rawValue: any, filterValue: string): boolean {
    const numericValue = this.parseNumberInput(rawValue);

    // Handle comparison operators
    if (filterValue.startsWith('>=')) {
      const num = parseFloat(filterValue.substring(2).trim());
      return !isNaN(num) && numericValue >= num;
    } else if (filterValue.startsWith('<=')) {
      const num = parseFloat(filterValue.substring(2).trim());
      return !isNaN(num) && numericValue <= num;
    } else if (filterValue.startsWith('>')) {
      const num = parseFloat(filterValue.substring(1).trim());
      return !isNaN(num) && numericValue > num;
    } else if (filterValue.startsWith('<')) {
      const num = parseFloat(filterValue.substring(1).trim());
      return !isNaN(num) && numericValue < num;
    } else if (filterValue.startsWith('=')) {
      const num = parseFloat(filterValue.substring(1).trim());
      return !isNaN(num) && numericValue === num;
    } else if (filterValue.startsWith('!=') || filterValue.startsWith('<>')) {
      const num = parseFloat(filterValue.substring(2).trim());
      return !isNaN(num) && numericValue !== num;
    } else if (filterValue.includes('..')) {
      // Range with .. separator (e.g., "10..20")
      const [min, max] = filterValue
        .split('..')
        .map((v) => parseFloat(v.trim()));
      return (
        !isNaN(min) && !isNaN(max) && numericValue >= min && numericValue <= max
      );
    } else if (filterValue.includes('-') && !filterValue.startsWith('-')) {
      // Range with - separator (e.g., "10-20"), but not negative numbers
      const parts = filterValue.split('-');
      if (parts.length === 2) {
        const [min, max] = parts.map((v) => parseFloat(v.trim()));
        return (
          !isNaN(min) &&
          !isNaN(max) &&
          numericValue >= min &&
          numericValue <= max
        );
      }
    }

    // Default: exact match or contains for partial numbers
    const searchNum = parseFloat(filterValue);
    if (!isNaN(searchNum)) {
      return numericValue === searchNum;
    } else {
      // Allow partial matching for numbers (e.g., searching "12" finds "120", "1234", etc.)
      return numericValue.toString().includes(filterValue);
    }
  }

  private applyDateFilter(rawValue: any, filterValue: string): boolean {
    if (!rawValue || !filterValue) return false;

    const dateValue = new Date(rawValue);
    const filterDate = new Date(filterValue);

    // If filter value is not a valid date, try partial matching
    if (isNaN(filterDate.getTime())) {
      const dateString = rawValue.toString();
      return dateString.includes(filterValue);
    }

    // Normalize dates to compare only date parts (ignore time)
    const normalizeDate = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const normalizedDateValue = normalizeDate(dateValue);
    const normalizedFilterDate = normalizeDate(filterDate);

    return normalizedDateValue.getTime() === normalizedFilterDate.getTime();
  }

  parseNumberInput(value: any): number {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const cleanValue = value
        .replace(/[₫$€£¥]/g, '') // Remove currency symbols
        .replace(/\s/g, '') // Remove spaces
        .replace(/\./g, '') // Remove thousand separators (dots)
        .replace(/,/g, '.'); // Convert comma to decimal if present

      const numericValue = parseFloat(cleanValue);
      return isNaN(numericValue) ? 0 : numericValue;
    }

    return 0;
  }

  get currentFilteredDetailRows(): any[] {
    return (
      this.filteredDetailRowsData[this.selectedTab]?.[
      this.selectedDetailIndex
      ] || []
    );
  }

  getDetailPanelHeight(): number {
    const rows = this.currentFilteredDetailRows?.length ?? 0;
    const visibleRows = Math.min(Math.max(rows, 1), 10);
    const headerAndFilterHeight = 64;
    const rowHeight = 24;
    const bottomPadding = 6;
    return headerAndFilterHeight + visibleRows * rowHeight + bottomPadding;
  }

  getExpandedRowData(): Record<string, any> | null {
    if (!this.expandedRowId || !this.response?.data?.length) return null;
    const primaryKey = this.girdData.query.formId.primaryKey?.[0];
    if (!primaryKey) return null;
    return (
      this.response.data.find((row: any) => row?.[primaryKey] === this.expandedRowId) ||
      null
    );
  }

  getExpandedVoucherNumber(): string {
    const selectedRow = this.getExpandedRowData();
    if (!selectedRow) return '';
    return selectedRow['voucherNumber'] || '';
  }

  getRowPrimaryKeyValue(row: Record<string, any> | null | undefined): any {
    if (!row) return null;
    const primaryKey = this.girdData?.query?.formId?.primaryKey?.[0];
    if (!primaryKey) return null;
    return row[primaryKey];
  }

  private getRowByPrimaryKey(primaryKeyValue: any): Record<string, any> | null {
    if (primaryKeyValue === null || primaryKeyValue === undefined || !this.response?.data?.length) {
      return null;
    }
    const primaryKey = this.girdData?.query?.formId?.primaryKey?.[0];
    if (!primaryKey) return null;
    return (
      this.response.data.find((row: any) => row?.[primaryKey] === primaryKeyValue) ||
      null
    );
  }

  private patchMasterRowById(primaryKeyValue: any, patchValue: Record<string, any>): void {
    if (primaryKeyValue === null || primaryKeyValue === undefined || !patchValue) return;
    const row = this.getRowByPrimaryKey(primaryKeyValue);
    if (row) {
      Object.assign(row, JSON.parse(JSON.stringify(patchValue)));
    }
  }

  private getMasterFieldConfig(fieldKey: string): any | null {
    if (!this.metadata?.tabs?.length) return null;
    for (const tab of this.metadata.tabs) {
      const fields = tab?.form?.fields || [];
      const matched = fields.find((field: any) => field?.key === fieldKey);
      if (matched) return matched;
    }
    return null;
  }

  getMasterSelectOptions(header: any): Array<{ label: string; value: any }> {
    const field = this.getMasterFieldConfig(header?.key);
    return (field?.options || header?.options || []) as Array<{ label: string; value: any }>;
  }

  toDateInputValue(value: any): string {
    if (value === null || value === undefined) return '';
    const raw = `${value}`.trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.substring(0, 10);
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  trackByIndex(index: number, item: any): any {
    return item.line_nbr || index;
  }

  isCurrencyField(fieldKey: string, fieldObject?: any): boolean {
    if (!fieldKey) return false;

    if (fieldObject && fieldObject.currency) {
      return true;
    }
    return false;
  }

  formatCurrencyNumber(
    amount: number,
    fieldKey?: string,
    fieldObject?: any,
  ): string {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '';
    }

    // Get currency type directly from field object or default to 'VN'
    const currencyType = fieldObject?.currency || 'VN';

    // Get appropriate locale for the currency type
    const locale = this.getLocaleForCurrency(currencyType);
    const configuredPrecision = Number(fieldObject?.precision);
    const fractionDigits =
      Number.isFinite(configuredPrecision) && configuredPrecision >= 0
        ? configuredPrecision
        : 0;

    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  }
  getLocaleForCurrency(currencyType: string): string {
    const localeMap: { [key: string]: string } = {
      VN: 'vi-VN',
      USD: 'en-US',
      EUR: 'de-DE',
      GBP: 'en-GB',
      JPY: 'ja-JP',
      KRW: 'ko-KR',
      CNY: 'zh-CN',
      THB: 'th-TH',
      SGD: 'en-SG',
      MYR: 'ms-MY',
    };

    return localeMap[currencyType.toUpperCase()] || 'vi-VN';
  }

  formatFieldValue(row: any, field: any): string {
    const value = row[field.key];
    if (value === null || value === undefined || value === '') return '';

    switch (field.type) {
      case 'number':
        if (field.key === 'total' || field.key === 'price') {
          return this.formatCurrency(parseFloat(value));
        }
        return this.formatNumber(value);
      case 'date':
        return this.formatDate(value);
      default:
        return value.toString();
    }
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(amount);
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('vi-VN').format(value);
  }

  formatDate(date: string): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('vi-VN');
  }
  getOptionLabel(fieldKey: string, value: string): string {
    const field = this.getAllDetailFields().find((f) => f.key === fieldKey);
    if (!field || !field.options) return value;

    const option = field.options.find((opt: any) => opt.value === value);
    return option ? option.label : value;
  }
  clearAllFilters(): void {
    this.columnFiltersData[this.selectedTab][this.selectedDetailIndex] = {};
    this.applyFilters();
  }

  getFormattedFilterValue(fieldKey: string, field: any): string {
    const filterValue = this.currentColumnFilters[fieldKey];
    if (!filterValue) return '';

    // If it's a currency field and the filter value is a number, format it
    if (this.isCurrencyField(fieldKey, field)) {
      const numericValue = this.parseNumberInput(filterValue);
      if (!isNaN(numericValue) && numericValue !== 0) {
        // Check if the filter contains operators (>, <, =, etc.)
        if (/^[><=!]/.test(filterValue.trim())) {
          return filterValue; // Keep operators as-is
        }
        return this.formatCurrencyNumber(numericValue, fieldKey, field);
      }
    }

    return filterValue;
  }
  onCurrencyFilterBlur(fieldKey: string, event: any, field: any): void {
    const inputElement = event.target;
    const rawValue = inputElement.value;

    const numericValue = this.parseNumberInput(rawValue);
    if (!isNaN(numericValue) && numericValue !== 0) {
      inputElement.value = this.formatCurrencyNumber(
        numericValue,
        fieldKey,
        field,
      );
    }
  }
  clearFilter(fieldKey: string): void {
    delete this.columnFiltersData[this.selectedTab][this.selectedDetailIndex][
      fieldKey
    ];
    this.applyFilters();
  }

  onFilterChange(fieldKey: string, value: string): void {
    const filters =
      this.columnFiltersData[this.selectedTab][this.selectedDetailIndex];
    if (value && value.trim()) {
      filters[fieldKey] = value.trim();
    } else {
      delete filters[fieldKey];
    }
    this.applyFilters();
  }
  onDetailSectionChange(detailIndex: number): void {
    if (this.quickEditDetailMode) {
      this.cancelQuickEditDetail(false);
    }
    this.selectedDetailIndex = detailIndex;
    this.activeDetailRowIndex = 0;
    this.applyFilters();
  }

  onMasterRowClick(data: Record<string, string>): void {
    if (
      this.quickEditMasterMode &&
      this.quickEditMasterRowId !== this.getRowPrimaryKeyValue(data)
    ) {
      this.cancelQuickEditMaster(false);
    }
    this.activeMasterRow = data;
    if (this.isVoucherType() && !this.detailPanelHidden) {
      this.toggleRow(data);
    }
  }

  hasQuickEditableMasterFields(): boolean {
    const headers = this.girdData?.headers || [];
    return headers.some((header) => this.isQuickEditableMasterHeader(header));
  }

  isQuickEditableMasterHeader(header: any): boolean {
    if (!header || header.hidden) return false;
    if (header.quickEditable === true) return true;
    const field = this.getMasterFieldConfig(header.key);
    return !!field && (field as any).quickEditable === true;
  }

  isQuickEditEnabledForMasterCell(row: any, header: any): boolean {
    if (!this.quickEditMasterMode || this.quickEditMasterSaving) return false;
    if (!this.isQuickEditableMasterHeader(header)) return false;
    return this.getRowPrimaryKeyValue(row) === this.quickEditMasterRowId;
  }

  startQuickEditMaster(): void {
    if (this.quickEditDetailMode) {
      this.cancelQuickEditDetail(false);
    }
    const row = this.getShortcutTargetRow();
    if (!row) {
      alert('Vui lòng chọn một dòng trước khi sửa nhanh.');
      return;
    }
    if (!this.hasQuickEditableMasterFields()) {
      alert('Không có cột master nào được khai báo quickEditable.');
      return;
    }
    this.quickEditMasterSnapshot = JSON.parse(JSON.stringify(row));
    this.quickEditMasterRowId = this.getRowPrimaryKeyValue(row);
    this.quickEditMasterMode = true;
  }

  cancelQuickEditMaster(showAlert: boolean = true): void {
    if (this.quickEditMasterSnapshot && this.quickEditMasterRowId !== null) {
      this.patchMasterRowById(this.quickEditMasterRowId, this.quickEditMasterSnapshot);
    }
    this.quickEditMasterMode = false;
    this.quickEditMasterSaving = false;
    this.quickEditMasterSnapshot = null;
    this.quickEditMasterRowId = null;
    if (showAlert) {
      alert('Đã hủy sửa nhanh master.');
    }
  }

  async saveQuickEditMaster(): Promise<void> {
    if (!this.quickEditMasterMode || this.quickEditMasterSaving) return;
    if (!this.metadata) {
      alert('Chưa tải metadata form, vui lòng mở chi tiết dòng rồi thử lại.');
      return;
    }

    const row = this.getRowByPrimaryKey(this.quickEditMasterRowId);
    if (!row) {
      alert('Không tìm thấy dữ liệu dòng để lưu nhanh.');
      return;
    }

    this.quickEditMasterSaving = true;
    try {
      const mergedMaster = {
        ...this.getMasterDataForQuickSave(),
      };

      this.girdData.headers.forEach((header) => {
        if (!header.hidden && row[header.key] !== undefined) {
          mergedMaster[header.key] = row[header.key];
        }
      });

      const masterData = this.normalizeValues(this.stripQuickSaveAutoFields(mergedMaster));
      const payload: any = {
        controller: this.metadata.controller,
        formId: this.metadata.formId,
        action: 'update',
        type: this.metadata.type,
        userId: localStorage.getItem('userId'),
        unit: localStorage.getItem('unit') ?? 'CTY',
        language: localStorage.getItem('language') ?? 'vi',
        VCDate: this.metadata?.VCDate ? masterData[this.metadata.VCDate] : '',
        idVC: this.metadata.idVC,
        primaryKey: this.metadata.primaryKey,
        originalPrimaryKeyValues: this.getOriginalPrimaryKeyValuesForQuickSave(masterData),
        data: masterData,
        dataProcessing: this.metadata.dataProcessing ?? { actions: { post: [] } },
      };

      if ((this.metadata.type || '').toLowerCase() === 'voucher') {
        const voucherDate =
          masterData['voucherDate'] ??
          (this.getExpandedRowData() as any)?.['voucherDate'] ??
          '';
        payload.VCDate = this.normalizeQuickSaveDate('voucherDate', voucherDate) ?? '';
      }

      await firstValueFrom(this.http.post(`${environment.apiUrl}/api/Dynamic/save`, payload));
      this.quickEditMasterMode = false;
      this.quickEditMasterSnapshot = null;
      this.quickEditMasterRowId = null;
      alert('Cập nhật nhanh master thành công.');

      this.loadData();
    } catch (err: any) {
      const backendErrors = err?.error?.errors as { message: string }[] | undefined;
      const message =
        backendErrors?.map((e) => e.message).join('\n') ||
        err?.error?.message ||
        'Không thể lưu cập nhật nhanh master.';
      alert(message);
    } finally {
      this.quickEditMasterSaving = false;
    }
  }

  onQuickMasterFieldChange(row: any, fieldKey: string, value: any, type?: string): void {
    if (type === 'checkbox') {
      row[fieldKey] = value ? 1 : 0;
      return;
    }
    row[fieldKey] = value;
  }

  hasQuickEditableDetailFields(): boolean {
    return this.getAllDetailFields().some((field) => this.isQuickEditableField(field));
  }

  isQuickEditableField(field: any): boolean {
    return !!field && field.quickEditable === true;
  }

  isQuickEditEnabledForField(field: any): boolean {
    return (
      this.quickEditDetailMode &&
      this.hasQuickEditableDetailFields() &&
      !field?.disabled &&
      this.isQuickEditableField(field)
    );
  }

  getQuickEditableDetailFields(): any[] {
    return this.getAllDetailFields().filter(
      (field) => this.isQuickEditableField(field) && !field?.disabled,
    );
  }

  getQuickBulkSelectedCount(): number {
    return this.quickBulkSelectedRows.size;
  }

  isQuickBulkRowSelected(row: any): boolean {
    return this.quickBulkSelectedRows.has(row);
  }

  areAllVisibleQuickBulkRowsSelected(): boolean {
    const rows = this.currentFilteredDetailRows || [];
    return rows.length > 0 && rows.every((row) => this.quickBulkSelectedRows.has(row));
  }

  onQuickBulkRowToggle(row: any, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.checked) {
      this.quickBulkSelectedRows.add(row);
    } else {
      this.quickBulkSelectedRows.delete(row);
    }
  }

  toggleAllVisibleQuickBulkRows(event?: Event): void {
    const input = event?.target as HTMLInputElement | undefined;
    const shouldSelect = input ? input.checked : !this.areAllVisibleQuickBulkRowsSelected();
    const rows = this.currentFilteredDetailRows || [];

    rows.forEach((row) => {
      if (shouldSelect) {
        this.quickBulkSelectedRows.add(row);
      } else {
        this.quickBulkSelectedRows.delete(row);
      }
    });
  }

  onQuickBulkValueChange(field: any, value: any): void {
    if (!field?.key) return;
    this.quickBulkValues[field.key] = field.type === 'checkbox' ? (value ? 1 : 0) : value;
    this.quickBulkEnabled[field.key] = true;
  }

  applyQuickBulkToSelectedRows(): void {
    const selectedRows = Array.from(this.quickBulkSelectedRows);
    if (selectedRows.length === 0) {
      alert('Vui lòng chọn ít nhất một dòng chi tiết.');
      return;
    }

    const fieldsToApply = this.getQuickEditableDetailFields().filter(
      (field) => this.quickBulkEnabled[field.key],
    );

    if (fieldsToApply.length === 0) {
      alert('Vui lòng chọn ít nhất một field để áp dụng.');
      return;
    }

    selectedRows.forEach((row) => {
      fieldsToApply.forEach((field) => {
        row[field.key] = field.type === 'checkbox'
          ? (this.quickBulkValues[field.key] ? 1 : 0)
          : this.quickBulkValues[field.key];
      });
    });

    this.applyFilters();
  }

  private resetQuickBulkEditState(): void {
    this.quickBulkValues = {};
    this.quickBulkEnabled = {};
    this.quickBulkSelectedRows.clear();
  }

  startQuickEditDetail(): void {
    if (!this.hasQuickEditableDetailFields()) return;
    if (this.quickEditMasterMode) {
      this.cancelQuickEditMaster(false);
    }
    this.resetQuickBulkEditState();
    this.quickEditDetailSnapshot = JSON.parse(JSON.stringify(this.currentDetailRows || []));
    this.quickEditDetailMode = true;
    this.collapseMasterPaneForQuickEdit();
  }

  cancelQuickEditDetail(showAlert: boolean = true): void {
    if (this.quickEditDetailSnapshot) {
      this.detailRowsData[this.selectedTab][this.selectedDetailIndex] = JSON.parse(
        JSON.stringify(this.quickEditDetailSnapshot),
      );
      this.applyFilters();
    }
    this.quickEditDetailMode = false;
    this.quickEditSaving = false;
    this.quickEditDetailSnapshot = null;
    this.resetQuickBulkEditState();
    this.restorePaneAfterQuickEdit();
    if (showAlert) {
      alert('Đã hủy thay đổi nhanh ở chi tiết.');
    }
  }

  async saveQuickEditDetail(): Promise<void> {
    if (!this.metadata || !this.hasQuickEditableDetailFields() || this.quickEditSaving) {
      return;
    }

    const detailSection = this.currentDetailSection;
    if (!detailSection) return;

    this.quickEditSaving = true;
    try {
      const masterData = this.getMasterDataForQuickSave();
      const details = [
        {
          controllerDetail: detailSection.controllerDetail,
          formIdDetail: detailSection.formId,
          foreignKey: detailSection.foreignKey,
          data: this.currentDetailRows.map((row) =>
            this.normalizeValues(this.stripQuickSaveAutoFields(row)),
          ),
        },
      ];

      const payload: any = {
        controller: this.metadata.controller,
        formId: this.metadata.formId,
        action: 'update',
        type: this.metadata.type,
        userId: localStorage.getItem('userId'),
        unit: localStorage.getItem('unit') ?? 'CTY',
        language: localStorage.getItem('language') ?? 'vi',
        VCDate: this.metadata?.VCDate ? masterData[this.metadata.VCDate] : '',
        idVC: this.metadata.idVC,
        primaryKey: this.metadata.primaryKey,
        originalPrimaryKeyValues: this.getOriginalPrimaryKeyValuesForQuickSave(masterData),
        data: {
          ...masterData,
          details,
        },
        dataProcessing: this.metadata.dataProcessing ?? { actions: { post: [] } },
      };

      if ((this.metadata.type || '').toLowerCase() === 'voucher') {
        const voucherDate =
          masterData['voucherDate'] ??
          (this.getExpandedRowData() as any)?.['voucherDate'] ??
          '';
        payload.VCDate = this.normalizeQuickSaveDate('voucherDate', voucherDate) ?? '';
      }

      await firstValueFrom(this.http.post(`${environment.apiUrl}/api/Dynamic/save`, payload));
      this.quickEditDetailMode = false;
      this.quickEditDetailSnapshot = null;
      this.resetQuickBulkEditState();
      this.restorePaneAfterQuickEdit();
      alert('Cập nhật chi tiết thành công.');

      const row = this.getExpandedRowData();
      if (row) {
        this.toggleRow(row as Record<string, string>, true);
      } else {
        this.loadData();
      }
    } catch (err: any) {
      const backendErrors = err?.error?.errors as { message: string }[] | undefined;
      const message =
        backendErrors?.map((e) => e.message).join('\n') ||
        err?.error?.message ||
        'Không thể lưu cập nhật nhanh chi tiết.';
      alert(message);
    } finally {
      this.quickEditSaving = false;
    }
  }

  onQuickCheckboxToggle(row: any, fieldKey: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    row[fieldKey] = input.checked ? 1 : 0;
  }

  private getMasterDataForQuickSave(): Record<string, any> {
    const merged: Record<string, any> = {};
    (this.metadata?.tabs || []).forEach((tab) => {
      if (tab.form?.initialData) {
        Object.assign(merged, tab.form.initialData);
      }
    });

    const expandedRow = this.getExpandedRowData() || {};

    (this.metadata?.primaryKey || []).forEach((pk) => {
      if (
        (merged[pk] === undefined || merged[pk] === null || merged[pk] === '') &&
        expandedRow[pk] !== undefined
      ) {
        merged[pk] = expandedRow[pk];
      }
    });

    if (
      (merged['voucherDate'] === undefined ||
        merged['voucherDate'] === null ||
        merged['voucherDate'] === '') &&
      expandedRow['voucherDate'] !== undefined
    ) {
      merged['voucherDate'] = expandedRow['voucherDate'];
    }

    return this.normalizeValues(this.stripQuickSaveAutoFields(merged));
  }

  private normalizeValues(obj: any): any {
    const normalized: any = {};
    for (const key in obj) {
      let value = obj[key];
      if (typeof value === 'string' && value.trim() === '') {
        value = null;
      }
      value = this.normalizeQuickSaveDate(key, value);
      normalized[key] = value;
    }
    return normalized;
  }

  private normalizeQuickSaveDate(key: string, value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'string') return value;

    const v = value.trim();
    if (!v) return null;
    if (v.startsWith('0001-01-01')) return null;

    const lowerKey = (key || '').toLowerCase();
    if (!lowerKey.includes('date')) return v;

    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.substring(0, 10);
    return v;
  }

  private stripQuickSaveAutoFields(obj: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {};
    for (const key in obj) {
      if (!this.quickSaveExcludedFields.has(key)) {
        cleaned[key] = obj[key];
      }
    }
    return cleaned;
  }

  private getOriginalPrimaryKeyValuesForQuickSave(masterData: Record<string, any>): Record<string, any> {
    const original: Record<string, any> = {};
    const primaryKeys = this.metadata?.primaryKey || [];
    primaryKeys.forEach((pk) => {
      original[pk] = masterData?.[pk] ?? '';
    });
    return original;
  }

  onGridKeyboardShortcut(event: KeyboardEvent): void {
    if (this.isTypingTarget(event.target)) return;

    const rawKey = event.key || '';
    if (!event.ctrlKey && !event.metaKey && !event.altKey && rawKey === '?') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleShortcutHelp();
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && rawKey === 'Escape') {
      if (this.showShortcutHelp) {
        event.preventDefault();
        event.stopPropagation();
        this.showShortcutHelp = false;
      }
      return;
    }

    const isUpdateShortcut =
      this.isFunctionKey(event, 'F2') || this.isCtrlShiftLetter(event, 'E');
    const isViewShortcut =
      this.isFunctionKey(event, 'F4') || this.isCtrlShiftLetter(event, 'V');
    const isDeleteShortcut =
      this.isFunctionKey(event, 'F8') || this.isCtrlShiftLetter(event, 'D');
    if (!isUpdateShortcut && !isViewShortcut && !isDeleteShortcut) return;

    event.preventDefault();
    event.stopPropagation();

    if (isUpdateShortcut) {
      this.handleToolbarUpdate();
      return;
    }

    if (isViewShortcut) {
      this.handleToolbarView();
      return;
    }

    if (isDeleteShortcut) {
      this.handleToolbarDelete();
      return;
    }
  }

  toggleShortcutHelp(): void {
    this.showShortcutHelp = !this.showShortcutHelp;
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

  @HostListener('document:keydown', ['$event'])
  onGridArrowNavigation(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (this.isTypingTarget(event.target)) return;

    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const inDetail = this.isDetailTarget(event.target);

    if (inDetail && this.isVoucherType()) {
      this.moveDetailSelection(delta);
      return;
    }

    this.moveMasterSelection(delta);
  }

  getToolbarTargetRow(): Record<string, any> | null {
    return this.getShortcutTargetRow();
  }

  handleToolbarView(): void {
    const row = this.getShortcutTargetRow();
    if (!row) {
      alert('Vui lòng chọn một dòng trước khi xem.');
      return;
    }
    this.handleClickView(row as Record<string, string>);
  }

  handleToolbarUpdate(): void {
    const row = this.getShortcutTargetRow();
    if (!row) {
      alert('Vui lòng chọn một dòng trước khi sửa.');
      return;
    }
    this.handleClickUpdate(row as Record<string, string>);
  }

  handleToolbarRefresh(): void {
    this.loadData();
  }

  handleToolbarDelete(): void {
    const selectedRows = Object.values(this.selectedOptions || {}).filter(
      (row) => !!row,
    ) as Record<string, any>[];

    if (!selectedRows.length) {
      const activeRow = this.getShortcutTargetRow();
      if (!activeRow) {
        alert('Vui lòng chọn một dòng trước khi xóa.');
        return;
      }

      const primaryKey = this.girdData.query.formId.primaryKey?.[0];
      if (!primaryKey) {
        alert('Không xác định được khóa chính để xóa.');
        return;
      }
      const key = activeRow?.[primaryKey];
      if (key !== undefined && key !== null && key !== '') {
        this.selectedOptions[key] = activeRow;
      }
    }

    this.handleMultiDeleted();
  }

  private getShortcutTargetRow(): Record<string, any> | null {
    if (this.activeMasterRow) return this.activeMasterRow;

    const expandedRow = this.getExpandedRowData();
    if (expandedRow) return expandedRow;

    const selectedRows = Object.values(this.selectedOptions || {}).filter(
      (row) => !!row,
    ) as Record<string, any>[];

    if (selectedRows.length > 0) return selectedRows[0];

    if (this.filteredData && this.filteredData.length > 0) {
      return this.filteredData[0] as Record<string, any>;
    }

    return null;
  }

  private moveMasterSelection(delta: number): void {
    const rows = this.filteredData || [];
    if (!rows.length) return;

    const currentIndex = this.getActiveMasterIndex(rows);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.min(Math.max(baseIndex + delta, 0), rows.length - 1);
    const nextRow = rows[nextIndex];
    if (!nextRow) return;

    this.activeMasterRow = nextRow;
    if (this.isVoucherType() && !this.detailPanelHidden) {
      this.toggleRow(nextRow as Record<string, string>, true);
    }
    this.scrollMasterRowIntoView(nextIndex);
  }

  private getActiveMasterIndex(rows: any[]): number {
    if (!rows?.length) return -1;
    const primaryKey = this.girdData.query.formId.primaryKey?.[0];
    if (!primaryKey) return -1;

    if (this.expandedRowId) {
      const byExpanded = rows.findIndex((r) => r?.[primaryKey] === this.expandedRowId);
      if (byExpanded >= 0) return byExpanded;
    }

    if (this.activeMasterRow) {
      return rows.findIndex((r) => r?.[primaryKey] === this.activeMasterRow?.[primaryKey]);
    }

    return -1;
  }

  private moveDetailSelection(delta: number): void {
    const rows = this.currentFilteredDetailRows || [];
    if (!rows.length) return;
    const nextIndex = Math.min(
      Math.max(this.activeDetailRowIndex + delta, 0),
      rows.length - 1,
    );
    this.activeDetailRowIndex = nextIndex;
    this.scrollDetailRowIntoView(nextIndex);
  }

  private syncActiveDetailRowIndex(): void {
    const rows = this.currentFilteredDetailRows || [];
    if (!rows.length) {
      this.activeDetailRowIndex = 0;
      return;
    }
    const maxIndex = rows.length - 1;
    this.activeDetailRowIndex = Math.min(Math.max(this.activeDetailRowIndex, 0), maxIndex);
  }

  private isDetailTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return !!el.closest('.detail-table-container');
  }

  private scrollMasterRowIntoView(index: number): void {
    requestAnimationFrame(() => {
      const row = document.querySelector(
        `.master-scroll-zone tr[data-master-index="${index}"]`,
      ) as HTMLElement | null;
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  private scrollDetailRowIntoView(index: number): void {
    requestAnimationFrame(() => {
      const row = document.querySelector(
        `.detail-table-container tr[data-detail-index="${index}"]`,
      ) as HTMLElement | null;
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();

    if (tag === 'textarea' || tag === 'select' || el.isContentEditable) {
      return true;
    }

    if (tag === 'input') {
      const input = el as HTMLInputElement;
      const type = (input.type || 'text').toLowerCase();
      // Do not block shortcuts when focus is on non-typing inputs (checkbox, radio, button...)
      return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
    }

    return false;
  }
}
