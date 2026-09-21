/**
 * CLI entry point: `npm run backfill -- --instrument <id> [--from <iso>]`
 * (→ `node dist/jobs/backfill.js`). architecture/backtest-app-system-design.md §10, T-031.
 *
 * Backfills one instrument's 1m from its venue into the `CandleStore`, then runs
 * derive-timeframes for it. The instrument must be in `instruments.yaml`; ids are never
 * hardcoded.
 *
 * Venue budget: **Binance 1 request/s at limit 1500 = weight 10/s = 600 weight/min, 25 % of the
 * 2400/min budget.** Capital.com: 1 request/s at 720 bars, plus the session login, from the
 * 2024-01-02 intraday floor. See `VENUE_PAGING` in backfill.job.ts.
 *
 * Standalone: it does not boot Nest. It reads only the env (`CANDLE_STORE` / `FILE_STORE_ROOT` /
 * `S3_*`, `INSTRUMENTS_FILE`, `BINANCE_REST_BASE_URL`, `CAPITAL_COM_*`) and builds the same live
 * adapter the server builds. It does not read a `.env` file itself: export the Capital.com
 * credentials, or run `node --env-file=<file> dist/jobs/backfill.js …`. Output is one JSON line
 * per upserted day, then a summary line with the derive counts.
 */
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { validateEnv } from '../config/env.schema';
import { InstrumentsFileSchema } from '../config/instruments.schema';
import { buildLiveVenueAdapter } from '../market-data/venue-adapters.provider';
import { SYSTEM_CLOCK, backfillAndDerive, parseBackfillArgs } from './backfill.job';
import { buildCandleStore } from './candle-store.factory';

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const env = validateEnv(process.env);
  const instruments = InstrumentsFileSchema.parse(yaml.load(fs.readFileSync(env.INSTRUMENTS_FILE, 'utf8'))).instruments;
  const instrument = instruments.find((i) => i.id === args.instrument);
  if (!instrument) throw new Error(`--instrument ${args.instrument} is not in ${env.INSTRUMENTS_FILE}`);
  const adapter = buildLiveVenueAdapter(instrument.venue, env);
  if (!adapter) throw new Error(`no live adapter for venue ${instrument.venue}`);
  const store = buildCandleStore(env);

  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  const log = (line: Record<string, unknown>) => console.log(JSON.stringify(line));
  const { backfill, derived } = await backfillAndDerive(store, adapter, instrument, { fromMs: args.fromMs }, { clock: SYSTEM_CLOCK, log });
  log({ ...backfill, derived, ms: Date.now() - startedAt });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill failed:', err);
  process.exit(1);
});
