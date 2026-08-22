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

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: true,
  imports: [CommonModule, StatisticsCardComponent, ChartCardComponent],
})
export class DashboardComponent implements OnInit {
  today = new Date();
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
    return `Tháng ${this.today.getMonth() + 1}/${this.today.getFullYear()}`;
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
    let failedSources = 0;
    const fallback = () => {
      failedSources += 1;
      return of({ data: [], total: 0 } as any);
    };

    forkJoin({
      bcdtln: this.dashboardService.loadBcdtlnReportCurrent().pipe(catchError(() => {
        failedSources += 1;
        return of([]);
      })),
      quotation: this.dashboardService.loadQuotationList().pipe(catchError(fallback)),
      order: this.dashboardService.loadOrderList().pipe(catchError(fallback)),
      deliveryNote: this.dashboardService.loadDeliveryNoteList().pipe(catchError(fallback)),
      receipt: this.dashboardService.loadReceiptList().pipe(catchError(fallback)),
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

        this.buildStatistics(quotationRows, orderRows, deliveryRows, receiptRows);
        this.buildCharts(orderRows, deliveryRows);
        this.buildFunnel(quotationRows, orderRows, deliveryRows, receiptRows);
        this.buildActivities(quotationRows, orderRows, deliveryRows, receiptRows);
        this.buildAlerts(deliveryRows, receiptRows);

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

  private buildStatistics(quotations: any[], orders: any[], deliveries: any[], receipts: any[]): void {
    const currentOrders = this.rowsByMonth(orders, 0);
    const previousOrders = this.rowsByMonth(orders, 1);
    const currentQuotations = this.rowsByMonth(quotations, 0);
    const previousQuotations = this.rowsByMonth(quotations, 1);
    const delivered = deliveries.filter((row) => String(row?.status) === '1').length;
    const pendingDelivery = deliveries.filter((row) => String(row?.status) === '0').length;
    const currentReceipts = this.rowsByMonth(receipts, 0);
    const collectedThisMonth = currentReceipts
      .filter((row) => this.isTruthy(row?.isReceived))
      .reduce((sum, row) => sum + this.amountOf(row, ['total_amount']), 0);
    const collectedPreviousMonth = this.rowsByMonth(receipts, 1)
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
        title: 'Đơn hàng tháng này',
        value: this.formatNumber(currentOrders.length),
        icon: 'fas fa-bag-shopping',
        trend: Math.abs(this.calculateTrendPercent(currentOrders.length, previousOrders.length)),
        trendText: 'so với tháng trước',
        trendUp: currentOrders.length >= previousOrders.length,
        color: '#7c3aed',
        caption: this.formatCurrencyVnd(this.sumAmounts(currentOrders, ['total_payment'])),
      },
      {
        title: 'Tiến độ giao hàng',
        value: `${delivered}/${deliveries.length}`,
        icon: 'fas fa-truck-fast',
        trend: deliveries.length ? Number(((delivered / deliveries.length) * 100).toFixed(1)) : 0,
        trendText: 'đã hoàn tất',
        trendUp: true,
        color: '#059669',
        caption: `${this.formatNumber(pendingDelivery)} phiếu đang chờ giao`,
      },
      {
        title: 'Đã thu trong tháng',
        value: this.formatCurrencyCompact(collectedThisMonth),
        icon: 'fas fa-wallet',
        trend: Math.abs(this.calculateTrendPercent(collectedThisMonth, collectedPreviousMonth)),
        trendText: 'so với tháng trước',
        trendUp: collectedThisMonth >= collectedPreviousMonth,
        color: '#0891b2',
        caption: `${this.formatNumber(currentReceipts.length)} phiếu thu`,
      },
      {
        title: 'Tỷ lệ chuyển đổi',
        value: `${conversion.toFixed(1)}%`,
        icon: 'fas fa-arrow-trend-up',
        trend: Math.abs(this.calculateTrendPercent(conversion, previousConversion)),
        trendText: 'so với tháng trước',
        trendUp: conversion >= previousConversion,
        color: '#ea580c',
        caption: `${currentOrders.length}/${currentQuotations.length} báo giá thành đơn`,
      },
    ];
  }

