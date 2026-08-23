import { Component, EventEmitter, HostListener, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PageTitleService } from '../../services/page-title.service';
import { ShortcutHelpService } from '../../services/shortcut-help.service';
import { Subject, takeUntil } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import {
  GridHeaderContext,
  GridHeaderContextService,
  GridHeaderPeriodMode,
  GridHeaderTimeFilterMode,
} from '../../services/grid-header-context.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit, OnDestroy {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() toggleCollapse = new EventEmitter<void>();

  isCollapsed = false;
  isAuthenticated = false;
  pageTitle = '';
  gridContext: GridHeaderContext | null = null;
  activeContextPanel: 'time' | 'columns' | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private router: Router,
    private pageTitleService: PageTitleService,
    private shortcutHelpService: ShortcutHelpService,
    private gridHeaderContextService: GridHeaderContextService,
  ) {
    this.isAuthenticated = this.authService.isAuthenticated();
  }

  ngOnInit(): void {
    this.pageTitleService.title$
      .pipe(takeUntil(this.destroy$))
      .subscribe((title) => (this.pageTitle = title));
    this.gridHeaderContextService.context$
      .pipe(takeUntil(this.destroy$))
      .subscribe((context) => {
        this.gridContext = context;
        if (!context) this.activeContextPanel = null;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

  onToggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    this.toggleCollapse.emit();
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  toggleShortcutHelp(): void {
    this.shortcutHelpService.toggle();
  }

  toggleContextPanel(event: MouseEvent, panel: 'time' | 'columns'): void {
    event.stopPropagation();
    this.activeContextPanel = this.activeContextPanel === panel ? null : panel;
  }

  @HostListener('document:click')
  closeContextPanel(): void {
    this.activeContextPanel = null;
  }

  onFilterModeChange(value: string): void {
    this.gridContext?.time?.onFilterModeChange(value as GridHeaderTimeFilterMode);
  }

  onPeriodModeChange(value: string): void {
    this.gridContext?.time?.onPeriodModeChange(value as GridHeaderPeriodMode);
  }

  onDateBoundaryChange(boundary: 'from' | 'to', value: string): void {
    const time = this.gridContext?.time;
    if (!time) return;
    const dateFrom = boundary === 'from' ? value : time.dateFrom;
    const dateTo = boundary === 'to' ? value : time.dateTo;
    if (!dateFrom || !dateTo) return;
    time.onDateRangeChange(dateFrom, dateTo);
  }

  get timeFilterBadge(): string {
    const time = this.gridContext?.time;
    if (!time) return '';
    if (time.filterMode === 'period') {
      return time.periodOptions.find((option) => option.value === time.selectedPeriodValue)?.label || '';
    }
    return `${this.formatShortDate(time.dateFrom)}–${this.formatShortDate(time.dateTo)}`;
  }

  private formatShortDate(value: string): string {
    const [year, month, day] = value.split('-');
    return year && month && day ? `${day}/${month}` : value;
  }
} 
