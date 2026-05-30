import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { DashboardService } from '../../services/dashboard.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  const dashboardServiceMock = {
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
    expect(dashboardServiceMock.loadQuotationList).toHaveBeenCalled();
    expect(dashboardServiceMock.loadOrderList).toHaveBeenCalled();
    expect(component.isLoading).toBeFalse();
  });

  it('should set errorMessage when API fails', () => {
    dashboardServiceMock.loadQuotationList.and.returnValue(
      throwError(() => new Error('network')),
    );

    component.refreshData();
    expect(component.errorMessage).toBe('Không thể tải dữ liệu dashboard.');
    expect(component.isLoading).toBeFalse();
  });
});
