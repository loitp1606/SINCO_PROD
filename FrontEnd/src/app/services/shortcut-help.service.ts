import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ShortcutHelpService {
  private readonly toggleShortcutHelpSource = new Subject<void>();
  readonly toggleShortcutHelp$ = this.toggleShortcutHelpSource.asObservable();

  toggle(): void {
    this.toggleShortcutHelpSource.next();
  }
}
