/**
 * IB-028 — the live pass: the real three APIs, all four networks, into the slot's database.
 *
 * A RUNNER, not a spec, which is why it lives here and not under `test/` — jest only matches
 * `*.spec.ts`, so it never ran there, but a runner in the test tree invites someone to expect it to.
 *
 *   DATABASE_URL=postgres://localhost:5432/insight_dev3 LIVE_MINUTES=30 \
 *     npx ts-node -P tsconfig.json scripts/live-dex-pass.ts
 *
 * It drives `tick()` directly rather than booting Nest, so the run ends on its own and nothing else
 * in the app starts: the point is to exercise the three venues against real responses, which is a
 * merge prerequisite for this task and has found five defects that fixtures could not.
 *
 * **One instance at a time per slot.** Two would double the GeckoTerminal rate, and the whole
 * schedule is sized against a measured ~5 requests/minute ceiling.
 */
import { runMigrations } from '../src/db/migration-runner';
import { PartitionMaintenanceService } from '../src/db/partitions.service';
import { PgDatabase } from '../src/db/pg/pg-database';
import { DexService, TICK_MS } from '../src/dex/dex.service';

const url = process.env.DATABASE_URL as string;
const minutes = Number(process.env.LIVE_MINUTES ?? '25');

/**
 * A heartbeat, because a quiet log and a dead process look identical.
 *
 * The collector logs only when something happens, and over a day the gaps between GeckoTerminal
 * calls are long enough that "nothing for twenty minutes" is a plausible healthy state. A run whose
 * liveness cannot be told from its silence cannot be left for 24 hours.
 */
const HEARTBEAT_MS = 10 * 60_000;

async function main(): Promise<void> {
  await runMigrations({ connectionString: url });
  const db = new PgDatabase(url);
  // the months the run can reach. A 24-hour run crossing a month boundary into an unregistered
  // month would be refused by Postgres on every insert, which is why the range is explicit.
  await new PartitionMaintenanceService(db).ensureRange(new Date('2026-10-01Z'), new Date('2026-12-01Z'));
  const service = new DexService(db);
  const started = Date.now();
  const until = started + minutes * 60_000;
  let ticks = 0;
  let failures = 0;
  let lastBeat = started;

  // drive tick() directly rather than onApplicationBootstrap, so the run ends on its own
  while (Date.now() < until) {
    try {
      await service.tick();
    } catch (error) {
      // `tick` already swallows its own errors, so reaching here means something outside it
      // failed. Counted and continued: over a day, one bad minute must not end the run, and the
      // count is what tells a reader afterwards whether "it ran" means "it ran well".
      failures += 1;
      console.error(`tick ${ticks} threw — ${(error as Error).message}`);
    }
    ticks += 1;
    if (Date.now() - lastBeat >= HEARTBEAT_MS) {
      lastBeat = Date.now();
      const mins = Math.round((Date.now() - started) / 60_000);
      console.log(`heartbeat: ${mins} min elapsed, ${ticks} ticks, ${failures} failed`);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await db.end();
  console.log(`live pass finished: ${ticks} ticks over ${minutes} min, ${failures} failed`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
