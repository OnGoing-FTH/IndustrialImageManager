import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'electron.spec.ts',
  timeout: 30_000,
  reporter: 'line',
  webServer: { command: 'npm run dev:renderer -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
