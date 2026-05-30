import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { GirdInitData } from '../models';
import { DynamicGridComponent } from '../dynamic-gird/dynamic-grid.component';

@Component({
  selector: 'app-dynamic-screen-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DynamicGridComponent],
  templateUrl: '../dynamic-gird/dynamic-grid-parent.component.html',
})
export class DynamicScreenListComponent implements OnInit {
  initData = {
    id: '',
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

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const screenId = (params.get('screenId') || '').trim();
      this.initData = {
        ...this.initData,
        id: screenId,
      } as GirdInitData;
    });
  }
}
