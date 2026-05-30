const fs = require('fs');
const dotenv = require('dotenv');

const parsed = dotenv.config().parsed || {};
const env = { ...parsed };

const branding = {};
if (env.BRANDING_APP_NAME) branding.appName = env.BRANDING_APP_NAME;
if (env.BRANDING_SLOGAN) branding.slogan = env.BRANDING_SLOGAN;
if (env.BRANDING_LOGO_URL) branding.logoUrl = env.BRANDING_LOGO_URL;

const hasBranding = Object.keys(branding).length > 0;

const escapeTsString = (value) =>
  String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const content = `// Generated from .env
export const env = {
  API_URL: '${escapeTsString(env.API_URL)}',
  DEFAULT_LANGUAGE: '${escapeTsString(env.DEFAULT_LANGUAGE)}',
  UNIT: '${escapeTsString(env.UNIT)}'${hasBranding ? `,
  branding: {
    appName: '${escapeTsString(branding.appName)}',
    slogan: '${escapeTsString(branding.slogan)}',
    logoUrl: '${escapeTsString(branding.logoUrl)}'
  }` : ''}
};
`;

fs.writeFileSync('./src/environments/env.ts', content);
