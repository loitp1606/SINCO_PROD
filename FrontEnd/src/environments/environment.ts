import { env } from './env';

const runtimeEnv = (window as any).__env || {};
type BrandingConfig = {
  appName?: string;
  slogan?: string;
  logoUrl?: string;
};

type EnvConfig = typeof env & {
  branding?: BrandingConfig;
};

const typedEnv = env as EnvConfig;
const defaultBranding = typedEnv.branding || {};
const runtimeBranding = runtimeEnv.branding || {};

export const environment = {
  production: false,
  apiUrl: runtimeEnv.API_URL || env.API_URL,
  defaultLanguage: runtimeEnv.DEFAULT_LANGUAGE || env.DEFAULT_LANGUAGE,
  supportedLanguages: ['vi', 'en'],
  currentLanguage: runtimeEnv.DEFAULT_LANGUAGE || env.DEFAULT_LANGUAGE,
  unit: runtimeEnv.UNIT || env.UNIT,
  branding: {
    ...defaultBranding,
    ...runtimeBranding,
  },
};
