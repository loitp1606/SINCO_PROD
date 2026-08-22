import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { DashboardService } from '../../services/dashboard.service';
import { ChartCardComponent } from './chart-card/chart-card.component';
import { StatisticsCardComponent } from './statistics-card/statistics-card.component';

interface DashboardStatistic {
  title: string;
  value: string;
  icon: string;
  trend: number;
  trendText: string;
  trendUp: boolean;
  color: string;
  caption: string;
}

interface DashboardActivity {
  type: string;
  number: string;
  customer: string;
  date: Date | null;
  amount: number;
  route: string;
  icon: string;
  color: string;
}

interface DashboardAlert {
  label: string;
  value: string;
  note: string;
  icon: string;
  tone: 'warning' | 'danger' | 'info';
  route: string;
}

type DashboardPeriodMode = 'month' | 'quarter' | 'year';

interface DashboardPeriodRange {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
}

interface DashboardTimeBucket {
  label: string;
  start: Date;
  end: Date;
}

interface DashboardPeriodOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: true,
  imports: [CommonModule, StatisticsCardComponent, ChartCardComponent],
})
export class DashboardComponent implements OnInit {
  today = new Date();
  selectedDate = new Date(this.today.getFullYear(), this.today.getMonth(), 1);
  periodMode: DashboardPeriodMode = 'month';
  readonly periodModes: Array<{ value: DashboardPeriodMode; label: string }> = [
    { value: 'month', label: 'Tháng' },
    { value: 'quarter', label: 'Quý' },
    { value: 'year', label: 'Năm' },
  ];
  private readonly periodHistoryYears = 10;
  errorMessage = '';
  isLoading = true;
  lastUpdated: Date | null = null;

  financialHighlights = {
    revenue: 0,
    grossProfit: 0,
    netProfit: 0,
    cost: 0,
    margin: 0,
    revenueTrend: 0,
  };

  statistics: DashboardStatistic[] = [];
  charts: Array<{
    title: string;
    subtitle: string;
    type: string;
    data: number[];
    labels: string[];
    color: string;
    valueFormat: 'number' | 'currency';
  }> = [];
  activities: DashboardActivity[] = [];
  alerts: DashboardAlert[] = [];
  funnel = [
    { label: 'Báo giá', value: 0, color: '#2563eb', route: '/quotationPaper' },
    { label: 'Đơn hàng', value: 0, color: '#7c3aed', route: '/order' },
    { label: 'Đã giao', value: 0, color: '#059669', route: '/deliveryNote' },
    { label: 'Đã thu', value: 0, color: '#0891b2', route: '/receiptV2' },
  ];

  constructor(
    private readonly router: Router,
    private readonly dashboardService: DashboardService,
  ) {}

  ngOnInit(): void {
    if (!localStorage.getItem('token')) {
      this.router.navigate(['/login']);
      return;
    }
    this.loadDashboardData();
  }

