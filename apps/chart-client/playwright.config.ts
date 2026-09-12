import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4200',
  },
  webServer: [
    {
      command: 'npx tsx mock-server/server.ts',
      port: 4300,
      reuseExistingServer: !process.env['CI'],
      timeout: 20_000,
    },
    {
      command: 'npx ng serve --port 4200',
      port: 4200,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
