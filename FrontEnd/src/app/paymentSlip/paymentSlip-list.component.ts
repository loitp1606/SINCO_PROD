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

export class PaymentSlipGridComponent {
  initData: GirdInitData = {
    id: "paymentSlip",
    title:"Phiếu chi",
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
        "label": "Ngày phiếu chi",
        "type": "date"
      },
      {
        "key": "voucherNumber",
        "label": "Số phiếu",
        "type": "text"
      },
      {
        "key": "paymentType",
        "label": "Loại chi",
        "quickEditable": true,
        "type": "select"
      },
      {
        "key": "spentMoney",
        "label": "Đã chi tiền",
        "quickEditable": true,
        "type": "checkbox"
      },
      {
        "key": "supplierCode",
        "label": "Mã NCC",
        "type": "lookup"
      },
      {
        "key": "htttType",
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
        "key": "employeeCode",
        "label": "Nhân viên nhận tiền",
        "type": "text"
      },
      {
        "key": "cashier",
        "label": "Nhân viên chi",
        "type": "text"
      },
      {
        "key": "reason",
        "label": "Lý do chi",
        "type": "text"
      }, 
      {
        "key": "receiptCode",
        "label": "Phiếu nhập hàng",
        "type": "text"
      },
      {
        "key": "invoiceNumber",
        "label": "Số hóa đơn",
        "type": "text"
      },
      {
        "key": "total_amount",
        "label": "Số tiền chi",
        "type": "number",
        "currency": "VN"
      },
      {
        "key": "note",
        "label": "Ghi chú",
        "type": "text"
      }
    ],
    query: {
      formId: {
        controller: "paymentSlip.page.json",
        formId: "paymentSlip",
        primaryKey: ["idGui"],
        type: "voucher",
        action: "loading",
        language: localStorage.getItem("language") ?? "vn",
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: "Z06",
        userId: localStorage.getItem("userId") ?? "",
        value: [],
        listTable: ["paymentslip", "paymentslipDetail"],
        VCDate: "",
        isFileHandle: "both",
        enableTaxExcelExport: true
      },
    },
    sort: 'voucherDate desc',
    actions: [
    ]
  }
}
