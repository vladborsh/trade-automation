/**
 * BUG-020 — jest's timeout for the login-burst tests, derived rather than guessed.
 *
 * These tests fire a burst of wrong logins at the real `AuthService` with the real
 * `PasswordHasher`. They are slow for a reason that is the feature under test, not a defect:
 * BUG-005's throttle admits a bounded number of attempts and **those attempts pay for real
 * scrypt**. Jest's 5 s default is not enough for that on a loaded machine, which is how BUG-020
 * was found — `backtest-money-flow.e2e.spec.ts` failed with one login at **5,055 ms** at load
 * average 8–10, then passed 5/5 on rerun (dev-3's capture during IB-013,
 * `reports/dev3-logs/ib013r-db-FAILED-run1.txt`).
 *
 * The derivation:
 *
 * - scrypt runs at `DEFAULT_SCRYPT_PARAMS` (N = 2^15, r = 8, p = 1), needing 32 MiB per hash.
 *   **Measured on this machine, idle: ~48 ms per hash.**
 * - The throttle admits **10** attempts per email per window, and an unknown email still pays for
 *   one scrypt so the response time cannot reveal which emails exist (`auth.service.ts`). So a
 *   burst costs **at most 10 scrypts however large it is** — 60 requests and 200 requests do the
 *   same hashing work — plus one for the final real login each test makes.
 * - Node runs scrypt on the libuv threadpool, **4 wide by default**, so 11 hashes are ~3 waves:
 *   **~150–235 ms idle** (measured: 11 in parallel took 202 ms).
 * - Under the load that produced BUG-020, a single login took **5,055 ms — roughly 100× the idle
 *   hash.** Applying that stretch to 3 waves is ~15 s, before the burst's own HTTP round trips
 *   (up to 200 of them) and their Postgres work.
 *
 * 60 s therefore sits ~12× above the worst single observation and ~250× above the idle cost,
 * while still being far below anything that could pass for a hang. It matches
 * `DB_HOOK_TIMEOUT_MS`, which exists for the same reason on the same machine, and the value the
 * two `auth.integration.spec.ts` bursts already carried before this constant gave them a name.
 *
 * **This is a timeout, not a weaker assertion.** Every burst test still asserts exactly what
 * BUG-005 requires: the burst is answered in full, at most 10 attempts are evaluated (401) and
 * the rest are refused (429). Raising a timeout lets a slow machine finish the work; it does not
 * let the throttle off.
 */
export const LOGIN_BURST_TIMEOUT_MS = 60_000;
