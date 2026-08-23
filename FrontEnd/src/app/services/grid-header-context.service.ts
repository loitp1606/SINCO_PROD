import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type GridHeaderTimeFilterMode = 'period' | 'range';
export type GridHeaderPeriodMode = 'month' | 'quarter' | 'year';

export interface GridHeaderPeriodOption {
  value: string;
  label: string;
}

export interface GridHeaderTimeContext {
  filterMode: GridHeaderTimeFilterMode;
  periodMode: GridHeaderPeriodMode;
  selectedPeriodValue: string;
  periodOptions: GridHeaderPeriodOption[];
  dateFrom: string;
  dateTo: string;
  onFilterModeChange: (mode: GridHeaderTimeFilterMode) => void;
  onPeriodModeChange: (mode: GridHeaderPeriodMode) => void;
  onPeriodValueChange: (value: string) => void;
  onDateRangeChange: (dateFrom: string, dateTo: string) => void;
}

export interface GridHeaderColumnContext {
  key: string;
  label: string;
  visible: boolean;
  canHide: boolean;
}

export interface GridHeaderContext {
  ownerId: string;
  time?: GridHeaderTimeContext;
  columns: GridHeaderColumnContext[];
  onToggleColumn: (key: string) => void;
  onMoveColumn: (key: string, direction: -1 | 1) => void;
  onResetColumns: () => void;
}

@Injectable({ providedIn: 'root' })
export class GridHeaderContextService {
  private readonly contextSource = new BehaviorSubject<GridHeaderContext | null>(null);
  readonly context$ = this.contextSource.asObservable();

  setContext(context: GridHeaderContext): void {
    this.contextSource.next(context);
  }

  clearContext(ownerId: string): void {
    if (this.contextSource.value?.ownerId === ownerId) {
      this.contextSource.next(null);
    }
  }
}
