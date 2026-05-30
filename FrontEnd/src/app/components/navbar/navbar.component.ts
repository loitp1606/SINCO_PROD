import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { PageTitleService } from '../../services/page-title.service';
import { ShortcutHelpService } from '../../services/shortcut-help.service';
import { Subject, takeUntil } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit, OnDestroy {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() toggleCollapse = new EventEmitter<void>();

  isCollapsed = false;
  isAuthenticated = false;
  pageTitle = '';
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private router: Router,
    private pageTitleService: PageTitleService,
    private shortcutHelpService: ShortcutHelpService,
  ) {
    this.isAuthenticated = this.authService.isAuthenticated();
  }

  ngOnInit(): void {
    this.pageTitleService.title$
      .pipe(takeUntil(this.destroy$))
      .subscribe((title) => (this.pageTitle = title));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

  onToggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
    this.toggleCollapse.emit();
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  toggleShortcutHelp(): void {
    this.shortcutHelpService.toggle();
  }
} 
