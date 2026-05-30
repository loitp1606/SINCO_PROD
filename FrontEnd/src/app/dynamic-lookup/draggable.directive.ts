import { Directive, ElementRef, HostListener } from '@angular/core';

@Directive({
  selector: '[appDraggable]',
  standalone: true,
})
export class DraggableDirective {
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private initialX = 0;
  private initialY = 0;

  constructor(private el: ElementRef) {
    const element = this.el.nativeElement as HTMLElement;
    element.style.position = 'absolute';
    element.style.cursor = 'move';
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    const target = event.target as HTMLElement;

    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
      return;
    }
    this.isDragging = true;
    this.startX = event.clientX - this.initialX;
    this.startY = event.clientY - this.initialY;
    event.preventDefault();
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    this.isDragging = false;
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isDragging) return;

    this.initialX = event.clientX - this.startX;
    this.initialY = event.clientY - this.startY;

    const element = this.el.nativeElement as HTMLElement;
    element.style.transform = `translate(${this.initialX}px, ${this.initialY}px)`;
  }
}
