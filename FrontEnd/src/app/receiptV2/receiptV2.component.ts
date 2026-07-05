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
  // Fully driven by BackEnd/Server/Controllers/Browser/receiptV2.list.json
  initData = {
    id: 'receiptV2',
    headers: [],
    query: {
      formId: {
        controller: '',
        formId: '',
        primaryKey: [],
        value: [],
        type: '',
        action: '',
        language: localStorage.getItem('language') ?? 'vi',
        unit: localStorage.getItem('unit') ?? 'CTY',
        idVC: '',
        userId: localStorage.getItem('userId') ?? '',
        VCDate: '',
        listTable: [],
      },
    },
    sort: '',
    actions: [],
  } as GirdInitData;
}
