import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GirdInitData } from '../models';
import { DynamicGridComponent } from '../dynamic-gird/dynamic-grid.component';
import { TranslateModule } from '@ngx-translate/core'
@Component({
  selector: 'app-grid-master',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DynamicGridComponent,TranslateModule],
  templateUrl: '../dynamic-gird/dynamic-grid-parent.component.html',
})

export class ReceiptV2GridComponent {
  initData: GirdInitData = {
    id: "receiptV2",
    title: "Phiếu thu tiền",
    headers: [
      {
        "key": "idGui",
        "label": "ID",
        "type": "text",
        "hidden": true,
        "sortable": true
      },
      {
        "key": "voucherDate",
        "label": "Ngày",
        "type": "date"
      },
      {
        "key": "voucherNumber",
        "label": "Số phiếu",
        "type": "text"
      },
      {
        "key": "deliveryNoteNo",
        "label": "Mã tham chiếu",
        "type": "text"
      },
      {
        "key": "isReceived",
        "label": "Đã thu tiền",
        "quickEditable": true,
        "type": "checkbox"
      },
      {
        "key": "reason",
        "label": "Lý do thu",
        "type": "lookup"
      },
      {
        "key": "customerCode",
        "label": "Khách hàng",
        "type": "lookup"
      },
      {
        "key": "paymentType",
        "label": "Loại thanh toán",
        "type": "select",
        "options": [
							{
								"label": "Tiền mặt",
								"value": "TM"
							},
							{
								"label": "Chuyển khoản",
								"value": "CK"
							},
							{
								"label": "TM/CK",
								"value": "TM/CK"
							}
						]
      },
      {
        "key": "collectorCode",
        "label": "Nhân viên thu",
        "type": "lookup"
      },
      {
        "key": "accountReceiveCode",
        "label": "Số tài khoản",
        "type": "lookup"
      },
      {
        "key": "total_amount",
        "label": "Số tiền thu",
        "type": "number",
        "currency": "VN"
      }
    ],
    query: {
      formId: {
        controller: "receiptV2.page.json",
        formId: "receiptV2",
        primaryKey: ["idGui"],
        type: "voucher",
        action: "loading",
        language: localStorage.getItem("language") ?? "vn",
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: "Z07",
        userId: localStorage.getItem("userId") ?? "",
        value: [],
        listTable: ["receiptV2", "receiptdetailV2"],
        VCDate: "voucherDate",
        isFileHandle: "both",
        enableTaxExcelExport: true
      },
    },
    sort: 'voucherDate desc, voucherNumber desc',
    actions: []
  }
}

