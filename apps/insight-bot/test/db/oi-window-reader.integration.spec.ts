import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OiLsPoller, STREAM_ID } from '../../src/collectors/binance-perp/oi-ls.poller';
import { Writers } from '../../src/collectors/writers/batch-writer';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { MetricsService } from '../../src/ops/metrics.service';
import { StreamRegistry } from '../../src/ops/stream-registry';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import type { FuturesDataClient } from '../../src/venues/binance/futures-data.client';
import { OiWindowReader } from '../../src/insights/divergence/oi-window.reader';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-110 — the OI-window reader the chart and the alert loop share, against a real Postgres, on
 * IB-104's own scenario: XPT (a TradFi perp) misses two closed sessions; the second runs into a
 * universe-wide poller outage, which every crypto perp misses too. The ledger rows are the real
 * poller's (a boot backfill over a fake venue). The reader must call only the first closed session
 * «the venue did not publish» — the one the detector may step over — and keep every other gap a hole.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('oi-window-reader.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const SLOT = 5 * 60_000;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 20);
const LAST = Math.floor(NOW / SLOT) * SLOT - 3 * SLOT;
const FIRST = LAST - 288 * SLOT;
const CLOSED_A = [LAST - 200 * SLOT, LAST - 199 * SLOT];
const CLOSED_B = [LAST - 100 * SLOT, LAST - 99 * SLOT, LAST - 98 * SLOT];
const OUTAGE = [LAST - 97 * SLOT, LAST - 96 * SLOT];
const SYMBOLS = ['XPTUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

function venue() {
  return {
    async fetchBackward(q: { endpoint: string; symbol: string }) {
      const skip = new Set(q.symbol === 'XPTUSDT' ? [...CLOSED_A, ...CLOSED_B, ...OUTAGE] : OUTAGE);
      const rows: unknown[] = [];
      for (let ts = FIRST; ts <= LAST; ts += SLOT) {
        if (skip.has(ts)) continue;
        rows.push(q.endpoint === 'openInterestHist'
          ? { symbol: q.symbol, sumOpenInterest: '10', sumOpenInterestValue: '20', timestamp: ts }
          : q.endpoint === 'takerlongshortRatio'
            ? { buySellRatio: '1', buyVol: '1', sellVol: '1', timestamp: ts }
            : { symbol: q.symbol, longShortRatio: '1', longAccount: '0.5', shortAccount: '0.5', timestamp: ts });
      }
      return rows;
    },
    async fetchPage() { return []; },
  } as unknown as FuturesDataClient;
}

maybeDescribe('IB-110 OiWindowReader: stored OI over a window, and the venue’s silences in it', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let reader: OiWindowReader;
  const sec = (ms: number) => Math.floor(ms / 1000);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_oiwin', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await db.query('delete from alert_symbols', []); // the population is the four symbols below
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 40 * 86_400_000), new Date(NOW + 86_400_000));
    for (const s of SYMBOLS) {
      await db.query(`insert into symbols (id, base, quote, binance_perp, listed_perp, active) values ($1, $2, 'USDT', $1, '2026-01-30', true)`, [s, s.replace('USDT', '')]);
    }
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    const config = { symbols: SYMBOLS.map((s) => ({ binance_perp: s })), env: { get: () => undefined } } as never;
    await new OiLsPoller(config, db, new PartitionMaintenanceService(db), new Writers(db, metrics), new BinanceWeightTracker(), metrics, streams, venue())
      .backfill(NOW);
    reader = new OiWindowReader(db);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('XPT: every stored reading in (from, to], and ONLY the first closed session as the venue’s silence', async () => {
    const w = await reader.read('XPTUSDT', sec(FIRST), sec(LAST));
    const missing = new Set([...CLOSED_A, ...CLOSED_B, ...OUTAGE]);
    // (from, to]: FIRST itself belongs to the bar before the window and is not returned
    expect(w.oi5m.length).toBe(288 - [...missing].filter((t) => t > FIRST).length);
    expect(w.oi5m[0].time).toBe(sec(FIRST + SLOT));
    expect(w.oi5m.at(-1)!.time).toBe(sec(LAST));
    expect(w.oi5m.every((p) => p.oi === 10)).toBe(true);
    // CLOSED_B runs into the outage, so its window is ours as a whole (IB-104): a hole, not a silence
    expect(w.venueSilent).toEqual([{ from: sec(CLOSED_A[0]), to: sec(CLOSED_A[1]) }]);
  });

  it('a crypto perp: the outage is a hole on every symbol — no silence to step over', async () => {
    const w = await reader.read('BTCUSDT', sec(FIRST), sec(LAST));
    expect(w.venueSilent).toEqual([]);
    expect(w.oi5m.some((p) => p.time === sec(OUTAGE[0]))).toBe(false);
  });

  it('a window that misses the gaps returns none of them; a symbol we do not store returns nothing at all', async () => {
    const w = await reader.read('XPTUSDT', sec(LAST - 50 * SLOT), sec(LAST));
    expect(w.venueSilent).toEqual([]);
    expect(w.oi5m).toHaveLength(50);
    expect(await reader.read('TRXUSDT', sec(FIRST), sec(LAST))).toEqual({ oi5m: [], venueSilent: [] });
  });

  it('the population includes the enabled alert list: a listed coin with OI stored counts as a neighbour', async () => {
    // IB-104's rule is a SHARE: at least half of the OTHER collected symbols stored in every slot. XPT's closed
    // session has 3 (the crypto perps). Six enabled listed coins with no OI make 9 others, needing 5: the session is
    // then ours — so the listed coins are counted. Disabled, they are not, and it is the venue's again.
    await db.query(`insert into alert_symbols (symbol, base) values ('AAAUSDT','AAA'),('BBBUSDT','BBB'),('CCCUSDT','CCC'),('DDDUSDT','DDD'),('EEEUSDT','EEE'),('FFFUSDT','FFF')`, []);
    expect((await reader.read('XPTUSDT', sec(FIRST), sec(LAST))).venueSilent).toEqual([]);
    await db.query(`update alert_symbols set enabled = false`, []);
    expect((await reader.read('XPTUSDT', sec(FIRST), sec(LAST))).venueSilent).toEqual([{ from: sec(CLOSED_A[0]), to: sec(CLOSED_A[1]) }]);
    await db.query('delete from alert_symbols', []);
  });
});
