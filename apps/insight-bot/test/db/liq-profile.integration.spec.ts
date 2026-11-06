import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { foldProfile, groupRows, profileGrid, type LiqProfilePrint } from '@trade-automation/contracts';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { BINANCE_LIQUIDATION_STREAM } from '../../src/collectors/uptime/liquidation-streams';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { LiqProfileController } from '../../src/web/series/liq-profile.controller';
import { LiqProfileService } from '../../src/web/series/liq-profile.service';
import { DB_HOOK_TIMEOUT_MS, dropOwn, dropLeftovers, scratchPrefix } from './scratch-db';

/**
 * IB-153 — the liquidation profile banded IN POSTGRES, against a real database.
 *
 * What a fake cannot check: that the SQL bands EVERY print of the window (not the 50 largest the old
 * table showed), that its `numeric` floor puts an edge print where the contract's `bandOf` does, and
 * that each venue's rows are matched on that venue's own spelling only.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('liq-profile.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 3); // Tue 3 Nov 2026
const FROM = T0;
const TO = T0 + 24 * HOUR;
const NOW = TO + HOUR;
const LO = 76_200;
const HI = 78_100; // step 50

const venues = ['binance', 'bybit', 'okx'] as const;
const spelling = { binance: 'BTCUSDT', bybit: 'BTCUSDT', okx: 'BTC-USDT-SWAP' } as const;

/** 600 small prints across the view, 5 large ones: what a top-N would see is only the large. */
function tape(): Array<LiqProfilePrint & { ms: number }> {
  const rows: Array<LiqProfilePrint & { ms: number }> = [];
  for (let i = 0; i < 600; i++) {
    rows.push({
      ms: FROM + i * 60_000, price: 76_300 + ((i * 37) % 1_700), side: i % 3 === 0 ? 'long' : 'short',
      venue: venues[i % 2]!, usd: 500 + (i % 7) * 100, // binance and bybit only: okx stays silent
    });
  }
  for (let i = 0; i < 5; i++) rows.push({ ms: FROM + HOUR + i * 1_000, price: 77_600 + i * 20, side: 'short', venue: 'binance', usd: 300_000 + i });
  // exactly on an edge: belongs to the band above (77 700 / 50 = 1554)
  rows.push({ ms: FROM + 2 * HOUR, price: 77_700, side: 'long', venue: 'bybit', usd: 1_234 });
  // far outside the cover: counted above / below, never dropped
  rows.push({ ms: FROM + 3 * HOUR, price: 95_000, side: 'short', venue: 'bybit', usd: 77 });
  rows.push({ ms: FROM + 3 * HOUR + 1, price: 40_000, side: 'long', venue: 'binance', usd: 55 });
  return rows;
}

const row = (venue: string, symbol: string, ms: number, side: 'long' | 'short', price: number, notional: number): t.LiquidationRow =>
  ({ venue, symbol, ts: new Date(ms), side, price, qty: notional / price, notional, source: 'ws' });

