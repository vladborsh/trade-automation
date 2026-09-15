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
    // architecture/scroll-back-freeze-diagnosis.md's real-data-buffer-depth follow-up: a
    // second mock server instance seeding `binance:BTCUSDT` far deeper than the default
    // (>= HISTORY_LIMIT's 1500 5m bars) so one e2e scenario can reproduce the zoom-floor
    // reachability bug against a comparable buffer depth, without touching the shallow
    // default the rest of the suite (and dev/CI's normal :4300 instance) relies on. The
    // e2e test that uses it re-points a single page's config.json fetch here via
    // page.route, never the shared public/config.json file.
    {
      command: 'npx tsx mock-server/server.ts',
      port: 4301,
      env: {
        MOCK_SERVER_PORT: '4301',
        MOCK_DEEP_HISTORY_INSTRUMENT: 'binance:BTCUSDT',
        MOCK_DEEP_HISTORY_MINUTES: '8000', // 1600 5m bars, sliced to HISTORY_LIMIT=1500
      },
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
