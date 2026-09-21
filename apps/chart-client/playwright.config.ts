import { defineConfig } from '@playwright/test';
import { CLIENT_PORT, DEEP_HISTORY_MOCK_PORT, FROZEN_MOCK_PORT, MOCK_PORT, TAIL_GAP_MOCK_PORT } from './e2e/ports';

// Ports are overridable per worktree (E2E_CLIENT_PORT, E2E_MOCK_PORT) — see e2e/ports.ts.

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
  },
  webServer: [
    {
      command: 'npx tsx mock-server/server.ts',
      port: MOCK_PORT,
      // architecture/economic-calendar.md §7.2's synthetic notification defaults to a
      // dev-friendly "every few minutes" cadence; e2e needs the first one to land well
      // inside a single test's timeout, so it's sped up here only, the same way the
      // :4301 instance below overrides history depth for its own scenario.
      env: {
        MOCK_SERVER_PORT: String(MOCK_PORT),
        MOCK_APP_BASE_URL: `http://localhost:${CLIENT_PORT}`, // invite links point at this client
        MOCK_CALENDAR_NOTIFICATION_FIRST_DELAY_MS: '1000',
        MOCK_CALENDAR_NOTIFICATION_INTERVAL_MS: '10000',
      },
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
      port: DEEP_HISTORY_MOCK_PORT,
      env: {
        MOCK_SERVER_PORT: String(DEEP_HISTORY_MOCK_PORT),
        MOCK_DEEP_HISTORY_INSTRUMENT: 'binance:BTCUSDT',
        MOCK_DEEP_HISTORY_MINUTES: '8000', // 1600 5m bars, sliced to HISTORY_LIMIT=1500
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 20_000,
    },
    // architecture/panel-sync-and-oi-depth-diagnosis.md bug 3's "weekend case": a third mock
    // server instance where `capitalcom:DXY-MOCK`'s seeded history ends 1 hour (12 5m bars)
    // before the other instruments' — the shape of dxy's real Capital.com session gap — so one
    // e2e scenario can assert the right-edge-pan fix holds when a follower's own last bar is
    // genuinely earlier than the driver's, not just when every panel's data is current. The gap
    // must stay well inside lightweight-charts' right-offset cap (about one window of bars, ~39
    // here): the grid opens at the freshest data (BUG-007), which already puts dxy that far into
    // its own void. The live feed is off (BUG-007): the one test here compares ranges.
    {
      command: 'npx tsx mock-server/server.ts',
      port: TAIL_GAP_MOCK_PORT,
      env: {
        MOCK_SERVER_PORT: String(TAIL_GAP_MOCK_PORT),
        MOCK_TAIL_GAP_INSTRUMENT: 'capitalcom:DXY-MOCK',
        MOCK_TAIL_GAP_MINUTES: '60',
        MOCK_LIVE_FEED: 'off',
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 20_000,
    },
    // BUG-007: the default data with the live feed off, for the range-sync scenarios that compare
    // visible ranges before and after a gesture — a 5m bar closing mid-test shifts the window
    // (correctly) and made them flaky. Everything that needs live bars stays on :4300.
    {
      command: 'npx tsx mock-server/server.ts',
      port: FROZEN_MOCK_PORT,
      env: {
        MOCK_SERVER_PORT: String(FROZEN_MOCK_PORT),
        MOCK_LIVE_FEED: 'off',
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 20_000,
    },
    {
      command: `npx ng serve --port ${CLIENT_PORT}`,
      port: CLIENT_PORT,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
