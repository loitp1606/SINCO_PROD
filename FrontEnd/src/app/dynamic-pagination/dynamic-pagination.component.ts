import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
@Component({
    selector: 'app-dynamic-pagination',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './dynamic-pagination.component.html',
})
export class DynamicPaginationComponent {
    @Input() totalItems = 0;
    @Input() itemsPerPage = 10;
    @Input() currentPage = 1;
    @Input() pageSizeOptions: number[] = [10, 20, 50, 100];
    @Output() pageChange = new EventEmitter<number>();
    @Output() itemsPerPageChange = new EventEmitter<number>();

    get totalPages(): number {
        return Math.ceil(this.totalItems / this.itemsPerPage);
    }

    getPaginationRange(): number[] {
        const range: number[] = [];
        const delta = 2;

        if (this.totalPages <= 1) {
            return [1];
        }

        if (this.totalPages <= 5 || this.currentPage < 4) {
            const end = Math.min(this.totalPages, 5);
            for (let i = 1; i <= end; i++) {
                range.push(i);
            }
        } else if (this.currentPage > this.totalPages - delta) {
            const start = this.totalPages - 4;
            for (let i = start; i <= this.totalPages; i++) {
                range.push(i);
            }
        } else {
            for (
                let i = Math.max(1, this.currentPage - delta);
                i <= Math.min(this.totalPages, this.currentPage + delta);
                i++
            ) {
                range.push(i);
            }
        }

        return range;
    }

    handlePageClick(page: number): void {
        if (page !== this.currentPage) {
            this.pageChange.emit(page);
        }
    }

    handleItemsPerPageChange(value: string | number): void {
        const nextValue = Number(value);
        if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue === this.itemsPerPage) {
            return;
        }

        this.itemsPerPageChange.emit(nextValue);
    }
}
