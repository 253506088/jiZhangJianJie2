import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const tempDirectory = fileURLToPath(new URL('./.tools/test-tmp/', import.meta.url));
mkdirSync(tempDirectory, { recursive: true });
process.env.TEMP = tempDirectory;
process.env.TMP = tempDirectory;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  workers: 1,
  fullyParallel: false,
  outputDir: '.tools/e2e-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
