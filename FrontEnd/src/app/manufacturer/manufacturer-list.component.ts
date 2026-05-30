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

export class manufacturerGridComponent {
  initData: GirdInitData = {
    id: "manufacturer",
    title:"Nhà sản xuất",
    headers: [
      {
        "key": "ma_nsx",
        "label": "Mã Nhà sản xuất",
        "type": "text",
        "sortable": true
      },
      {
        "key": "ten_nsx",
        "label": "Tên Nhà sản xuất (VN)",
        "type": "text"
      },
      {
        "key": "ten_nsx2",
        "label": "Tên khác",
        "type": "text"
      }, 
      {
        "key": "status",
        "label": "Trạng thái",
        "type": "text"
      }
    ],
    query: {
      formId: {
        controller: "manufacturer.page.json",
        formId: "nhasanxuat",
        primaryKey: ["ma_nsx"],
        type: "list",
        action: "loading",
        language: localStorage.getItem("language") ?? "vn",
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: "",
        userId: localStorage.getItem("userId") ?? "",
        value: [],
        listTable: ["nhasanxuat"],
        VCDate: ""
      },
    },
    sort: 'ma_nsx',
    actions: []
  }
}
