import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { StatisticsCardComponent } from './statistics-card/statistics-card.component';
import { ChartCardComponent } from './chart-card/chart-card.component';
import { DashboardService } from '../../services/dashboard.service';
import { catchError, forkJoin, of } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    StatisticsCardComponent,
    ChartCardComponent
  ]
})
export class DashboardComponent implements OnInit {
  today: Date = new Date();
  errorMessage: string = '';
  isLoading: boolean = true;
  financialHighlights = {
    revenue: 0,
    profit: 0,
    margin: 0,
  };

  statistics = [
    {
      title: 'Tổng doanh thu',
      value: '$24,780',
      icon: 'fas fa-dollar-sign',
      trend: 12,
      trendText: 'so với tháng trước',
      trendUp: true,
      color: '#4CAF50'
    },
    {
      title: 'Số lượng đơn hàng',
      value: '1,234',
      icon: 'fas fa-shopping-cart',
      trend: 8,
      trendText: 'so với tháng trước',
      trendUp: true,
      color: '#2196F3'
    },
    {
      title: 'Khách hàng mới',
      value: '456',
      icon: 'fas fa-users',
      trend: 5,
      trendText: 'so với tháng trước',
      trendUp: true,
      color: '#FF9800'
    },
    {
      title: 'Tỷ lệ chuyển đổi',
      value: '3.2%',
      icon: 'fas fa-chart-line',
      trend: 2,
      trendText: 'so với tháng trước',
      trendUp: false,
      color: '#F44336'
    }
  ];

  charts = [
    {
      title: 'Doanh thu theo tháng',
      type: 'line',
      data: [65, 59, 80, 81, 56, 55, 40],
      labels: ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7'],
      color: '#4CAF50'
    },
    {
      title: 'Phân loại sản phẩm',
      type: 'pie',
      data: [300, 500, 100],
      labels: ['Điện thoại', 'Laptop', 'Phụ kiện'],
      color: '#2196F3'
    }
  ];

  constructor(
    private readonly router: Router,
    private readonly dashboardService: DashboardService,
  ) {}

