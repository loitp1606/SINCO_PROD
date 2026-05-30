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
export class GoodsReceiptGridComponent {
  initData: GirdInitData = {
    id: 'goodsReceipt',
    title: 'Phiếu nhập hàng',
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
        label: 'Ngày nhập hàng',
        type: 'date',
      },
      {
        key: 'voucherNumber',
        label: 'Số phiếu nhập hàng',
        type: 'text',
      },
      {
        key: 'supplierCode',
        label: 'Khách hàng',
        type: 'lookup',
      },
      {
        key: 'paidAmount',
        label: 'Đã thanh toán',
        type: 'number',
      },
      {
        key: 'debtAmount',
        label: 'Còn phải trả',
        type: 'number',
      },
      {
        "key":"totalPayment",
        "label": "GRID.total_amount",
        "type": "number"
      },
      {
        key: 'receiveStatus',
        label: 'TT nhận hàng',
        type: 'text',
      },
      {
        key: 'paymentStatus',
        label: 'TT thanh toán',
        type: 'text',
      },
      {
        key: 'note',
        label: 'Ghi chú',
        type: 'text',
      }
    ],
    query: {
      formId: {
        controller: 'goodsReceipt.page.json',
        formId: 'goodsReceipt',
        primaryKey: ['idGui'],
        type: 'voucher',
        action: 'loading',
        language: localStorage.getItem('language') ?? 'vn',
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: 'Z10',
        userId: localStorage.getItem('userId') ?? '',
        value: [],
        listTable: ['goodsReceipt', 'goodsReceiptDetail'],
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
    actions: [
      {
        controller: 'paymentSlip',
        id: 'paymentSlip.page.json',
        label: 'Tạo phiếu chi',
        target: 'paymentslip/popup',
        color: 'orange',
      },
      {
        controller: 'OrderReturn',
        id: 'orderReturn.page.json',
        label: 'Tạo phiếu xuất trả hàng',
        target: 'orderReturn/popup',
        color: 'orange',
      },
    ],
  };
}
