import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DynamicReportComponent } from '../dynamic-report/dynamic-report.component';

@Component({
  selector: 'app-dynamic-screen-report',
  standalone: true,
  imports: [CommonModule, DynamicReportComponent],
  template: `<app-report
    *ngIf="controller"
    [controller]="controller"
  ></app-report>`,
})
export class DynamicScreenReportComponent implements OnInit {
  controller = '';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const screenId = (params.get('screenId') || '').trim();
      this.controller = screenId ? `${screenId}.json` : '';
    });
  }
}
