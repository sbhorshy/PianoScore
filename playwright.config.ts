import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Headless by default; set to false for visual debugging
        headless: true,
      },
    },
  ],
  webServer: {
    reuseExistingServer: true,
    url: 'http://localhost:5173',
  },
})
