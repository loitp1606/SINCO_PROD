import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationComponent } from '../notification/notification.component';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LayoutService } from '../../services/layout.service';
import { UnitService } from '../../services/unit.service';
import { NotificationService } from '../../services/notification.service';
import { UserLoginDto } from '../../models/user.model';
import { Unit } from '../../models/unit.model';
import { environment } from '../../../environments/environment';
import { TranslateService } from '@ngx-translate/core'

interface LanguageConfig {
  loginTitle: string;
  username: string;
  password: string;
  unit: string;
  loginButton: string;
  loggingIn: string;
  fillAllFields: string;
  incorrectCredentials: string;
  errorOccurred: string;
  selectUnit: string;
  loadingUnits: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, NotificationComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  username: string = '';
  password: string = '';
  selectedUnitCode: string = '';
  isLoading: boolean = false;
  isLoadingUnits: boolean = false;
  error: string = '';
  currentLanguage: string = environment.defaultLanguage;
  units: Unit[] = [];
  showForceLoginOption: boolean = false;
  forceLoginCredentials: UserLoginDto | null = null;

  private languageTexts: { [key: string]: LanguageConfig } = {
    vi: {
      loginTitle: 'Đăng nhập',
      username: 'Tên đăng nhập',
      password: 'Mật khẩu',
      unit: 'Đơn vị cơ sở',
      loginButton: 'Đăng nhập',
      loggingIn: 'Đang đăng nhập...',
      fillAllFields: 'Vui lòng nhập đầy đủ thông tin đăng nhập',
      incorrectCredentials: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
      errorOccurred: 'Có lỗi xảy ra. Vui lòng thử lại sau.',
      selectUnit: 'Chọn đơn vị',
      loadingUnits: 'Đang tải danh sách đơn vị...'
    },
    en: {
      loginTitle: 'Login',
      username: 'Username',
      password: 'Password',
      unit: 'Unit',
      loginButton: 'Login',
      loggingIn: 'Logging in...',
      fillAllFields: 'Please fill in all login information',
      incorrectCredentials: 'Username or password is incorrect.',
      errorOccurred: 'An error occurred. Please try again later.',
      selectUnit: 'Select unit',
      loadingUnits: 'Loading units...'
    }
  };

  constructor(
    private authService: AuthService,
    private router: Router,
    private layoutService: LayoutService,
    private unitService: UnitService,
    private notificationService: NotificationService,
    public translate: TranslateService,
  ) {
    this.translate.setDefaultLang(localStorage.getItem("language") ?? "vi")
  }

  ngOnInit() {
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
    this.layoutService.hideLayout();

    // Load saved language from localStorage or use environment default
    const savedLanguage = localStorage.getItem('language');
    if (savedLanguage && environment.supportedLanguages.includes(savedLanguage)) {
      this.currentLanguage = savedLanguage;
      environment.currentLanguage = savedLanguage; // Update environment variable
    } else {
      this.currentLanguage = environment.currentLanguage;
    }

    // Load units
    this.loadUnits();
  }

  ngOnDestroy() {
    this.layoutService.showLayout();
  }

  get translations(): LanguageConfig {
    return this.languageTexts[this.currentLanguage];
  }

  changeLanguage(language: string) {
    if (environment.supportedLanguages.includes(language)) {
      this.currentLanguage = language;
      environment.currentLanguage = language; // Update environment variable
      localStorage.setItem('language', language);
      this.translate.setDefaultLang(language)
      this.error = ''; // Clear error message when language changes
    }
  }

  loadUnits() {
    this.isLoadingUnits = true;
    this.unitService.getUnits().subscribe({
      next: (response) => {
        if (response.success) {
          this.units = response.data;
        } else {
          console.error('Failed to load units:', response.message);
        }
        this.isLoadingUnits = false;
      },
      error: (err) => {
        console.error('Error loading units:', err);
        this.isLoadingUnits = false;
      }
    });
  }

  async onSubmit() {
    if (!this.username || !this.password || !this.selectedUnitCode) {
      this.error = this.translations.fillAllFields;
      return;
    }

    this.isLoading = true;
    this.error = '';

    try {
      const credentials: UserLoginDto = {
        userName: this.username,
        password: this.password,
        unit: this.selectedUnitCode
      };

      this.authService.login(credentials).subscribe({
        next: (response) => {
          if (response.success) {
            if (response.data) {
              localStorage.setItem('userId', response.data.userId.toString());
              localStorage.setItem('userName', response.data.userName);
              localStorage.setItem('token', response.data.token);
              if (response.data.sessionId) {
                localStorage.setItem('sessionId', response.data.sessionId);
              }
            }

            this.router.navigate(['/dashboard']);
          } else {
            // Xử lý lỗi đăng nhập
            this.error = response.message || this.translations.incorrectCredentials;
            
            // Hiển thị lựa chọn force login cho trường hợp session đã tồn tại
            if (response.message && response.message.includes('đã được đăng nhập ở thiết bị khác')) {
              this.showForceLoginOption = true;
              this.forceLoginCredentials = credentials;
              this.notificationService.warning('Tài khoản đã được đăng nhập ở thiết bị khác. Bạn có muốn đăng xuất thiết bị khác và đăng nhập tại đây?', 15000);
            }
            
            this.isLoading = false;
          }
        },
        error: (err) => {
          this.error = this.translations.incorrectCredentials;
          this.isLoading = false;
        }
      });
    } catch (err) {
      this.error = this.translations.errorOccurred;
      this.isLoading = false;
    }
  }

  async forceLogin() {
    if (!this.forceLoginCredentials) {
      return;
    }

    this.isLoading = true;
    this.error = '';

    try {
      // Gọi API force logout trước
      this.authService.forceLogoutPrevious(this.forceLoginCredentials).subscribe({
        next: (response) => {
          if (response.success) {
            // Sau khi force logout thành công, thử đăng nhập lại
            setTimeout(() => {
              this.onSubmit();
            }, 1000);
          } else {
            this.error = response.message || 'Không thể đăng xuất thiết bị khác';
            this.isLoading = false;
          }
        },
        error: (err) => {
          this.error = 'Lỗi khi đăng xuất thiết bị khác';
          this.isLoading = false;
        }
      });
    } catch (err) {
      this.error = 'Có lỗi xảy ra';
      this.isLoading = false;
    }
  }

  cancelForceLogin() {
    this.showForceLoginOption = false;
    this.forceLoginCredentials = null;
    this.error = '';
  }
}