maybeDescribe('IB-153 liquidation profile against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let controller: LiqProfileController;
  const prints = tape();

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_liqprofile', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(FROM - HOUR), new Date(TO + HOUR));

    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap, listed_perp, in_signal_set, active, volume_rank)
       values ('BTCUSDT', 'BTC', 'USDT', 'BTCUSDT', 'BTCUSDT', 'BTCUSDT', 'BTC-USDT-SWAP', '2020-01-01', true, true, 1),
              ('PEPEUSDT', 'PEPE', 'USDT', '1000PEPEUSDT', null, 'PEPEUSDT', null, '2020-01-01', true, true, 2)`,
      [],
    );
    const liq = new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
    await liq.write([
      ...prints.map((p) => row(p.venue, spelling[p.venue as keyof typeof spelling], p.ms, p.side, p.price, p.usd)),
      // the spelling trap: a Binance row under OKX's spelling of BTC, and another coin's row
      row('binance', 'BTC-USDT-SWAP', FROM + 5 * HOUR, 'long', 77_000, 999_999),
      row('binance', 'ETHUSDT', FROM + 5 * HOUR, 'long', 77_000, 888_888),
      // outside the time window, both ends ([from, to): `to` itself is out)
      row('binance', 'BTCUSDT', FROM - 1, 'long', 77_000, 4_444),
      row('binance', 'BTCUSDT', TO, 'long', 77_000, 3_333),
      // a sub-cent coin on Bybit only: the step's decimal text must reach numeric intact
      row('bybit', 'PEPEUSDT', FROM + HOUR, 'short', 0.0000125, 10),
      row('bybit', 'PEPEUSDT', FROM + HOUR + 1, 'short', 0.00001249, 20),
    ]);
    // the Binance collector listened through the whole window; Bybit's has no heartbeat; OKX's listened throughout
    await db.query(
      `insert into collector_heartbeats (stream, venue, first_seen_at, last_seen_at) values
         ($1, 'binance', $2, $3), ('okx:liquidation-orders', 'okx', $2, $3)`,
      [BINANCE_LIQUIDATION_STREAM, new Date(FROM - HOUR), new Date(NOW)],
    );
    controller = new LiqProfileController(db, new LiqProfileService(db, () => NOW));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('bands EVERY print of the window: the totals are the tape\'s, not a top-N\'s', async () => {
    const answer = await controller.profile('BTCUSDT', String(FROM), String(TO), String(LO), String(HI));
    const sum = (side: 'long' | 'short') =>
      answer.bands.reduce((s, b) => s + b[side].usd, 0) + answer.above[side].usd + answer.below[side].usd;
    const tapeSum = (side: 'long' | 'short') => prints.filter((p) => p.side === side).reduce((s, p) => s + p.usd, 0);
    expect(sum('long')).toBeCloseTo(tapeSum('long'), 4);
    expect(sum('short')).toBeCloseTo(tapeSum('short'), 4);
    const count = answer.bands.reduce((s, b) => s + b.long.count + b.short.count, 0)
      + answer.above.long.count + answer.above.short.count + answer.below.long.count + answer.below.short.count;
    expect(count).toBe(prints.length);
    // and the 50 largest would not have added up — the property this spec exists to keep
    const top50 = [...prints].sort((a, b) => b.usd - a.usd).slice(0, 50);
    expect(top50.reduce((s, p) => s + p.usd, 0)).toBeLessThan(tapeSum('long') + tapeSum('short') - 1);
  });

  it('the SQL bands match the contract\'s in-memory twin band for band, edges included', async () => {
    const answer = await controller.profile('BTCUSDT', String(FROM), String(TO), String(LO), String(HI));
    const grid = profileGrid(LO, HI);
    const expected = foldProfile(groupRows(prints, grid.step), grid);
    expect(answer.step).toBe(50);
    expect(answer.bands.map((b) => [b.band, Math.round(b.long.usd), Math.round(b.short.usd), b.long.count + b.short.count]))
      .toEqual(expected.bands.map((b) => [b.band, Math.round(b.long.usd), Math.round(b.short.usd), b.long.count + b.short.count]));
    const edge = answer.bands.find((b) => b.band === 1554)!;
    expect(edge.venues.find((v) => v.venue === 'bybit')!.longUsd).toBeGreaterThanOrEqual(1_234);
    expect(answer.above).toEqual({ long: { usd: 0, count: 0 }, short: { usd: 77, count: 1 } });
    expect(answer.below).toEqual({ long: { usd: 55, count: 1 }, short: { usd: 0, count: 0 } });
  });

  it('matches each venue on its own spelling only, and says which venues were listening', async () => {
    const answer = await controller.profile('BTCUSDT', String(FROM), String(TO), String(LO), String(HI));
    const binanceLong = answer.bands.reduce((s, b) => s + (b.venues.find((v) => v.venue === 'binance')?.longUsd ?? 0), 0) + answer.below.long.usd;
    expect(binanceLong).toBeLessThan(999_999); // the Binance row under OKX's spelling is not BTC's
    expect(answer.venues).toEqual([
      { venue: 'binance', state: 'recorded' },
      { venue: 'bybit', state: 'recorded' },
      { venue: 'okx', state: 'no_events' }, // listened the whole window, nothing came: a real $0
    ]);
    expect(answer.undercounted).toBe(true);
  });

  it('a sub-cent coin: the step reaches SQL as its decimal text; a venue without the coin says so', async () => {
    const answer = await controller.profile('PEPEUSDT', String(FROM), String(TO), '0.000005', '0.000015');
    expect(answer.step).toBe(2.5e-7);
    const total = answer.bands.reduce((s, b) => s + b.short.usd, 0);
    expect(total).toBeCloseTo(30, 6);
    expect(answer.bands.find((b) => b.band === 50)?.short.usd).toBeCloseTo(10, 6); // 0.0000125 / 2.5e-7 = 50: on the edge, the band above
    expect(answer.bands.find((b) => b.band === 49)?.short.usd).toBeCloseTo(20, 6);
    expect(answer.venues).toEqual([
      { venue: 'binance', state: 'no_events' }, // listed, listening, silent
      { venue: 'bybit', state: 'recorded' },
      { venue: 'okx', state: 'not_listed' },
    ]);
  });

  it('an unknown coin is empty, every venue not listed — not an error', async () => {
    const answer = await controller.profile('NOPEUSDT', String(FROM), String(TO), String(LO), String(HI));
    expect(answer.bands).toEqual([]);
    expect(answer.venues.map((v) => v.state)).toEqual(['not_listed', 'not_listed', 'not_listed']);
  });
});
