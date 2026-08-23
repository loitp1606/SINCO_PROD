import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { DashboardService } from '../../services/dashboard.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  const dashboardServiceMock = {
    loadBcdtlnReport: jasmine
      .createSpy('loadBcdtlnReport')
      .and.returnValue(of([])),
    loadQuotationList: jasmine
      .createSpy('loadQuotationList')
      .and.returnValue(of({ data: [], total: 0 })),
    loadOrderList: jasmine
      .createSpy('loadOrderList')
      .and.returnValue(of({ data: [], total: 0 })),
    loadDeliveryNoteList: jasmine
      .createSpy('loadDeliveryNoteList')
      .and.returnValue(of({ data: [], total: 0 })),
    loadReceiptList: jasmine
      .createSpy('loadReceiptList')
      .and.returnValue(of({ data: [], total: 0 })),
  };

  const routerMock = {
    navigate: jasmine.createSpy('navigate'),
  };

  beforeEach(async () => {
    localStorage.setItem('token', 'test-token');
    dashboardServiceMock.loadBcdtlnReport.and.returnValue(of([]));
    dashboardServiceMock.loadQuotationList.and.returnValue(of({ data: [], total: 0 }));
    dashboardServiceMock.loadOrderList.and.returnValue(of({ data: [], total: 0 }));
    dashboardServiceMock.loadDeliveryNoteList.and.returnValue(of({ data: [], total: 0 }));
    dashboardServiceMock.loadReceiptList.and.returnValue(of({ data: [], total: 0 }));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: DashboardService, useValue: dashboardServiceMock },
        { provide: Router, useValue: routerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load real dashboard data via DashboardService', () => {
    expect(dashboardServiceMock.loadBcdtlnReport).toHaveBeenCalled();
    expect(dashboardServiceMock.loadQuotationList).toHaveBeenCalled();
    expect(dashboardServiceMock.loadOrderList).toHaveBeenCalled();
    expect(component.isLoading).toBeFalse();
  });

  it('should set errorMessage when API fails', () => {
    dashboardServiceMock.loadQuotationList.and.returnValue(
      throwError(() => new Error('network')),
    );

    component.refreshData();
    expect(component.errorMessage).toContain('1 nguồn dữ liệu chưa tải được');
    expect(component.isLoading).toBeFalse();
  });

  it('should not calculate a misleading trend when the previous value is zero', () => {
    expect((component as any).calculateTrendPercent(100, 0)).toBeNull();
    expect((component as any).calculateTrendPercent(0, 0)).toBeNull();
  });

  it('should not calculate a relative trend from a negative previous value', () => {
    expect((component as any).calculateTrendPercent(50, -20)).toBeNull();
  });

  it('should keep report net profit but mark margins unavailable when revenue is zero', () => {
    dashboardServiceMock.loadBcdtlnReport.and.returnValue(of([{
      dien_giai: 'Tổng cộng',
      dt_kn: 0,
      loi_nhuan_kn: 0,
      lai_lo_kn: 500000,
    }]));

    component.refreshData();

    expect(component.financialHighlights.revenue).toBe(0);
    expect(component.financialHighlights.netProfit).toBe(500000);
    expect(component.financialHighlights.margin).toBeNull();
    expect(component.profitGauges.every((gauge) => gauge.value === null)).toBeTrue();
  });

  it('should show a clear empty state when there are no deliveries', () => {
    component.refreshData();

    const delivery = component.statistics.find((item) => item.title === 'Tiến độ giao hàng');
    expect(delivery?.value).toBe('Chưa phát sinh');
    expect(delivery?.trend).toBeNull();
    expect(delivery?.caption).toBe('Không có phiếu xuất trong kỳ');
  });

  it('should count and sum only confirmed receipts', () => {
    const year = component.selectedDate.getFullYear();
    const month = String(component.selectedDate.getMonth() + 1).padStart(2, '0');
    const voucherDate = `${year}-${month}-15`;
    dashboardServiceMock.loadReceiptList.and.returnValue(of({
      data: [
        { voucherDate, isReceived: false, total_amount: 100000 },
        { voucherDate, isReceived: true, total_amount: 250000 },
      ],
      total: 2,
    }));

    component.refreshData();

    const receipt = component.statistics.find((item) => item.title === 'Đã xác nhận thu');
    expect(receipt?.value).toContain('250.000');
    expect(receipt?.caption).toBe('1 phiếu đã xác nhận');
  });
});