  private buildCharts(orders: any[], deliveries: any[]): void {
    const months = this.getLastMonths(6);
    const orderValues = months.map((month) => this.sumAmounts(
      orders.filter((row) => this.isSameMonth(row?.voucherDate, month.year, month.month)),
      ['total_payment'],
    ));
    const pending = deliveries.filter((row) => String(row?.status) === '0').length;
    const completed = deliveries.filter((row) => String(row?.status) === '1').length;
    const other = Math.max(deliveries.length - pending - completed, 0);

    this.charts = [
      {
        title: 'Giá trị đơn hàng', subtitle: 'Xu hướng 6 tháng gần nhất', type: 'line',
        data: orderValues, labels: months.map((month) => `T${month.month}`),
        color: '#2563eb', valueFormat: 'currency',
      },
      {
        title: 'Tình trạng giao hàng', subtitle: `${this.formatNumber(deliveries.length)} phiếu xuất`, type: 'pie',
        data: [completed, pending, other], labels: ['Đã giao', 'Đang chờ giao', 'Khác'],
        color: '#059669', valueFormat: 'number',
      },
    ];
  }

  private buildFunnel(quotations: any[], orders: any[], deliveries: any[], receipts: any[]): void {
    this.funnel = [
      { label: 'Báo giá', value: this.rowsByMonth(quotations, 0).length, color: '#2563eb', route: '/quotationPaper' },
      { label: 'Đơn hàng', value: this.rowsByMonth(orders, 0).length, color: '#7c3aed', route: '/order' },
      { label: 'Đã giao', value: this.rowsByMonth(deliveries, 0).filter((row) => String(row?.status) === '1').length, color: '#059669', route: '/deliveryNote' },
      { label: 'Đã thu', value: this.rowsByMonth(receipts, 0).filter((row) => this.isTruthy(row?.isReceived)).length, color: '#0891b2', route: '/receiptV2' },
    ];
  }

  private buildActivities(quotations: any[], orders: any[], deliveries: any[], receipts: any[]): void {
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
      ...mapRows(quotations, 'Báo giá', '/quotationPaper', 'fas fa-file-signature', '#2563eb', ['total_payment'], ['customerName', 'customerCode']),
      ...mapRows(orders, 'Đơn hàng', '/order', 'fas fa-bag-shopping', '#7c3aed', ['total_payment'], ['customerName', 'customerID']),
      ...mapRows(deliveries, 'Xuất hàng', '/deliveryNote', 'fas fa-truck-fast', '#059669', ['totalPayment'], ['customerName', 'customer_id']),
      ...mapRows(receipts, 'Phiếu thu', '/receiptV2', 'fas fa-wallet', '#0891b2', ['total_amount'], ['customerName', 'customerCode']),
    ].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0)).slice(0, 6);
  }

  private buildAlerts(deliveries: any[], receipts: any[]): void {
    const pendingDelivery = deliveries.filter((row) => String(row?.status) === '0');
    const debt = deliveries.reduce((sum, row) => sum + this.amountOf(row, ['debtAmount']), 0);
    const pendingReceipt = receipts.filter((row) => !this.isTruthy(row?.isReceived));
    this.alerts = [
      { label: 'Chờ giao hàng', value: this.formatNumber(pendingDelivery.length), note: 'phiếu cần theo dõi tiến độ', icon: 'fas fa-clock', tone: 'warning', route: '/deliveryNote' },
      { label: 'Công nợ phiếu xuất', value: this.formatCurrencyCompact(debt), note: 'giá trị còn phải thu', icon: 'fas fa-triangle-exclamation', tone: 'danger', route: '/deliveryNote' },
      { label: 'Phiếu thu chưa xác nhận', value: this.formatNumber(pendingReceipt.length), note: 'phiếu chưa đánh dấu đã thu', icon: 'fas fa-circle-info', tone: 'info', route: '/receiptV2' },
    ];
  }

  private rowsByMonth(rows: any[], monthOffset: number): any[] {
    return rows.filter((row) => this.isMonthOffset(row?.voucherDate, monthOffset));
  }

  private isMonthOffset(dateValue: string, monthOffset: number): boolean {
    const date = this.parseDate(dateValue);
    if (!date) return false;
    const target = new Date(this.today.getFullYear(), this.today.getMonth() - monthOffset, 1);
    return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
  }

  private isSameMonth(dateValue: string, year: number, month: number): boolean {
    const date = this.parseDate(dateValue);
    return !!date && date.getFullYear() === year && date.getMonth() + 1 === month;
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

  private getLastMonths(count: number): Array<{ year: number; month: number }> {
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(this.today.getFullYear(), this.today.getMonth() - (count - index - 1), 1);
      return { year: date.getFullYear(), month: date.getMonth() + 1 };
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
