import type { CapacitorConfig } from '@capacitor/cli';

const defaultUrl = 'http://localhost:3000';
const appUrl = (process.env.KORBIT_APP_URL || process.env.KORBIT_PUBLIC_WEB_URL || defaultUrl).trim();

const config: CapacitorConfig = {
  appId: 'com.korbit.mobile',
  appName: 'Korbit Mobile',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith('http://'),
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;

