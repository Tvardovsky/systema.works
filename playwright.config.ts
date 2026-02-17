import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3011',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3011',
    url: 'http://127.0.0.1:3011/en',
    timeout: 120000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: {...devices['Desktop Chrome']}
    },
    {
      name: 'mobile-chromium',
      use: {...devices['Pixel 7']}
    }
  ]
});
