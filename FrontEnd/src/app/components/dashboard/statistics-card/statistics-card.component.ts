import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-statistics-card',
  templateUrl: './statistics-card.component.html',
  styleUrls: ['./statistics-card.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class StatisticsCardComponent {
  @Input() title: string = '';
  @Input() value: string | number = '';
  @Input() icon: string = '';
  @Input() trend: number | null = null;
  @Input() trendText: string = '';
  @Input() trendUp: boolean = true;
  @Input() color: string = '#007bff';
  @Input() caption: string = '';
  @Input() tooltip: string = '';
  @Input() emptyState: boolean = false;
  @Input() clickable: boolean = false;
  @Output() selected = new EventEmitter<void>();

  activate(): void {
    if (this.clickable) this.selected.emit();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (!this.clickable || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    this.selected.emit();
  }

  formatPercent(value: number): string {
    return `${new Intl.NumberFormat('vi-VN', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value)}%`;
  }
}