  ngOnInit() {
    // Kiểm tra xem người dùng đã đăng nhập chưa
    const token = localStorage.getItem('token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    this.loadDashboardData();
  }

  refreshData() {
    this.loadDashboardData();
  }

  private loadDashboardData(): void {
    this.isLoading = true;
    this.errorMessage = '';

    forkJoin({
      bcdtln: this.dashboardService.loadBcdtlnReportCurrent().pipe(catchError(() => of([]))),
      quotation: this.dashboardService.loadQuotationList().pipe(
        catchError(() => of({ data: [], total: 0 } as any)),
      ),
      order: this.dashboardService.loadOrderList().pipe(
        catchError(() => of({ data: [], total: 0 } as any)),
      ),
      deliveryNote: this.dashboardService.loadDeliveryNoteList().pipe(
        catchError(() => of({ data: [], total: 0 } as any)),
      ),
      receipt: this.dashboardService.loadReceiptList().pipe(
        catchError(() => of({ data: [], total: 0 } as any)),
      ),
    }).subscribe({
      next: (data) => {
        const bcdtlnRows = data.bcdtln || [];
        const quotationRows = data.quotation?.data || [];
        const orderRows = data.order?.data || [];
        const deliveryRows = data.deliveryNote?.data || [];
        const receiptRows = data.receipt?.data || [];

        const financial = this.extractFinancialMetrics(bcdtlnRows);
        const currentMonthRevenue = this.sumRowsByMonth(quotationRows, 'total_amount', 0);
        const previousMonthRevenue = this.sumRowsByMonth(quotationRows, 'total_amount', 1);
        const revenueTrend = this.calculateTrendPercent(
          currentMonthRevenue,
          previousMonthRevenue,
        );

        this.financialHighlights = {
          revenue: currentMonthRevenue !== 0 ? currentMonthRevenue : financial.revenue,
          profit: financial.profit,
          margin:
            (currentMonthRevenue !== 0 ? currentMonthRevenue : financial.revenue) !== 0
              ? Number(
                  (
                    (financial.profit /
                      (currentMonthRevenue !== 0 ? currentMonthRevenue : financial.revenue)) *
                    100
                  ).toFixed(1),
                )
              : 0,
        };

        const kpiRevenue = this.financialHighlights.revenue;

        const currentMonthQuotation = this.countRowsByMonth(quotationRows, 0);
        const previousMonthQuotation = this.countRowsByMonth(quotationRows, 1);
        const currentMonthOrder = this.countRowsByMonth(orderRows, 0);
        const previousMonthOrder = this.countRowsByMonth(orderRows, 1);

        const orderTrend = this.calculateTrendPercent(
          currentMonthOrder,
          previousMonthOrder,
        );

        const newCustomerSet = new Set(
          quotationRows
            .filter((row: any) => this.isMonthOffset(row?.voucherDate, 0))
            .map((row: any) => row?.customerCode || row?.customer_id || row?.customerID)
            .filter((code: any) => !!code),
        );

        const previousCustomerSet = new Set(
          quotationRows
            .filter((row: any) => this.isMonthOffset(row?.voucherDate, 1))
            .map((row: any) => row?.customerCode || row?.customer_id || row?.customerID)
            .filter((code: any) => !!code),
        );

        const customerTrend = this.calculateTrendPercent(
          newCustomerSet.size,
          previousCustomerSet.size,
        );

        const conversionRate =
          quotationRows.length > 0
            ? (orderRows.length / quotationRows.length) * 100
            : 0;
        const previousConversionRate =
          previousMonthQuotation > 0
            ? (previousMonthOrder / previousMonthQuotation) * 100
            : 0;
        const conversionTrend = this.calculateTrendPercent(
          conversionRate,
          previousConversionRate,
        );

        this.statistics = [
          {
            title: 'Doanh thu tháng hiện tại',
            value: this.formatCurrencyVnd(kpiRevenue),
            icon: 'fas fa-dollar-sign',
            trend: Math.abs(revenueTrend),
            trendText: 'so với tháng trước',
            trendUp: revenueTrend >= 0,
            color: '#4CAF50',
          },
          {
            title: 'Số lượng đơn hàng',
            value: this.formatNumber(data.order?.total || orderRows.length),
            icon: 'fas fa-shopping-cart',
            trend: Math.abs(orderTrend),
            trendText: 'so với tháng trước',
            trendUp: orderTrend >= 0,
            color: '#2196F3',
          },
          {
            title: 'Khách hàng tháng này',
            value: this.formatNumber(newCustomerSet.size),
            icon: 'fas fa-users',
            trend: Math.abs(customerTrend),
            trendText: 'so với tháng trước',
            trendUp: customerTrend >= 0,
            color: '#FF9800',
          },
          {
            title: 'Lợi nhuận hiện tại',
            value: this.formatCurrencyVnd(this.financialHighlights.profit),
            icon: 'fas fa-chart-line',
            trend: Math.abs(conversionTrend),
            trendText: 'so với tháng trước',
            trendUp: conversionTrend >= 0,
            color: '#F44336',
          },
        ];

        const last7Months = this.getLastMonths(7);
        const quotationByMonth = last7Months.map((m) =>
          quotationRows.filter((row: any) =>
            this.isSameMonth(row?.voucherDate, m.year, m.month),
          ).length,
        );

        const statusMap = new Map<string, number>();
        quotationRows.forEach((row: any) => {
          const key = row?.status_name || row?.statusName || 'Khác';
          statusMap.set(key, (statusMap.get(key) || 0) + 1);
        });
        const statusEntries = Array.from(statusMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6);

        this.charts = [
          {
            title: 'Xu hướng báo giá theo tháng',
            type: 'line',
            data: quotationByMonth,
            labels: last7Months.map((m) => `T${m.month}/${String(m.year).slice(-2)}`),
            color: '#4CAF50',
          },
          {
            title: 'Trạng thái báo giá',
            type: 'pie',
            data: statusEntries.map((x) => x[1]),
            labels: statusEntries.map((x) => x[0]),
            color: '#2196F3',
          },
        ];

        // keep variables referenced to avoid any TS noUnused warnings in stricter configs
        void deliveryRows;
        void receiptRows;
      },
      complete: () => {
        this.isLoading = false;
      },
    });
  }

  private countRowsByMonth(rows: any[], monthOffset: number): number {
    return rows.filter((row) => this.isMonthOffset(row?.voucherDate, monthOffset)).length;
  }

  private sumRowsByMonth(rows: any[], amountField: string, monthOffset: number): number {
    return rows
      .filter((row) => this.isMonthOffset(row?.voucherDate, monthOffset))
      .reduce((sum, row) => sum + this.parseNumeric(row?.[amountField]), 0);
  }

  private isMonthOffset(dateValue: string, monthOffset: number): boolean {
    if (!dateValue) return false;
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return false;

    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth();
  }

  private isSameMonth(dateValue: string, year: number, month: number): boolean {
    if (!dateValue) return false;
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return false;
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  }

  private getLastMonths(count: number): Array<{ year: number; month: number }> {
    const result: Array<{ year: number; month: number }> = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    return result;
  }

  private calculateTrendPercent(current: number, previous: number): number {
    if (!previous && !current) return 0;
    if (!previous) return 100;
    return Number((((current - previous) / previous) * 100).toFixed(1));
  }

  formatCurrencyVnd(value: number): string {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('vi-VN').format(value || 0);
  }

  private parseNumeric(value: any): number {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return 0;
    const text = String(value)
      .replace(/[₫$€£¥]/g, '')
      .replace(/\s/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private extractFinancialMetrics(rows: Record<string, any>[]): {
    revenue: number;
    profit: number;
  } {
    if (!rows || rows.length === 0) {
      return { revenue: 0, profit: 0 };
    }

    const revenueKeyCandidates = [
      'doanh_thu',
      'doanhthu',
      'revenue',
      'tong_doanh_thu',
      'total_revenue',
      'gia_tri',
      'amount',
    ];
    const profitKeyCandidates = [
      'loi_nhuan',
      'loinhuan',
      'profit',
      'tong_loi_nhuan',
      'total_profit',
      'lai',
    ];

    const sampleKeys = Object.keys(rows[0] || {});
    const normalizedMap = new Map<string, string>();
    sampleKeys.forEach((k) => normalizedMap.set(this.normalizeKey(k), k));

    const resolveField = (candidates: string[]): string | null => {
      for (const c of candidates) {
        const match = normalizedMap.get(this.normalizeKey(c));
        if (match) return match;
      }
      return null;
    };

    const revenueField = resolveField(revenueKeyCandidates);
    const profitField = resolveField(profitKeyCandidates);

    const revenue = revenueField
      ? rows.reduce((sum, row) => sum + this.parseNumeric(row?.[revenueField]), 0)
      : 0;
    const profit = profitField
      ? rows.reduce((sum, row) => sum + this.parseNumeric(row?.[profitField]), 0)
      : 0;

    return { revenue, profit };
  }

  private normalizeKey(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
}
