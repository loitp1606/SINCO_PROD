import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-option-dialog',
  standalone: true,
  template: `
    <h2 mat-dialog-title>Chọn tùy chọn</h2>
    <mat-dialog-content>
      <mat-radio-group [(ngModel)]="selectedOption">
        <ng-container *ngFor="let key of optionKeys">
          <mat-radio-button [value]="key">{{ options[key] }}</mat-radio-button><br>
        </ng-container>
      </mat-radio-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Hủy</button>
      <button mat-button color="primary" (click)="onOk()">OK</button>
    </mat-dialog-actions>
  `,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatRadioModule,
    MatDialogModule
  ]
})
export class OptionDialogComponent {
  options: { [key: number]: string } = {};
  optionKeys: number[] = [];
  selectedOption: number | null = null;

  constructor(
    private dialogRef: MatDialogRef<OptionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { options: { [key: number]: string } }
  ) {
    this.options = data.options;
  }

  ngOnInit() {
    this.optionKeys = Object.keys(this.options).map(k => +k);
    if (this.optionKeys.length > 0) {
      this.selectedOption = this.optionKeys[0];
    }
  }

  onCancel() {
    this.dialogRef.close(null);
  }

  onOk() {
    this.dialogRef.close(this.selectedOption);
  }
}