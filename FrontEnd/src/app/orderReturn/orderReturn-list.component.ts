import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GirdInitData } from '../models';
import { DynamicGridComponent } from '../dynamic-gird/dynamic-grid.component';

@Component({
  selector: 'app-grid-master',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DynamicGridComponent],
  templateUrl: '../dynamic-gird/dynamic-grid-parent.component.html',
})
export class OrderReturnGridComponent {
  initData: GirdInitData = {
    id: 'OrderReturn',
    title: 'Phiếu xuất trả hàng',
    headers: [
      {
        key: 'idGui',
        label: 'ID',
        type: 'text',
        hidden: true,
        sortable: true,
      },
      {
        key: 'voucherDate',
        label: 'Ngày xuất',
        type: 'date',
      },
      {
        key: 'voucherNumber',
        label: 'Số phiếu xuất trả',
        type: 'text',
      },
      {
        key: 'customerCode',
        label: 'Khách hàng',
        type: 'lookup',
      },
      {
        key: 'status',
        label: 'Trạng thái',
        type: 'text',
      },
      {
        key: 'note',
        label: 'Ghi chú',
        type: 'text',
      },
      {
        "key":"totalPayment",
        "label": "GRID.total_amount",
        "type": "number"
      }
    ],
    query: {
      formId: {
        controller: 'orderReturn.page.json',
        formId: 'orderReturn',
        primaryKey: ['idGui'],
        type: 'voucher',
        action: 'loading',
        language: localStorage.getItem('language') ?? 'vn',
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: 'Z09',
        userId: localStorage.getItem('userId') ?? '',
        value: [],
        listTable: ['orderReturn', 'orderReturnDetail'],
        VCDate: '',
        isFileHandle: 'export',
      },
    },
    sort: 'voucherDate desc',
     ui: {
      summary: {
        field: 'totalPayment',
        label: 'Tổng tiền',
        format: 'number',
      },
    },
    actions: [],
  };
}
