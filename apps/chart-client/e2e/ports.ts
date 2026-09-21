/**
 * e2e ports, from the environment so a worktree that cannot use the defaults (another slot's
 * client on :4200, another mock on :4300) runs the suite against its own servers without
 * touching public/config.json. Shared by playwright.config.ts and ./fixtures.
 *
 *   E2E_CLIENT_PORT  ng serve                      (default 4200)
 *   E2E_MOCK_PORT    default mock instance         (default 4300; MOCK_API_PORT is the old name)
 *                    +1: deep-history instance, +2: tail-gap instance, +3: frozen-feed instance
 */
export const CLIENT_PORT = Number(process.env['E2E_CLIENT_PORT'] ?? 4200);
export const MOCK_PORT = Number(process.env['E2E_MOCK_PORT'] ?? process.env['MOCK_API_PORT'] ?? 4300);
export const DEEP_HISTORY_MOCK_PORT = MOCK_PORT + 1;
export const TAIL_GAP_MOCK_PORT = MOCK_PORT + 2;
export const FROZEN_MOCK_PORT = MOCK_PORT + 3;
