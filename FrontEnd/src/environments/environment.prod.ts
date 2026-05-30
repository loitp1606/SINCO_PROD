const runtimeEnv = (window as any).__env || {};
const defaultBranding = {
  appName: 'ERP SYSTEM',
  slogan: 'Enterprise Resource Planning',
  logoUrl: 'assets/logo/erp-logo-dark.svg',
};
const runtimeBranding = runtimeEnv.branding || {};

export const environment = {
  production: true,
  apiUrl: runtimeEnv.API_URL || 'https://103.146.22.235:5001',
  defaultLanguage: runtimeEnv.DEFAULT_LANGUAGE || 'vi',
  supportedLanguages: ['vi', 'en'], // Danh sách ngôn ngữ được hỗ trợ
  currentLanguage: runtimeEnv.DEFAULT_LANGUAGE || 'vi',
  unit: runtimeEnv.UNIT || 'CTY',
  branding: {
    ...defaultBranding,
    ...runtimeBranding,
  },
};
