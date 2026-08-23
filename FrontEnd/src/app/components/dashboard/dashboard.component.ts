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
  trend: number | null;
  trendText: string;
  trendUp: boolean;
  color: string;
  caption: string;
  route: string;
  tooltip?: string;
  emptyState?: boolean;
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

interface FinancialPerformanceRow {
  label: string;
  current: number;
  previous: number;
  trend: number | null;
  favorable: boolean;
  color: string;
}

interface ProfitGauge {
  label: string;
  value: number | null;
  benchmark: number | null;
  color: string;
}

interface DebtAgingBucket {
  label: string;
  amount: number;
  count: number;
  color: string;
}

interface FinancialMetrics {
  revenue: number;
  previousRevenue: number;
  grossProfit: number;
  previousGrossProfit: number;
  netProfit: number;
  previousNetProfit: number;
  cost: number;
  previousCost: number;
  expense: number;
  previousExpense: number;
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
    previousRevenue: 0,
    grossProfit: 0,
    previousGrossProfit: 0,
    netProfit: 0,
    previousNetProfit: 0,
    cost: 0,
    previousCost: 0,
    expense: 0,
    previousExpense: 0,
    margin: null as number | null,
    revenueTrend: null as number | null,
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
  financialPerformance: FinancialPerformanceRow[] = [];
  profitGauges: ProfitGauge[] = [];
  debtAging: DebtAgingBucket[] = [];
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

  get periodYearOptions(): number[] {
    const options: number[] = [];
    const currentYear = this.today.getFullYear();
    const firstYear = currentYear - this.periodHistoryYears + 1;

    for (let year = currentYear; year >= firstYear; year -= 1) {
      options.push(year);
    }
    return options;
  }

  get selectedPeriodUnit(): number {
    return this.periodMode === 'quarter'
      ? Math.floor(this.selectedDate.getMonth() / 3) + 1
      : this.selectedDate.getMonth() + 1;
  }

