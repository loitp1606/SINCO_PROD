import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DynamicReportComponent } from '../dynamic-report/dynamic-report.component';

@Component({
  selector: 'app-grid-master',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DynamicReportComponent],
  templateUrl: '../dynamic-report/dynamic-report-parent.component.html',
})
export class ReportBcdtlnctComponent {
  controller: string = "bcdtlnct.json";
}
