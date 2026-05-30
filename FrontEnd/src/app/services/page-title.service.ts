import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class PageTitleService {
  private readonly titleSubject = new BehaviorSubject<string>('');
  readonly title$ = this.titleSubject.asObservable();
  private readonly appName = 'Sinco';
  private rawTitle = '';

  constructor(
    private readonly browserTitle: Title,
    private readonly translate: TranslateService,
  ) {
    this.applyBrowserTitle('');
    this.translate.onLangChange.subscribe(() => {
      this.applyBrowserTitle(this.rawTitle);
    });
  }

  setTitle(title: string): void {
    this.rawTitle = title || '';
    this.applyBrowserTitle(this.rawTitle);
  }

  clearTitle(): void {
    this.rawTitle = '';
    this.applyBrowserTitle('');
  }

  private applyBrowserTitle(title: string): void {
    const trimmedTitle = (title || '').trim();
    const translatedTitle = trimmedTitle
      ? this.translate.instant(trimmedTitle)
      : '';
    const finalTitle =
      translatedTitle && translatedTitle !== trimmedTitle
        ? translatedTitle
        : trimmedTitle;

    this.titleSubject.next(finalTitle);
    this.browserTitle.setTitle(
      finalTitle ? `${finalTitle} | ${this.appName}` : this.appName,
    );
  }
}
