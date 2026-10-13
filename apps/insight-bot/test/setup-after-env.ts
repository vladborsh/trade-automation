import { installNetworkGuard } from './network-guard';

/**
 * DB integration specs get the same budget their own hooks already use.
 *
 * Jest's default is 5 s per test, which is not a budget for anything in `test/db/`: those specs
 * create a scratch database, run the whole migration chain, and do real DDL — `ensureAhead`
 * alone issues `create table` for every partitioned table x 4 months, 36 statements as of
 * IB-054, and some specs run it twice. The `beforeAll`/`afterAll` hooks in those files already
 * pass `DB_HOOK_TIMEOUT_MS` (60 s) for exactly this reason; the per-TEST budget was left at the
 * default and is the only part still on 5 s.
 *
 * Observed on 2026-10-12/13, three cold runs: `migration-002` timed out at 5 s with 4 busy
 * backends and again with 0, and `feature-pass` timed out with 0 — different specs, same cause,
 * one of them before the change that prompted this. So it is the budget, not a regression in
 * any one spec.
 *
 * 30 s rather than 60: high enough that real DDL under load never reaches it, low enough that a
 * genuine hang still fails the run rather than stalling it. Scoped to `test/db/` so a unit spec
 * that hangs still fails in five seconds, which is where that default earns its keep.
 */
const DB_SPEC_TIMEOUT_MS = 30_000;
if (/[\\/]test[\\/]db[\\/]/.test(expect.getState().testPath ?? '')) {
  jest.setTimeout(DB_SPEC_TIMEOUT_MS);
}

// BUG-008: fail the spec file that tried to reach the network, even when the code under test
// swallowed the refused connection (an adapter's retry loop, a logged fetch error).
const guard = installNetworkGuard();
let seen = 0;

beforeAll(() => {
  seen = guard.blocked.length;
});

afterAll(() => {
  expect({ blockedConnections: guard.blocked.slice(seen) }).toEqual({ blockedConnections: [] });
});
