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

export class OrderGridComponent {
  initData: GirdInitData = {

    id: "Order",
    title: "GRID.ORDER",

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
        "label": "POPUP.ORDER.VOUCHER_DATE",
        "type": "date"
      },
      {
        "key": "voucherNumber",
        "label": "POPUP.ORDER.VOUCHER_NUMBER",
        "type": "text"
      },
      {
        "key": "vcNumBG",
        "label": "POPUP.ORDER.VOUCHER_NUMBERBG",
        "type": "text"
      },
      {
        "key": "statusName",
        "label": "POPUP.ORDER.STATUS",
        "type": "text"
      },
      {
        "key": "customerID",
        "label": "POPUP.ORDER.CUSTOMER_ID",
        "type": "lookup"
      },
      {
        "key":"total_payment",
        "label": "GRID.total_amount",
        "type": "number"
      }
      
    ],
    query: {
      formId: {
        controller: "Order.page.json",
        formId: "Order",
        primaryKey: ["idGui"],
        type: "voucher",
        action: "loading",
        language: localStorage.getItem("language") ?? "vn",
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: "Z02",
        userId: localStorage.getItem("userId") ?? "",
        value: [],
        listTable: ["Order", "OrderDetail"],
        VCDate: "",
        isFileHandle: "export"
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
        controller: "contract",
        id: "contract.page.json",
        label: "Tạo hợp đồng",
        target: "contract/popup",
        color: "orange"
      },
      {
        controller: "deliveryNote",
        id: "deliveryNote.page.json",
        label: "Tạo phiếu xuất hàng",
        target: "deliveryNote/popup",
        color: "orange"
      },
      {
        controller: "poin",
        id: "poin.page.json",
        label: "Tạo đặt hàng nhập",
        target: "poin/popup",
        color: "orange"
      },
      {
        controller: "Order",
        id: "Order.page.json",
        label: "Chép dữ liệu",
        target: "order/popup",
        color: "orange",
        isCopy: true
      }
    ]
  }
}
