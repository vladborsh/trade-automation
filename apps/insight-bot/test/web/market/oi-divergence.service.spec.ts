import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OI_DIVERGENCE_DEFAULT_PARAMS, WebOiDivergenceSeriesResponseSchema, type WebOiDivergenceSeriesResponse } from '@trade-automation/contracts';
import type { Db, DbHandle } from '../../../src/db/db.port';
import { TtlCache } from '../../../src/venues/ttl-cache';
import { OI_DIVERGENCE_15M_SPAN_MS, OiDivergenceService } from '../../../src/web/market/oi-divergence.service';

/**
 * IB-110 (V11) — the chart's divergence lines, against fakes of its reads, on the real ETHUSDT 1h fixture
 * (IB-109's positive control): what it reads (stored OI or the venue's), what it caches, which bars it
 * keeps, whose params it uses, and which lines it marks as sent.
 */
interface Fixture { bars: Array<{ time: number; open: number; high: number; low: number; close: number }>; oi5m: Array<{ time: number; oi: number }>;
  expected: { direction: string; aTime: number; bTime: number } }
const F: Fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'oi-divergence-ethusdt-1h-bullish.json'), 'utf8'));
const LAST_CLOSE = F.bars[F.bars.length - 1].time + 3600;
const NOW = (LAST_CLOSE + 7 * 60) * 1000; // 7 minutes into the forming bar

class FakeDb implements Db {
  params: unknown = OI_DIVERGENCE_DEFAULT_PARAMS;
  stored = true;
  fired: Array<{ direction: string; a_time: Date; b_time: Date; fired_at: Date }> = [];
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    if (sql.includes('from alert_settings')) return [{ params: this.params }] as T[];
    if (sql.includes('min(ts) as first')) return [{ first: this.stored ? new Date(F.oi5m[0].time * 1000) : null }] as T[];
    if (sql.includes('select ts, oi_base from open_interest_5m')) {
      const [, , from, to] = params as [string, string, Date, Date];
      return F.oi5m.filter((p) => p.time * 1000 > from.getTime() && p.time * 1000 <= to.getTime())
        .map((p) => ({ ts: new Date(p.time * 1000), oi_base: String(p.oi) })) as T[];
    }
    if (sql.includes('from oi_divergence_alerts')) return this.fired as T[];
    return [] as T[]; // the gap ledger and the population: none here
  }
  async transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function build(now = NOW) {
  const db = new FakeDb();
  const asked: Array<{ fromMs: number; toMs: number; tf: string }> = [];
  const venue: string[] = [];
  const forming = { time: LAST_CLOSE, open: 1, high: 1, low: 0.5, close: 1, volume: 1 }; // a crashing forming bar: must be ignored
  const candles = { candles: async (_m: string, _s: string, tf: string, fromMs: number, toMs: number) => {
    asked.push({ fromMs, toMs, tf });
    return [...F.bars.map((b) => ({ ...b, volume: 1 })), forming];
  } };
  const client = { fetchBackward: async (q: { endpoint: string; symbol: string; period: string }) => {
    venue.push(`${q.endpoint}:${q.period}`);
    return F.oi5m.map((p) => ({ timestamp: p.time * 1000, sumOpenInterest: String(p.oi) }));
  } };
  const clock = { now };
  const service = new OiDivergenceService({ db, candles: candles as never, client: client as never, cache: new TtlCache({ now: () => clock.now }), now: () => clock.now });
  return { db, service, asked, venue, clock };
}
const theLine = (r: WebOiDivergenceSeriesResponse) => r.lines.filter((l) => l.a.time === F.expected.aTime && l.b.time === F.expected.bTime);

describe('OiDivergenceService.series (IB-110, V11)', () => {
  it('a stored coin: the fixture’s divergence, from our OI, with the venue never asked; the answer parses', async () => {
    const { service, venue } = build();
    const r = await service.series('ETHUSDT', '1h');
    expect(WebOiDivergenceSeriesResponseSchema.safeParse(r).success).toBe(true);
    expect(theLine(r)).toHaveLength(1);
    expect(theLine(r)[0]).toMatchObject({ direction: 'bullish', repeat: null, firedAt: null });
    expect(venue).toEqual([]);
    expect(r.to).toBe(LAST_CLOSE); // the forming bar is not a bar yet
    expect(r.params).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
  });

  it('only CLOSED bars: the forming bar’s crash wick (low 0.5) makes no pivot', async () => {
    const r = await build().service.series('ETHUSDT', '1h');
    expect(r.lines.every((l) => l.b.price > 1)).toBe(true);
  });

  it('a coin we do not store: the venue’s 5 m OI (one walk, cached 15 minutes), same lines', async () => {
    const { db, service, venue, clock } = build();
    db.stored = false;
    const r = await service.series('TRXUSDT', '1h');
    expect(venue).toEqual(['openInterestHist:5m']);
    expect(theLine(r)).toHaveLength(1); // same data, same detector, same line
    clock.now = NOW + 10 * 60_000; // another TF ten minutes later: computed afresh, the venue's OI still cached
    await service.series('TRXUSDT', '4h');
    expect(venue).toHaveLength(1);
    clock.now = NOW + 16 * 60_000; // past the 15 minutes: asked again
    await service.series('TRXUSDT', '15m');
    expect(venue).toHaveLength(2);
  });

  it('cached for one bar: the same bar answers from cache, the next bar recomputes', async () => {
    const { service, asked, clock } = build();
    await service.series('ETHUSDT', '1h');
    clock.now = NOW + 30 * 60_000;
    await service.series('ETHUSDT', '1h');
    expect(asked).toHaveLength(1);
    clock.now = NOW + 60 * 60_000;
    await service.series('ETHUSDT', '1h');
    expect(asked).toHaveLength(2);
  });

  it('15m is capped at the last 90 days, whatever the stored history', async () => {
    const { db, service, asked } = build();
    db.stored = true;
    db.query = (async function (this: FakeDb, sql: string, params: readonly unknown[] = []) {
      if (sql.includes('min(ts) as first')) return [{ first: new Date(NOW - 400 * 86_400_000) }];
      return FakeDb.prototype.query.call(this, sql, params);
    }) as never;
    await service.series('ETHUSDT', '15m');
    expect(asked[0].fromMs).toBe(NOW - OI_DIVERGENCE_15M_SPAN_MS);
    expect(asked[0].tf).toBe('15m');
  });

  it('the admin’s params are used (W = 10 bars loses this 28-bar line); an invalid row falls back to the defaults', async () => {
    const short = build();
    short.db.params = { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '1h': { nLeft: 6, nRight: 6, k: 3, w: 10 } } };
    const r = await short.service.series('ETHUSDT', '1h');
    expect(theLine(r)).toEqual([]);
    expect(r.params.perTf['1h'].w).toBe(10);
    const bad = build();
    bad.db.params = { perTf: 'nonsense' };
    expect((await bad.service.series('ETHUSDT', '1h')).params).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
  });

  it('a line the journal sent carries its fired_at; the others carry null', async () => {
    const { db, service } = build();
    db.fired = [{ direction: 'bullish', a_time: new Date(F.expected.aTime * 1000), b_time: new Date(F.expected.bTime * 1000), fired_at: new Date(1_793_000_000_000) }];
    const r = await service.series('ETHUSDT', '1h');
    expect(theLine(r)[0].firedAt).toBe(1_793_000_000);
    expect(r.lines.filter((l) => l !== theLine(r)[0]).every((l) => l.firedAt === null)).toBe(true);
  });
});
