import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DynamicGridComponent } from '../dynamic-gird/dynamic-grid.component';
import { GirdInitData } from '../models';

@Component({
  selector: 'app-grid-master',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DynamicGridComponent],
  templateUrl: '../dynamic-gird/dynamic-grid-parent.component.html',
})
export class CompanyGridComponent {
  // Fully driven by BackEnd/Server/Controllers/Browser/company.list.json
  initData = {
    id: 'company',
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
