import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DynamicPopupComponent } from '../dynamic-popup/dynamic-popup.component';

@Component({
  selector: 'app-dynamic-screen-popup',
  standalone: true,
  imports: [CommonModule, DynamicPopupComponent],
  template: `<app-popup *ngIf="id" [id]="id" [name]="name"></app-popup>`,
})
export class DynamicScreenPopupComponent implements OnInit {
  id = '';
  name = '';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.id = (params.get('screenId') || '').trim();
      this.name = this.id ? `${this.id}.page.json` : '';
    });
  }
}
