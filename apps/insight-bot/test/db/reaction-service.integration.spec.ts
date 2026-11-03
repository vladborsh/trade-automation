import { randomUUID } from 'crypto';
import { Client } from 'pg';
import type { BinanceRestKline } from '@trade-automation/binance-client';
import type { AppConfigService } from '../../src/config/config.service';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { ReactionService } from '../../src/news/reaction.service';
import { MAX_VENUE_CALLS_PER_PASS } from '../../src/news/reaction-prices';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import type { PerpRest } from '../../src/venues/binance/perp.rest';
import { WEIGHT_CEILING_1M } from '../../src/web/market/universe-summary.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-027 / IB-097 — the reaction job end to end: real Postgres for the news rows, a stub Binance
 * klines client for the price (storage ruling S8: on-demand klines, not `candles_1m`).
 *
 * **Positive control (IB-027 rule).** A job that refuses everything would pass every refusal test,
 * so the first case MUST produce a number.
 *
 * The stub behaves like `/fapi/v1/klines`: bars with open time in `[startTime, endTime]`, oldest
 * first, at most `limit`, including the bar still forming. Options make it disagree with the
 * implementation where IB-097 says it must: a one-minute hole, extra bars past `endTime`, an error.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('reaction-service.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;
const LATER = DAY + 10 * 3_600_000; // well past every horizon of a story at DAY + 10m
/** The canonical id and Binance's spelling deliberately differ, so a request by the id is caught. */
const config = { symbols: [{ id: 'BTCUSDT', binance_perp: 'BTCUSDT_PERP_SPELLING' }] } as unknown as AppConfigService;

const priceAt = (openTime: number) => 100 * 1.001 ** ((openTime - DAY) / MIN);

interface StubOptions {
  /** Minutes (since DAY) the venue omits. */
  holes?: number[];
  /** Ignore endTime and return this many extra bars after it, priced absurdly. */
  extraAfterEnd?: number;
  fail?: boolean;
}

function stubPerp(opts: StubOptions = {}) {
  const calls: Array<{ symbol: string; startTime: number; endTime: number; limit: number }> = [];
  const perp = {
    klinesRange: async (symbol: string, startTime: number, endTime: number, limit: number): Promise<BinanceRestKline[]> => {
      calls.push({ symbol, startTime, endTime, limit });
      if (opts.fail) throw new Error('Binance REST /fapi/v1/klines failed: 503 Service Unavailable');
      const rows: BinanceRestKline[] = [];
      const last = endTime + (opts.extraAfterEnd ?? 0) * MIN;
      for (let t = startTime; t <= last && rows.length < limit + (opts.extraAfterEnd ?? 0); t += MIN) {
        if (opts.holes?.includes((t - DAY) / MIN)) continue;
        const close = t > endTime ? 999_999 : priceAt(t);
        rows.push([t, String(close), String(close), String(close), String(close), '1', t + MIN - 1, '1', 1, '0.5', '0.5', '0']);
      }
      return rows;
    },
  };
  return { perp: perp as unknown as PerpRest, calls };
}

maybeDescribe('IB-097 reaction job: Postgres for news, on-demand Binance klines for the price', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_rxjob', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const story = async (id: string, at: number) => {
    await db.query(
      `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
       values ($1,'decrypt',$2,'BTC moves',$3,$3,$4,$5)`,
      [id, `https://x/${id}`, new Date(at), `u-${id}`, `t-${id}`],
    );
    await db.query(`insert into news_assets (news_id, symbol, via, matched) values ($1,'BTCUSDT','ticker','BTC')`, [id]);
  };
  const reset = async () => {
    await db.query('delete from news_reactions', []);
    await db.query('delete from news_assets', []);
    await db.query('delete from raw_news', []);
  };
  const row = async (id: string, horizon: string) =>
    (await db.query<{ return_pct: number | null; refused: string | null; venue: string; market: string; symbol_spelling: string; anchor: string; of_window_items: number }>(
      `select return_pct, refused, venue, market, symbol_spelling, anchor, of_window_items
         from news_reactions where news_id = $1 and horizon = $2`, [id, horizon],
    ))[0];
  const service = (perp: PerpRest, weight = new BinanceWeightTracker()) => new ReactionService(db, perp, weight, config);

  beforeEach(reset);

  it('measures a closed window from the venue\'s klines — the positive control, all three horizons', async () => {
    await story('n1', DAY + 10 * MIN);
    const { perp, calls } = stubPerp();
    const pass = await service(perp).tick(LATER);

    for (const [h, minutes] of [['15m', 15], ['1h', 60], ['4h', 240]] as const) {
      const r = await row('n1', h);
      expect(r.refused).toBeNull();
      expect(Number(r.return_pct)).toBeCloseTo((1.001 ** minutes - 1) * 100, 6);
      // the row says where the price came from, and the spelling is the venue's, not the canonical id
      expect([r.venue, r.market, r.symbol_spelling, r.anchor]).toEqual(['binance', 'perp', 'BTCUSDT_PERP_SPELLING', 'first_seen']);
      expect(Number(r.of_window_items)).toBe(1);
    }
    // one call per measurement, by the venue's spelling, shaped as IB-097 states
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.symbol === 'BTCUSDT_PERP_SPELLING')).toBe(true);
    expect(calls[0]).toEqual({ symbol: 'BTCUSDT_PERP_SPELLING', startTime: DAY + 10 * MIN, endTime: DAY + 25 * MIN, limit: 16 });
    expect(pass).toMatchObject({ venueCalls: 3, venueWeight: 4, measured: 3, refused: 0 });
  });

  it('an open window costs no call: refused window_not_closed, then REPLACED once it closes', async () => {
    await story('n1', DAY + 10 * MIN);
    const { perp, calls } = stubPerp();

    await service(perp).tick(DAY + 15 * MIN); // every horizon still open
    expect((await row('n1', '15m')).refused).toBe('window_not_closed');
    expect(calls).toHaveLength(0);

    await service(perp).tick(LATER);
    const closed = await row('n1', '15m');
    expect(closed.refused).toBeNull();
    expect(Number(closed.return_pct)).toBeGreaterThan(0);
  });

  it('a one-minute hole in the venue\'s answer → window_not_covered, scoped to the window that contains it', async () => {
    await story('n1', DAY + 10 * MIN);
    // minute 30: inside the 1h window (10 → 70), outside the 15m one (10 → 25)
    const { perp } = stubPerp({ holes: [30] });
    await service(perp).tick(LATER);
    expect((await row('n1', '1h')).refused).toBe('window_not_covered');
    expect((await row('n1', '1h')).return_pct).toBeNull();
    expect((await row('n1', '15m')).refused).toBeNull();
  });

  it('bars the venue returns past window.to are never the horizon price', async () => {
    await story('n1', DAY + 10 * MIN);
    const { perp } = stubPerp({ extraAfterEnd: 5 }); // priced 999 999 — would be a +1e6 % "reaction"
    await service(perp).tick(LATER);
    expect(Number((await row('n1', '15m')).return_pct)).toBeCloseTo((1.001 ** 15 - 1) * 100, 6);
  });

  it('the bar still forming at window.to is not used; with it gone the horizon falls back to the bar before it', async () => {
    await story('n1', DAY + 10 * MIN);
    const { perp } = stubPerp();
    // window.to = DAY+25m; now is 20 s later, so the 25m bar is still forming
    await service(perp).tick(DAY + 25 * MIN + 20_000);
    expect(Number((await row('n1', '15m')).return_pct)).toBeCloseTo((1.001 ** 14 - 1) * 100, 6);
  });

  it('a venue error writes NO row, and the next pass asks again and measures', async () => {
    await story('n1', DAY + 10 * MIN);
    const failing = stubPerp({ fail: true });
    const pass = await service(failing.perp).tick(LATER);
    expect(pass?.deferred.venueError).toBe(3);
    const rows = await db.query<{ n: number }>(`select count(*)::int n from news_reactions where news_id = 'n1'`, []);
    expect(rows[0].n).toBe(0); // not a permanent refusal — nothing at all

    const ok = stubPerp();
    await service(ok.perp).tick(LATER + 5 * MIN);
    expect(ok.calls).toHaveLength(3);
    expect((await row('n1', '4h')).refused).toBeNull();
  });

  it(`101 pending measurements → ${MAX_VENUE_CALLS_PER_PASS} calls in the pass; the rest wait, unwritten`, async () => {
    // 101 stories, each tagged once; only the 15m horizon is closed at `now`, so 101 measurements
    for (let i = 0; i < 101; i++) await story(`s${i}`, DAY + i * 1000);
    const now = DAY + 101 * 1000 + 16 * MIN; // past every 15m window, before any 1h one closes
    const { perp, calls } = stubPerp();
    const pass = await service(perp).tick(now);
    expect(calls).toHaveLength(MAX_VENUE_CALLS_PER_PASS);
    expect(pass?.deferred.callCap).toBe(1);
    const measured = await db.query<{ n: number }>(`select count(*)::int n from news_reactions where horizon = '15m' and refused is null`, []);
    expect(measured[0].n).toBe(100);
    const written = await db.query<{ n: number }>(`select count(*)::int n from news_reactions where horizon = '15m'`, []);
    expect(written[0].n).toBe(100); // the 101st has no row, so it stays pending

    const next = stubPerp();
    await service(next.perp).tick(now + 5 * MIN);
    expect(next.calls).toHaveLength(1);
  }, 60_000);

  it('above the shared weight ceiling the venue is not asked and nothing is written', async () => {
    await story('n1', DAY + 10 * MIN);
    const weight = new BinanceWeightTracker();
    weight.recordHeader(WEIGHT_CEILING_1M + 1);
    const { perp, calls } = stubPerp();
    const pass = await service(perp, weight).tick(LATER);
    expect(calls).toHaveLength(0);
    expect(pass?.deferred.weightCeiling).toBe(3);
    const rows = await db.query<{ n: number }>(`select count(*)::int n from news_reactions`, []);
    expect(rows[0].n).toBe(0);
  });

  it('records each call\'s documented weight on the shared tracker', async () => {
    await story('n1', DAY + 10 * MIN);
    const weight = new BinanceWeightTracker();
    await service(stubPerp().perp, weight).tick(LATER);
    expect(weight.used1m()).toBe(4); // 1 (15m) + 1 (1h) + 2 (4h)
  });

  it('a stale story and a symbol with no spelling refuse without asking the venue', async () => {
    // published 8 days before we saw it → stale_at_ingest
    await db.query(
      `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
       values ('old','decrypt','https://x/old','BTC',$1,$2,'u-old','t-old')`,
      [new Date(DAY - 8 * 86_400_000), new Date(DAY + 10 * MIN)],
    );
    await db.query(`insert into news_assets (news_id, symbol, via, matched) values ('old','BTCUSDT','ticker','BTC')`, []);
    await db.query(
      `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
       values ('eth','decrypt','https://x/eth','ETH',$1,$1,'u-eth','t-eth')`,
      [new Date(DAY + 10 * MIN)],
    );
    await db.query(`insert into news_assets (news_id, symbol, via, matched) values ('eth','ETHUSDT','ticker','ETH')`, []);
    const { perp, calls } = stubPerp();
    await service(perp).tick(LATER);
    expect(calls).toHaveLength(0);
    expect((await row('old', '1h')).refused).toBe('stale_at_ingest');
    expect((await row('eth', '1h')).refused).toBe('no_venue_spelling');
  });
});
