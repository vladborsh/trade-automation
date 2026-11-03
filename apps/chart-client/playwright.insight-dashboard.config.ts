import { defineConfig } from '@playwright/test';

/**
 * IB-088 — the insight dashboard's own e2e (the default config serves the backtest SPA).
 *
 * The dashboard is served by `ng serve insight-dashboard`; every `/api/web/*` call is answered from
 * `e2e-insight-dashboard/fixtures/` (real responses captured from a slot bot), so the layout
 * assertions run on real-shaped data without a bot or a database. The live run against a slot is a
 * separate, manual step (the task report), not this suite.
 *
 * Port: `E2E_DASHBOARD_PORT`, default 4205 (the coordinator's dashboard port in AGENTS.md); a slot
 * passes its own (dev-3: 4235).
 */
export const DASHBOARD_PORT = Number(process.env['E2E_DASHBOARD_PORT'] ?? 4205);

export default defineConfig({
  testDir: './e2e-insight-dashboard',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: { baseURL: `http://localhost:${DASHBOARD_PORT}`, channel: 'chromium' },
  webServer: {
    command: `npx ng serve insight-dashboard --port ${DASHBOARD_PORT}`,
    port: DASHBOARD_PORT,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