  get periodUnitOptions(): number[] {
    const count = this.periodMode === 'quarter' ? 4 : 12;
    return Array.from({ length: count }, (_, index) => index + 1);
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

  selectPeriodUnit(value: string): void {
    const unit = Number(value);
    if (!unit || unit === this.selectedPeriodUnit) return;
    const month = this.periodMode === 'quarter' ? (unit - 1) * 3 : unit - 1;
    this.selectedDate = new Date(this.selectedDate.getFullYear(), month, 1);
    this.loadDashboardData();
  }

  selectPeriodYear(value: string): void {
    const year = Number(value);
    if (!year || year === this.selectedDate.getFullYear()) return;
    this.selectedDate = new Date(year, this.selectedDate.getMonth(), 1);
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
          previousRevenue: financial.previousRevenue,
          grossProfit: financial.grossProfit,
          previousGrossProfit: financial.previousGrossProfit,
          netProfit: financial.netProfit,
          previousNetProfit: financial.previousNetProfit,
          cost: financial.cost,
          previousCost: financial.previousCost,
          expense: financial.expense,
          previousExpense: financial.previousExpense,
          margin: this.ratioPercent(financial.grossProfit, financial.revenue),
          revenueTrend: this.calculateTrendPercent(financial.revenue, financial.previousRevenue),
        };

        this.buildStatistics(quotationRows, orderRows, deliveryRows, receiptRows, period);
        this.buildCharts(orderRows, deliveryRows, period);
        this.buildFunnel(quotationRows, orderRows, deliveryRows, receiptRows, period);
        this.buildActivities(quotationRows, orderRows, deliveryRows, receiptRows, period);
        this.buildAlerts(deliveryRows, receiptRows, period);
        this.buildFinancialAnalysis(financial);
        this.buildDebtAging(deliveryRows, period);

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
    const confirmedReceipts = currentReceipts.filter((row) => this.isTruthy(row?.isReceived));
    const collectedThisMonth = confirmedReceipts
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
        trend: this.absoluteTrend(currentOrders.length, previousOrders.length),
        trendText: this.comparisonPeriodLabel,
        trendUp: currentOrders.length >= previousOrders.length,
        color: '#7c3aed',
        caption: this.formatCurrencyVnd(this.sumAmounts(currentOrders, ['total_payment'])),
        route: '/order',
      },
      {
        title: 'Tiến độ giao hàng',
        value: currentDeliveries.length ? `${delivered}/${currentDeliveries.length}` : 'Chưa phát sinh',
        icon: 'fas fa-truck-fast',
        trend: currentDeliveries.length ? Number(((delivered / currentDeliveries.length) * 100).toFixed(1)) : null,
        trendText: 'đã hoàn tất',
        trendUp: true,
        color: '#059669',
        caption: currentDeliveries.length
          ? `${this.formatNumber(pendingDelivery)} phiếu đang chờ giao`
          : 'Không có phiếu xuất trong kỳ',
        route: '/deliveryNote',
        emptyState: !currentDeliveries.length,
      },
      {
        title: 'Đã xác nhận thu',
        value: this.formatCurrencyCompact(collectedThisMonth),
        icon: 'fas fa-wallet',
        trend: this.absoluteTrend(collectedThisMonth, collectedPreviousPeriod),
        trendText: this.comparisonPeriodLabel,
        trendUp: collectedThisMonth >= collectedPreviousPeriod,
        color: '#0891b2',
        caption: `${this.formatNumber(confirmedReceipts.length)} phiếu đã xác nhận`,
        route: '/receiptV2',
        tooltip: 'Chỉ tính các phiếu thu đã được đánh dấu xác nhận thu.',
      },
      {
        title: 'Tỷ lệ chuyển đổi',
        value: currentQuotations.length ? this.formatPercent(conversion) : '—',
        icon: 'fas fa-arrow-trend-up',
        trend: currentQuotations.length ? this.absoluteTrend(conversion, previousConversion) : null,
        trendText: this.comparisonPeriodLabel,
        trendUp: conversion >= previousConversion,
        color: '#ea580c',
        caption: currentQuotations.length
          ? `${currentOrders.length}/${currentQuotations.length} báo giá thành đơn`
          : 'Chưa có báo giá trong kỳ',
        route: '/quotationPaper',
        emptyState: !currentQuotations.length,
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
      { label: 'Đã xác nhận thu', value: this.rowsInRange(receipts, period.start, period.end).filter((row) => this.isTruthy(row?.isReceived)).length, color: '#0891b2', route: '/receiptV2' },
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
      pendingDelivery.length
        ? { label: 'Chờ giao hàng', value: this.formatNumber(pendingDelivery.length), note: 'phiếu cần theo dõi tiến độ', icon: 'fas fa-clock', tone: 'warning' as const, route: '/deliveryNote' }
        : null,
      debt > 0
        ? { label: 'Công nợ phiếu xuất', value: this.formatCurrencyCompact(debt), note: 'giá trị còn phải thu', icon: 'fas fa-triangle-exclamation', tone: 'danger' as const, route: '/deliveryNote' }
        : null,
      pendingReceipt.length
        ? { label: 'Phiếu thu chưa xác nhận', value: this.formatNumber(pendingReceipt.length), note: 'phiếu chưa đánh dấu đã thu', icon: 'fas fa-circle-info', tone: 'info' as const, route: '/receiptV2' }
        : null,
    ].filter((alert): alert is DashboardAlert => alert !== null);
  }

  private buildFinancialAnalysis(financial: FinancialMetrics): void {
    const operatingProfit = financial.grossProfit - financial.expense;
    const previousOperatingProfit = financial.previousGrossProfit - financial.previousExpense;
    this.financialPerformance = [
      this.createPerformanceRow('Doanh thu thuần', financial.revenue, financial.previousRevenue, true, '#3b82f6'),
      this.createPerformanceRow('Giá vốn', financial.cost, financial.previousCost, false, '#f97316'),
      this.createPerformanceRow('Lợi nhuận gộp', financial.grossProfit, financial.previousGrossProfit, true, '#10b981'),
      this.createPerformanceRow('Chi phí bán hàng & QLDN', financial.expense, financial.previousExpense, false, '#ef4444'),
      this.createPerformanceRow('Lợi nhuận từ HĐKD', operatingProfit, previousOperatingProfit, true, '#8b5cf6'),
      this.createPerformanceRow('Lãi / lỗ ròng', financial.netProfit, financial.previousNetProfit, true, '#06b6d4'),
    ];

    this.profitGauges = [
      {
        label: 'Biên lợi nhuận gộp',
        value: this.ratioPercent(financial.grossProfit, financial.revenue),
        benchmark: this.ratioPercent(financial.previousGrossProfit, financial.previousRevenue),
        color: '#10b981',
      },
      {
        label: 'Biên lợi nhuận HĐKD',
        value: this.ratioPercent(operatingProfit, financial.revenue),
        benchmark: this.ratioPercent(previousOperatingProfit, financial.previousRevenue),
        color: '#8b5cf6',
      },
      {
        label: 'Biên lợi nhuận ròng',
        value: this.ratioPercent(financial.netProfit, financial.revenue),
        benchmark: this.ratioPercent(financial.previousNetProfit, financial.previousRevenue),
        color: '#06b6d4',
      },
    ];
  }

  private buildDebtAging(deliveries: any[], period: DashboardPeriodRange): void {
    const currentDeliveries = this.rowsInRange(deliveries, period.start, period.end)
      .filter((row) => this.amountOf(row, ['debtAmount']) > 0);
    const definitions = [
      { label: '0–30 ngày', min: 0, max: 30, color: '#22c55e' },
      { label: '31–60 ngày', min: 31, max: 60, color: '#eab308' },
      { label: '61–90 ngày', min: 61, max: 90, color: '#f97316' },
      { label: 'Trên 90 ngày', min: 91, max: Number.POSITIVE_INFINITY, color: '#ef4444' },
    ];
    this.debtAging = definitions.map((definition) => {
      const rows = currentDeliveries.filter((row) => {
        const days = Math.max(this.parseNumeric(row?.overdueDays), 0);
        return days >= definition.min && days <= definition.max;
      });
      return {
        label: definition.label,
        amount: this.sumAmounts(rows, ['debtAmount']),
        count: rows.length,
        color: definition.color,
      };
    });
  }

  get maxPerformanceValue(): number {
    return Math.max(...this.financialPerformance.map((row) => Math.abs(row.current)), 1);
  }

  get maxDebtAgingAmount(): number {
    return Math.max(...this.debtAging.map((bucket) => bucket.amount), 1);
  }

  get totalDebtAging(): number {
    return this.debtAging.reduce((sum, bucket) => sum + bucket.amount, 0);
  }

  performanceWidth(value: number): number {
    return Math.max((Math.abs(value) / this.maxPerformanceValue) * 100, value ? 3 : 0);
  }

  debtAgingWidth(value: number): number {
    return Math.max((value / this.maxDebtAgingAmount) * 100, value ? 4 : 0);
  }

  gaugeProgress(value: number | null): number {
    if (value === null) return 0;
    return Math.min(Math.max(value, 0), 100);
  }

  private createPerformanceRow(
    label: string,
    current: number,
    previous: number,
    increaseIsFavorable: boolean,
    color: string,
  ): FinancialPerformanceRow {
    const trend = this.calculateTrendPercent(current, previous);
    return {
      label,
      current,
      previous,
      trend,
      favorable: increaseIsFavorable ? current >= previous : current <= previous,
      color,
    };
  }

  private ratioPercent(numerator: number, denominator: number): number | null {
    return denominator ? Number(((numerator / denominator) * 100).toFixed(1)) : null;
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
          label: `Tuần ${week}`,
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

  private calculateTrendPercent(current: number, previous: number): number | null {
    if (previous <= 0) return null;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  }

  private absoluteTrend(current: number, previous: number): number | null {
    const trend = this.calculateTrendPercent(current, previous);
    return trend === null ? null : Math.abs(trend);
  }

  formatPercent(value: number): string {
    return `${new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value)}%`;
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

  private extractFinancialMetrics(rows: Record<string, any>[]): FinancialMetrics {
    return {
      revenue: this.reportTotal(rows, 'dt_kn'),
      previousRevenue: this.reportTotal(rows, 'dt_ktr'),
      grossProfit: this.reportTotal(rows, 'loi_nhuan_kn'),
      previousGrossProfit: this.reportTotal(rows, 'loi_nhuan_ktr'),
      netProfit: this.reportTotal(rows, 'lai_lo_kn'),
      previousNetProfit: this.reportTotal(rows, 'lai_lo_ktr'),
      cost: this.reportTotal(rows, 'gv_kn'),
      previousCost: this.reportTotal(rows, 'gv_ktr'),
      expense: this.reportTotal(rows, 'cp_kn'),
      previousExpense: this.reportTotal(rows, 'cp_ktr'),
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