  refreshData(): void {
    this.loadDashboardData();
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  get currentPeriodLabel(): string {
    const year = this.selectedDate.getFullYear();
    if (this.periodMode === 'year') return `Năm ${year}`;
    if (this.periodMode === 'quarter') {
      return `Quý ${Math.floor(this.selectedDate.getMonth() / 3) + 1}/${year}`;
    }
    return `Tháng ${this.selectedDate.getMonth() + 1}/${year}`;
  }

  get comparisonPeriodLabel(): string {
    if (this.periodMode === 'year') return 'so với năm trước';
    if (this.periodMode === 'quarter') return 'so với quý trước';
    return 'so với tháng trước';
  }

  get selectedPeriodValue(): string {
    const year = this.selectedDate.getFullYear();
    if (this.periodMode === 'year') return String(year);
    if (this.periodMode === 'quarter') {
      return `${year}-Q${Math.floor(this.selectedDate.getMonth() / 3) + 1}`;
    }
    return `${year}-${String(this.selectedDate.getMonth() + 1).padStart(2, '0')}`;
  }

  get periodOptions(): DashboardPeriodOption[] {
    const options: DashboardPeriodOption[] = [];
    const currentYear = this.today.getFullYear();
    const firstYear = currentYear - this.periodHistoryYears + 1;

    for (let year = currentYear; year >= firstYear; year -= 1) {
      if (this.periodMode === 'year') {
        options.push({ value: String(year), label: `Năm ${year}` });
        continue;
      }

      if (this.periodMode === 'quarter') {
        const lastQuarter = year === currentYear
          ? Math.floor(this.today.getMonth() / 3) + 1
          : 4;
        for (let quarter = lastQuarter; quarter >= 1; quarter -= 1) {
          options.push({ value: `${year}-Q${quarter}`, label: `Quý ${quarter}/${year}` });
        }
        continue;
      }

      const lastMonth = year === currentYear ? this.today.getMonth() + 1 : 12;
      for (let month = lastMonth; month >= 1; month -= 1) {
        options.push({
          value: `${year}-${String(month).padStart(2, '0')}`,
          label: `Tháng ${month}/${year}`,
        });
      }
    }
    return options;
  }

  get canGoNextPeriod(): boolean {
    return this.getPeriodRange().end.getTime() < this.today.getTime();
  }

  get canGoPreviousPeriod(): boolean {
    const firstYear = this.today.getFullYear() - this.periodHistoryYears + 1;
    return this.getPeriodRange().start.getTime() > new Date(firstYear, 0, 1).getTime();
  }

  selectPeriodMode(mode: DashboardPeriodMode): void {
    if (this.periodMode === mode) return;
    this.periodMode = mode;
    this.selectedDate = new Date(this.today.getFullYear(), this.today.getMonth(), 1);
    this.loadDashboardData();
  }

  selectPeriodValue(value: string): void {
    if (!value || value === this.selectedPeriodValue) return;
    if (this.periodMode === 'year') {
      this.selectedDate = new Date(Number(value), 0, 1);
    } else if (this.periodMode === 'quarter') {
      const [yearText, quarterText] = value.split('-Q');
      this.selectedDate = new Date(Number(yearText), (Number(quarterText) - 1) * 3, 1);
    } else {
      const [yearText, monthText] = value.split('-');
      this.selectedDate = new Date(Number(yearText), Number(monthText) - 1, 1);
    }
    this.loadDashboardData();
  }

  shiftPeriod(direction: -1 | 1): void {
    if (direction > 0 && !this.canGoNextPeriod) return;
    if (direction < 0 && !this.canGoPreviousPeriod) return;
    const next = new Date(this.selectedDate);
    if (this.periodMode === 'month') next.setMonth(next.getMonth() + direction);
    if (this.periodMode === 'quarter') next.setMonth(next.getMonth() + direction * 3);
    if (this.periodMode === 'year') next.setFullYear(next.getFullYear() + direction);
    this.selectedDate = new Date(next.getFullYear(), next.getMonth(), 1);
    this.loadDashboardData();
  }

  get maxFunnelValue(): number {
    return Math.max(...this.funnel.map((item) => item.value), 1);
  }

  funnelWidth(value: number): number {
    return Math.max((value / this.maxFunnelValue) * 100, value > 0 ? 8 : 0);
  }

  private loadDashboardData(): void {
    this.isLoading = true;
    this.errorMessage = '';
    const period = this.getPeriodRange();
    let failedSources = 0;
    const fallback = () => {
      failedSources += 1;
      return of({ data: [], total: 0 } as any);
    };

    forkJoin({
      bcdtln: this.dashboardService.loadBcdtlnReport(period.start, period.end).pipe(catchError(() => {
        failedSources += 1;
        return of([]);
      })),
      quotation: this.dashboardService.loadQuotationList(period.previousStart, period.end).pipe(catchError(fallback)),
      order: this.dashboardService.loadOrderList(period.previousStart, period.end).pipe(catchError(fallback)),
      deliveryNote: this.dashboardService.loadDeliveryNoteList(period.previousStart, period.end).pipe(catchError(fallback)),
      receipt: this.dashboardService.loadReceiptList(period.previousStart, period.end).pipe(catchError(fallback)),
    }).subscribe({
      next: (data) => {
        const quotationRows = data.quotation?.data || [];
        const orderRows = data.order?.data || [];
        const deliveryRows = data.deliveryNote?.data || [];
        const receiptRows = data.receipt?.data || [];
        const financial = this.extractFinancialMetrics(data.bcdtln || []);

        this.financialHighlights = {
          revenue: financial.revenue,
          grossProfit: financial.grossProfit,
          netProfit: financial.netProfit,
          cost: financial.cost,
          margin: financial.revenue
            ? Number(((financial.grossProfit / financial.revenue) * 100).toFixed(1))
            : 0,
          revenueTrend: this.calculateTrendPercent(financial.revenue, financial.previousRevenue),
        };

        this.buildStatistics(quotationRows, orderRows, deliveryRows, receiptRows, period);
        this.buildCharts(orderRows, deliveryRows, period);
        this.buildFunnel(quotationRows, orderRows, deliveryRows, receiptRows, period);
        this.buildActivities(quotationRows, orderRows, deliveryRows, receiptRows, period);
        this.buildAlerts(deliveryRows, receiptRows, period);

        this.lastUpdated = new Date();
        this.errorMessage = failedSources
          ? `${failedSources} nguồn dữ liệu chưa tải được. Các số liệu còn lại vẫn được hiển thị.`
          : '';
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Không thể tải dữ liệu dashboard.';
        this.isLoading = false;
      },
    });
  }

  private buildStatistics(
    quotations: any[], orders: any[], deliveries: any[], receipts: any[],
    period: DashboardPeriodRange,
  ): void {
    const currentOrders = this.rowsInRange(orders, period.start, period.end);
    const previousOrders = this.rowsInRange(orders, period.previousStart, period.previousEnd);
    const currentQuotations = this.rowsInRange(quotations, period.start, period.end);
    const previousQuotations = this.rowsInRange(quotations, period.previousStart, period.previousEnd);
    const currentDeliveries = this.rowsInRange(deliveries, period.start, period.end);
    const delivered = currentDeliveries.filter((row) => String(row?.status) === '1').length;
    const pendingDelivery = currentDeliveries.filter((row) => String(row?.status) === '0').length;
    const currentReceipts = this.rowsInRange(receipts, period.start, period.end);
    const collectedThisMonth = currentReceipts
      .filter((row) => this.isTruthy(row?.isReceived))
      .reduce((sum, row) => sum + this.amountOf(row, ['total_amount']), 0);
    const collectedPreviousPeriod = this.rowsInRange(receipts, period.previousStart, period.previousEnd)
      .filter((row) => this.isTruthy(row?.isReceived))
      .reduce((sum, row) => sum + this.amountOf(row, ['total_amount']), 0);
    const conversion = currentQuotations.length
      ? (currentOrders.length / currentQuotations.length) * 100
      : 0;
    const previousConversion = previousQuotations.length
      ? (previousOrders.length / previousQuotations.length) * 100
      : 0;

    this.statistics = [
      {
        title: 'Đơn hàng trong kỳ',
        value: this.formatNumber(currentOrders.length),
        icon: 'fas fa-bag-shopping',
        trend: Math.abs(this.calculateTrendPercent(currentOrders.length, previousOrders.length)),
        trendText: this.comparisonPeriodLabel,
        trendUp: currentOrders.length >= previousOrders.length,
        color: '#7c3aed',
        caption: this.formatCurrencyVnd(this.sumAmounts(currentOrders, ['total_payment'])),
      },
      {
        title: 'Tiến độ giao hàng',
        value: `${delivered}/${currentDeliveries.length}`,
        icon: 'fas fa-truck-fast',
        trend: currentDeliveries.length ? Number(((delivered / currentDeliveries.length) * 100).toFixed(1)) : 0,
        trendText: 'đã hoàn tất',
        trendUp: true,
        color: '#059669',
        caption: `${this.formatNumber(pendingDelivery)} phiếu đang chờ giao`,
      },
      {
        title: 'Đã thu trong kỳ',
        value: this.formatCurrencyCompact(collectedThisMonth),
        icon: 'fas fa-wallet',
        trend: Math.abs(this.calculateTrendPercent(collectedThisMonth, collectedPreviousPeriod)),
        trendText: this.comparisonPeriodLabel,
        trendUp: collectedThisMonth >= collectedPreviousPeriod,
        color: '#0891b2',
        caption: `${this.formatNumber(currentReceipts.length)} phiếu thu`,
      },
      {
        title: 'Tỷ lệ chuyển đổi',
        value: `${conversion.toFixed(1)}%`,
        icon: 'fas fa-arrow-trend-up',
        trend: Math.abs(this.calculateTrendPercent(conversion, previousConversion)),
        trendText: this.comparisonPeriodLabel,
        trendUp: conversion >= previousConversion,
        color: '#ea580c',
        caption: `${currentOrders.length}/${currentQuotations.length} báo giá thành đơn`,
      },
    ];
  }

  private buildCharts(orders: any[], deliveries: any[], period: DashboardPeriodRange): void {
    const buckets = this.getChartBuckets(period);
    const orderValues = buckets.map((bucket) => this.sumAmounts(
      this.rowsInRange(orders, bucket.start, bucket.end),
      ['total_payment'],
    ));
    const currentDeliveries = this.rowsInRange(deliveries, period.start, period.end);
    const pending = currentDeliveries.filter((row) => String(row?.status) === '0').length;
    const completed = currentDeliveries.filter((row) => String(row?.status) === '1').length;
    const other = Math.max(currentDeliveries.length - pending - completed, 0);

    this.charts = [
      {
        title: 'Giá trị đơn hàng', subtitle: `Diễn biến ${this.currentPeriodLabel.toLowerCase()}`, type: 'line',
        data: orderValues, labels: buckets.map((bucket) => bucket.label),
        color: '#2563eb', valueFormat: 'currency',
      },
      {
        title: 'Tình trạng giao hàng', subtitle: `${this.formatNumber(currentDeliveries.length)} phiếu xuất`, type: 'pie',
        data: [completed, pending, other], labels: ['Đã giao', 'Đang chờ giao', 'Khác'],
        color: '#059669', valueFormat: 'number',
      },
    ];
  }

  private buildFunnel(
    quotations: any[], orders: any[], deliveries: any[], receipts: any[],
    period: DashboardPeriodRange,
  ): void {
    this.funnel = [
      { label: 'Báo giá', value: this.rowsInRange(quotations, period.start, period.end).length, color: '#2563eb', route: '/quotationPaper' },
      { label: 'Đơn hàng', value: this.rowsInRange(orders, period.start, period.end).length, color: '#7c3aed', route: '/order' },
      { label: 'Đã giao', value: this.rowsInRange(deliveries, period.start, period.end).filter((row) => String(row?.status) === '1').length, color: '#059669', route: '/deliveryNote' },
      { label: 'Đã thu', value: this.rowsInRange(receipts, period.start, period.end).filter((row) => this.isTruthy(row?.isReceived)).length, color: '#0891b2', route: '/receiptV2' },
    ];
  }

  private buildActivities(
    quotations: any[], orders: any[], deliveries: any[], receipts: any[],
    period: DashboardPeriodRange,
  ): void {
    const mapRows = (
      rows: any[], type: string, route: string, icon: string, color: string,
      amountKeys: string[], customerKeys: string[],
    ): DashboardActivity[] => rows.map((row) => ({
      type,
      number: row?.voucherNumber || 'Chưa có số phiếu',
      customer: this.firstValue(row, customerKeys) || 'Chưa xác định khách hàng',
      date: this.parseDate(row?.voucherDate),
      amount: this.amountOf(row, amountKeys),
      route,
      icon,
      color,
    }));

    this.activities = [
      ...mapRows(this.rowsInRange(quotations, period.start, period.end), 'Báo giá', '/quotationPaper', 'fas fa-file-signature', '#2563eb', ['total_payment'], ['customerName', 'customerCode']),
      ...mapRows(this.rowsInRange(orders, period.start, period.end), 'Đơn hàng', '/order', 'fas fa-bag-shopping', '#7c3aed', ['total_payment'], ['customerName', 'customerID']),
      ...mapRows(this.rowsInRange(deliveries, period.start, period.end), 'Xuất hàng', '/deliveryNote', 'fas fa-truck-fast', '#059669', ['totalPayment'], ['customerName', 'customer_id']),
      ...mapRows(this.rowsInRange(receipts, period.start, period.end), 'Phiếu thu', '/receiptV2', 'fas fa-wallet', '#0891b2', ['total_amount'], ['customerName', 'customerCode']),
    ].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)).slice(0, 6);
  }

  private buildAlerts(deliveries: any[], receipts: any[], period: DashboardPeriodRange): void {
    const currentDeliveries = this.rowsInRange(deliveries, period.start, period.end);
    const currentReceipts = this.rowsInRange(receipts, period.start, period.end);
    const pendingDelivery = currentDeliveries.filter((row) => String(row?.status) === '0');
    const debt = currentDeliveries.reduce((sum, row) => sum + this.amountOf(row, ['debtAmount']), 0);
    const pendingReceipt = currentReceipts.filter((row) => !this.isTruthy(row?.isReceived));
    this.alerts = [
      { label: 'Chờ giao hàng', value: this.formatNumber(pendingDelivery.length), note: 'phiếu cần theo dõi tiến độ', icon: 'fas fa-clock', tone: 'warning', route: '/deliveryNote' },
      { label: 'Công nợ phiếu xuất', value: this.formatCurrencyCompact(debt), note: 'giá trị còn phải thu', icon: 'fas fa-triangle-exclamation', tone: 'danger', route: '/deliveryNote' },
      { label: 'Phiếu thu chưa xác nhận', value: this.formatNumber(pendingReceipt.length), note: 'phiếu chưa đánh dấu đã thu', icon: 'fas fa-circle-info', tone: 'info', route: '/receiptV2' },
    ];
  }

  private rowsInRange(rows: any[], start: Date, end: Date): any[] {
    return rows.filter((row) => {
      const date = this.parseDate(row?.voucherDate);
      return !!date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
    });
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;
    const nativeDate = new Date(value);
    if (!isNaN(nativeDate.getTime())) return nativeDate;
    const match = String(value).match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
    if (!match) return null;
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return isNaN(date.getTime()) ? null : date;
  }

  private getPeriodRange(): DashboardPeriodRange {
    const year = this.selectedDate.getFullYear();
    const month = this.selectedDate.getMonth();
    let start: Date;
    let end: Date;
    let previousStart: Date;
    let previousEnd: Date;

    if (this.periodMode === 'year') {
      start = new Date(year, 0, 1);
      end = new Date(year, 11, 31, 23, 59, 59, 999);
      previousStart = new Date(year - 1, 0, 1);
      previousEnd = new Date(year - 1, 11, 31, 23, 59, 59, 999);
    } else if (this.periodMode === 'quarter') {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      start = new Date(year, quarterStartMonth, 1);
      end = new Date(year, quarterStartMonth + 3, 0, 23, 59, 59, 999);
      previousStart = new Date(year, quarterStartMonth - 3, 1);
      previousEnd = new Date(year, quarterStartMonth, 0, 23, 59, 59, 999);
    } else {
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 0, 23, 59, 59, 999);
      previousStart = new Date(year, month - 1, 1);
      previousEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    return { start, end, previousStart, previousEnd };
  }

  private getChartBuckets(period: DashboardPeriodRange): DashboardTimeBucket[] {
    if (this.periodMode === 'month') {
      const buckets: DashboardTimeBucket[] = [];
      let day = 1;
      let week = 1;
      while (day <= period.end.getDate()) {
        const endDay = Math.min(day + 6, period.end.getDate());
        buckets.push({
          label: `T${week}`,
          start: new Date(period.start.getFullYear(), period.start.getMonth(), day),
          end: new Date(period.start.getFullYear(), period.start.getMonth(), endDay, 23, 59, 59, 999),
        });
        day += 7;
        week += 1;
      }
      return buckets;
    }

    const monthCount = this.periodMode === 'quarter' ? 3 : 12;
    return Array.from({ length: monthCount }, (_, index) => {
      const monthStart = new Date(period.start.getFullYear(), period.start.getMonth() + index, 1);
      return {
        label: `T${monthStart.getMonth() + 1}`,
        start: monthStart,
        end: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    });
  }

  private calculateTrendPercent(current: number, previous: number): number {
    if (!previous && !current) return 0;
    if (!previous) return 100;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  }

  formatCurrencyVnd(value: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency', currency: 'VND', maximumFractionDigits: 0,
    }).format(value || 0);
  }

  formatCurrencyCompact(value: number): string {
    if (Math.abs(value) < 1_000_000) return this.formatCurrencyVnd(value);
    return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0) + ' ₫';
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('vi-VN').format(value || 0);
  }

  private sumAmounts(rows: any[], keys: string[]): number {
    return rows.reduce((sum, row) => sum + this.amountOf(row, keys), 0);
  }

  private amountOf(row: any, keys: string[]): number {
    const key = keys.find((candidate) => row?.[candidate] !== undefined);
    return key ? this.parseNumeric(row[key]) : 0;
  }

  private firstValue(row: any, keys: string[]): string {
    const key = keys.find((candidate) => row?.[candidate]);
    return key ? String(row[key]) : '';
  }

  private parseNumeric(value: any): number {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined || value === '') return 0;
    const raw = String(value).replace(/[₫$€£¥\s]/g, '');
    let normalized = raw;
    if (raw.includes(',') && raw.includes('.')) {
      normalized = raw.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
      normalized = raw.replace(/\./g, '');
    } else if (/^-?\d{1,3}(,\d{3})+$/.test(raw)) {
      normalized = raw.replace(/,/g, '');
    } else if (raw.includes(',')) {
      normalized = raw.replace(',', '.');
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private isTruthy(value: any): boolean {
    return value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
  }

  private extractFinancialMetrics(rows: Record<string, any>[]): {
    revenue: number;
    previousRevenue: number;
    grossProfit: number;
    netProfit: number;
    cost: number;
  } {
    return {
      revenue: this.reportTotal(rows, 'dt_kn'),
      previousRevenue: this.reportTotal(rows, 'dt_ktr'),
      grossProfit: this.reportTotal(rows, 'loi_nhuan_kn'),
      netProfit: this.reportTotal(rows, 'lai_lo_kn'),
      cost: this.reportTotal(rows, 'gv_kn'),
    };
  }

  private reportTotal(rows: Record<string, any>[], field: string): number {
    if (!rows.length) return 0;
    const totalRow = rows.find((row) => {
      const label = this.normalizeKey(String(row?.['dien_giai'] || ''));
      return label.includes('tongcong') || label === 'tong';
    });
    if (totalRow) return this.parseNumeric(totalRow[field]);
    return rows.reduce((sum, row) => sum + this.parseNumeric(row?.[field]), 0);
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }
}
