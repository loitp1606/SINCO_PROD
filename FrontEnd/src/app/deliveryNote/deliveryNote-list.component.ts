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

export class DeliveryNoteGridComponent {
  initData: GirdInitData = {
    id: "deliveryNote",
    title:"Phiếu xuất hàng",
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
        "label": "Ngày xuất hàng",
        "type": "date",
        "width": "150px"
      },
      {
        "key": "voucherNumber",
        "label": "Số phiếu",
        "type": "text",
        "width": "150px"
      },
      {
        "key": "number_quotation",
        "label": "Số báo giá",
        "type": "text",
        "width": "150px"
      },
      {
        "key": "customer_id",
        "label": "Khách hàng",
        "type": "lookup"
      },
      {
        "key": "ds_hoa_don",
        "label": "Danh sách hóa đơn",
        "type": "text",
        "width": "150px"
      },
      {
        "key": "status_name",
        "label": "Trạng thái",
        "type": "text",
        "width": "180px"
      },
      {
        "key": "paymentStatus",
        "label": "TT thanh toán",
        "type": "text",
        "width": "160px"
      },
      {
        "key": "debtAmount",
        "label": "Còn nợ",
        "type": "number",
        "width": "120px"
      },
      {
        "key": "signReceiptStatus",
        "label": "TT ký nhận",
        "type": "text",
        "width": "170px"
      },
      {
        "key": "overdueDays",
        "label": "Ngày quá hạn",
        "type": "number"
      },
      {
        "key":"totalPayment",
        "label": "GRID.total_amount",
        "type": "number"
      },
      {
        "key": "note",
        "label": "Ghi chú",
        "type": "text"
      }
    ],
    query: {
        formId: {
        controller: "deliveryNote.page.json",
        formId: "deliveryNote",
        primaryKey: ["idGui"],
        type: "voucher",
        action: "loading",
        language: localStorage.getItem("language") ?? "vn",
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: "Z05",
        userId: localStorage.getItem("userId") ?? "",
        value: [],
        listTable: ["deliveryNote", "deliveryNoteDetail"],
        VCDate: "",
          isFileHandle: "export",//"import" | "export" | "both"
          enableTaxExcelExport: true,
        },
      },
    sort: 'voucherDate desc, voucherNumber desc',
    ui: {
      summary: {
        field: 'totalPayment',
        label: 'Tổng tiền',
        format: 'number',
      },
    },
    actions: [
      {
        controller: "receiptV2",
        id: "receiptV2.page.json",
        label: "Tạo phiếu thu",
        target: "receiptV2/popup",
        color: "orange"
      },
      {
        controller: "PurchaseReturnReceipt",
        id: "purchaseReturnReceipt.page.json",
        label: "Tạo nhập hàng trả lại",
        target: "purchaseReturnReceipt/popup",
        color: "orange"
      }
    ]
  }
}
