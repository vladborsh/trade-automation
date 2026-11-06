import { OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TFS, OI_DIVERGENCE_TF_SEC } from '@trade-automation/contracts';
import { barsToFetch } from '../../../src/alerts/oi-divergence/basis';
import { oiKlines } from '../../../src/delivery/oi-alerts.service';
import { detectorParams } from '../../../src/insights/divergence/params';
import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import { withWeightCaller } from '../../../src/venues/binance/weight-caller';
import { TtlCache } from '../../../src/venues/ttl-cache';
import { CandlesService, cheapestChunks } from '../../../src/web/market/candles.service';
import { klinesWeight } from '../../../src/news/reaction-prices';
import { PositioningService } from '../../../src/web/market/positioning/positioning.service';

/**
 * IB-147 — «a cold start plus one /market load stays ≤ 300 weight a minute», over the SHIPPED read paths: a real
 * `CandlesService` (its pages, its cache, its exact reads, its booking into a real `BinanceWeightTracker`) against a
 * scripted venue that answers any klines request; the shipped `oiKlines` for the OI loop's boot evaluations; the
 * shipped `PositioningService` for the page's baselines. The two reads the page adds outside candles are booked at
 * their documented weights by stubs: the universe summary (ticker/24hr 40 + premiumIndex 10) and settled funding (1 a
 * coin). Measured before the fix (box batch 9, slot): 256 at boot from the OI loop, then 673 / 743 with a cold
 * /market load — positioning's 1h pages were 620 of it (dev-3-IB-147.md).
 */
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 6, 9, 53, 30);
const COINS = Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, '0')}USDT`);
const ALERT_COINS = COINS.slice(0, 5);

/** A venue that answers every `/fapi/v1/klines` with `limit` bars from `startTime` (closed or forming, as Binance). */
function venue() {
  const requests: Array<{ symbol: string; interval: string; limit: number }> = [];
  const fetchImpl = (async (input: URL) => {
    const u = new URL(String(input));
    const tfMs = { '5m': 300_000, '15m': 900_000, '1h': H, '4h': 4 * H, '1d': 24 * H }[u.searchParams.get('interval') as string] as number;
    const start = Number(u.searchParams.get('startTime'));
    const end = Number(u.searchParams.get('endTime'));
    const limit = Number(u.searchParams.get('limit'));
    requests.push({ symbol: u.searchParams.get('symbol') as string, interval: u.searchParams.get('interval') as string, limit });
    const rows: unknown[] = [];
    for (let t = Math.ceil(start / tfMs) * tfMs; t <= end && t <= NOW && rows.length < limit; t += tfMs) rows.push([t, '1', '1', '1', '1', '1', t + tfMs - 1, '1', 1, '1', '1', '0']);
    return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), json: async () => rows };
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

function world() {
  const weight = new BinanceWeightTracker();
  const v = venue();
  let now = NOW;
  const candles = new CandlesService({ futuresBaseUrl: 'https://fapi.test', spotBaseUrl: 'https://api.test', weight, fetchImpl: v.fetchImpl, now: () => now });
  const symbols = COINS.map((id) => ({ id, base: id.replace('USDT', ''), asset_class: 'crypto', quote: 'USDT', binance_perp: id, listed_perp: '2020-01-01' }));
  const positioning = new PositioningService({
    symbols: symbols as never,
    cache: new TtlCache({ now: () => now }),
    summary: {
      summary: async () => {
        weight.recordCall(40, now); weight.recordCall(10, now); // ticker/24hr + premiumIndex, every symbol
        return { asOfMs: now, venue: 'binance-perp', rows: [] };
      },
    } as never,
    candles,
    funding: { binanceSettledHistory: async () => { weight.recordCall(1, now); return []; } } as never,
    oiLs: { openInterest: async () => ({ points: [] }), longShort: async () => ({ points: [] }) } as never,
    liquidations: null,
    now: () => now,
  });
  /** The OI loop's boot: the newest close of every tf for each alert coin, as `OiAlertLoop.evaluate` asks. */
  const oiBoot = () => withWeightCaller('oi_alerts', async () => {
    for (const tf of OI_DIVERGENCE_TFS) {
      const tfSec = OI_DIVERGENCE_TF_SEC[tf];
      const count = barsToFetch(detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, tf));
      const barClose = Math.floor(now / 1000 / tfSec) * tfSec;
      for (const s of ALERT_COINS) await oiKlines(candles, s, tf, barClose - count * tfSec, barClose);
    }
  });
  const page = () => withWeightCaller('positioning', () => positioning.positioning('24h'));
  return { weight, v, candles, positioning, oiBoot, page, setNow: (t: number) => { now = t; } };
}

describe('IB-147 cold-start weight', () => {
  it('a cold start plus one /market load stays at or under 300 in the trailing minute', async () => {
    const w = world();
    await w.oiBoot();
    await w.page();
    const spent = Object.fromEntries(w.weight.spentByCaller());
    expect(w.weight.used1m(NOW)).toBeLessThanOrEqual(300);
    // what it is made of: the OI loop at its exact limits (15 reads × 2); positioning: the baselines 30 × (2 × 360 at
    // weight 2), the 5 m reference bars 30 × 2 (IB-BUG-040, already exact), settled funding 30 × 1, the summary 40 + 10
    expect(spent.oi_alerts).toBe(15 * 2);
    expect(spent.positioning).toBe(30 * 4 + 30 * 2 + 30 + 50);
    expect(w.weight.used1m(NOW)).toBe(290);
  });

  it('every boot read is ONE request at its exact limit — no 1 500-row pages', async () => {
    const w = world();
    await w.oiBoot();
    await w.page();
    const hourly = w.v.requests.filter((r) => r.interval === '1h' && r.limit === 360);
    expect(hourly).toHaveLength(60); // the baselines: 720 closed hours each, as 2 × 360
    expect(w.v.requests.filter((r) => r.limit === 1500)).toEqual([]);
    expect(w.v.requests.every((r) => r.limit <= 1000)).toBe(true);
  });

  it('the hourly baseline rebuild costs the same exact reads again, never pages', async () => {
    const w = world();
    await w.page();
    const before = w.weight.spentByCaller().get('positioning') ?? 0;
    w.setNow(NOW + H + 60_000); // past the baselines' 1 h cache
    await w.page();
    const rebuild = (w.weight.spentByCaller().get('positioning') ?? 0) - before;
    // the baselines (30 × 4), their funding (30) and the summary (50); the 5 m reference bars too, their cache being past
    expect(rebuild).toBe(30 * 4 + 30 + 50 + 30 * 2);
    expect(w.v.requests.filter((r) => r.limit === 1500)).toEqual([]);
  });
});

describe('IB-147 cheapestChunks', () => {
  const weight = (c: number[]) => c.reduce((s, n) => s + klinesWeight(n), 0);
  it('720 → two requests of 360 (weight 4, against 5 for one); 288 stays one (2); 1000 stays one (5: three would be 6)', () => {
    expect(cheapestChunks(720)).toEqual([360, 360]);
    expect(weight(cheapestChunks(720))).toBe(4);
    expect(cheapestChunks(288)).toEqual([288]);
    expect(cheapestChunks(1000)).toEqual([1000]);
    expect(cheapestChunks(2000)).toEqual([1000, 1000]);
    expect(cheapestChunks(50)).toEqual([50]);
    expect(cheapestChunks(0)).toEqual([]);
  });
  it('the chunks always add up to the total, never exceed 1000, and never weigh more than one request would', () => {
    for (let n = 1; n <= 3000; n += 7) {
      const c = cheapestChunks(n);
      expect(c.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...c)).toBeLessThanOrEqual(1000);
      if (n <= 1000) expect(weight(c)).toBeLessThanOrEqual(klinesWeight(n));
    }
  });
});

describe('IB-147 oiKlines', () => {
  const calls: string[] = [];
  const candles = {
    closedKlines: async (_s: string, _tf: string, _f: number, limit: number) => { calls.push(`exact ${limit}`); return []; },
    candles: async () => { calls.push('pages'); return []; },
  };
  it('up to 1000 bars: ONE exact read at that count; above (an admin\'s reach that large), the paged read', async () => {
    calls.length = 0;
    await oiKlines(candles as never, 'BTCUSDT', '1h', 0, 440 * 3_600);
    await oiKlines(candles as never, 'BTCUSDT', '15m', 0, 1_000 * 900);
    await oiKlines(candles as never, 'BTCUSDT', '15m', 0, 1_001 * 900);
    expect(calls).toEqual(['exact 440', 'exact 1000', 'pages']);
  });
});
