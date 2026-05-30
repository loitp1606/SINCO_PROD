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

export class PoinGridComponent {
  initData: GirdInitData = {
    id: "poin",
    title:"Đơn đặt nhập hàng",
    headers: [
      {
        "key": "idGui",
        "label": "ID",
        "type": "text",
        hidden: true,
        "sortable": true
      },
      {
        "key": "voucherDate",
        "label": "Ngày tạo",
        "type": "date"
      },
      {
        "key": "voucherNumber",
        "label": "Số phiếu",
        "type": "text"
      },
      {
        "key": "vendorCode",
        "label": "Mã NCC",
        "type": "lookup"
      },
      {
        "key": "status",
        "label": "Trạng thái",
        "type": "select",
        "options": [
          {
            "label": "Lập chứng từ",
            "value": "0"
          },
          {
            "label": "Đặt hàng",
            "value": "1"
          }
        ]
      },
      {
        "key": "note",
        "label": "Ghi chú",
        "type": "text"
      },
      {
        "key":"total_payment",
        "label": "GRID.total_amount",
        "type": "number"
      }
    ],
    query: {
      formId: {
        controller: "poin.page.json",
        formId: "poin",
        primaryKey: ["idGui"],
        type: "voucher",
        action: "loading",
        language: localStorage.getItem("language") ?? "vn",
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: "Z03",
        userId: localStorage.getItem("userId") ?? "",
        value: [],
        listTable: ["poin", "poindetail"],
        VCDate: "",
        isFileHandle: "export",
        enableTaxExcelExport: true
      },
    },
    sort: 'voucherDate desc, voucherNumber desc',
    ui: {
      summary: {
        field: 'total_payment',
        label: 'Tổng tiền',
        format: 'number',
      },
    },
    actions: [
      {
        controller: "goodsReceipt",
        id: "goodsReceipt.page.json",
        label: "Tạo phiếu nhập hàng",
        target: "goodsReceipt/popup",
        color: "orange"
      }
    ]
  }
}
