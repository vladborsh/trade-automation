import { WEB_KPI_IDS } from '@trade-automation/contracts';
import { TtlCache } from '../../../../src/venues/ttl-cache';
import { KpisService } from '../../../../src/web/market/positioning/kpis.service';
import { PositioningService } from '../../../../src/web/market/positioning/positioning.service';

/** IB-085 — the services against fakes of the reads they reuse (no venue, no database). */
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 3, 12, 30);
const sym = (id: string, base: string, asset_class: 'crypto' | 'tradfi') => ({ id, base, asset_class, quote: 'USDT', binance_perp: id, listed_perp: '2020-01-01' });
const SYMBOLS = [sym('BTCUSDT', 'BTC', 'crypto'), sym('ETHUSDT', 'ETH', 'crypto'), sym('XAUUSDT', 'XAU', 'tradfi')];

/** `hours` of hourly history ending at NOW; OI jumps 26 % in the last hour on a flat price. */
function fakes(hours: number) {
  const hourly = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
  const series = (fromMs: number, toMs: number, f: (t: number) => number) => {
    const out: Array<{ t: number; v: number }> = [];
    // like the venue: hourly for a long window, 5-minute for a short one
    const step = toMs - fromMs > 2 * 24 * H ? H : 5 * 60_000;
    for (let t = Math.ceil(Math.max(fromMs, NOW - hours * H) / step) * step; t <= toMs; t += step) out.push({ t, v: f(t) });
    return out;
  };
  const priceAt = (t: number) => 100 + Math.sin(t / H) * 0.5;
  return {
    summary: { summary: async () => ({ asOfMs: NOW, venue: 'binance-perp', rows: [{ id: 'BTCUSDT', base: 'BTC', volumeRank: 1, lastPrice: 100.1, changePct24h: 0, fundingRate: 0.0003, nextFundingTimeMs: null, oiChangePct24h: 0 }] }) },
    candles: { candles: async (_m: string, _s: string, _tf: string, from: number, to: number) => series(from, to - H, priceAt).map(({ t, v }) => ({ time: t / 1000, open: v, high: v, low: v, close: v, volume: 1 })) },
    funding: { binanceSettledHistory: async () => hourly(Math.floor(hours / 8), (i) => ({ time: i, rate: 0.0001 })) },
    oiLs: {
      openInterest: async (_s: string, from: number, to: number) => ({ points: series(from, to, (t) => (t >= NOW - 30 * 60_000 ? 1260 : 1000)).map(({ t, v }) => ({ time: t / 1000, value: v, notional: v * 100 })) }),
      longShort: async (_s: string, _k: string, from: number, to: number) => ({ points: series(from, to, () => 1.5).map(({ t, v }) => ({ time: t / 1000, ratio: v })) }),
    },
  };
}

const service = (hours: number) => {
  const f = fakes(hours);
  return new PositioningService({
    symbols: SYMBOLS as never, cache: new TtlCache({ now: () => NOW }), summary: f.summary as never, candles: f.candles as never,
    funding: f.funding as never, oiLs: f.oiLs as never, liquidations: null, now: () => NOW,
  });
};

describe('PositioningService', () => {
  it('one row per CRYPTO coin — TradFi is not a row (D6)', async () => {
    const res = await service(30 * 24).positioning('1h');
    expect(res.rows.map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('with 30 days of history: rarities measured, and the +26 % OI on a flat price reads new_longs (funding > 0)', async () => {
    const btc = (await service(30 * 24).positioning('1h')).rows[0];
    expect(btc.oiChangePct.value).toBeCloseTo(26, 0);
    expect(btc.oiChangePct.rarity).toBeGreaterThan(0.99);
    expect(btc.fundingRate.rarity).toBe(1); // 0.0003 against a month of 0.0001
    expect(btc.quadrant).toBe('new_longs');
  });

  it('IB-090: oiUsd is the LAST OI notional (the dot size); a venue that does not answer gives null, not 0', async () => {
    const btc = (await service(30 * 24).positioning('1h')).rows[0];
    expect(btc.oiUsd).toBe(1260 * 100);
    const f = fakes(30 * 24);
    const down = new PositioningService({
      symbols: SYMBOLS as never, cache: new TtlCache({ now: () => NOW }), summary: f.summary as never, candles: f.candles as never,
      funding: f.funding as never, liquidations: null, now: () => NOW,
      oiLs: { ...f.oiLs, openInterest: async () => { throw new Error('418'); } } as never,
    });
    expect((await down.positioning('1h')).rows[0].oiUsd).toBeNull();
  });

  it('UNDER 20 DAYS OF HISTORY: the value is there, the rarity is null with its reason — never 0', async () => {
    const btc = (await service(10 * 24).positioning('1h')).rows[0];
    expect(btc.oiChangePct.value).toBeCloseTo(26, 0);
    expect(btc.oiChangePct).toMatchObject({ rarity: null, unavailable: 'insufficient_history' });
    expect(btc.fundingRate).toMatchObject({ value: 0.0003, rarity: null, unavailable: 'insufficient_history' });
  });

  it('7d: changes have values but no rarity (four 7-day windows are not a norm)', async () => {
    const btc = (await service(30 * 24).positioning('7d')).rows[0];
    expect(btc.priceChangePct.rarity).toBeNull();
    expect(btc.priceChangePct.unavailable).toBe('insufficient_history');
  });

  it('a coin the summary does not carry: its price and funding cells say venue_unavailable', async () => {
    const eth = (await service(30 * 24).positioning('1h')).rows[1];
    expect(eth.priceChangePct).toMatchObject({ value: null, unavailable: 'venue_unavailable' });
    expect(eth.fundingRate).toMatchObject({ value: null, unavailable: 'venue_unavailable' });
  });
});

describe('KpisService', () => {
  const failing = { cards: async () => { throw new Error('down'); } };
  const kpis = (cards: unknown, oiLs: unknown = { openInterest: async () => { throw new Error('down'); } }) => new KpisService({
    cache: new TtlCache({ now: () => NOW }), cards: cards as never, liquidations: null, oiLs: oiLs as never,
    summary: { summary: async () => { throw new Error('down'); } } as never, btcSymbol: 'BTCUSDT', now: () => NOW,
  });

  it('every source down: still SIX tiles, in order, each saying why it is empty', async () => {
    const res = await kpis(failing).kpis();
    expect(res.tiles.map((t) => t.id)).toEqual([...WEB_KPI_IDS]);
    expect(res.tiles.every((t) => t.value === null && t.unavailable === 'venue_unavailable')).toBe(true);
  });

  it('F&G carries alternative.me attribution and its band; BTC OI its 24 h change', async () => {
    const cards = { cards: async () => ({
      fearGreed: { now: { day: '2026-11-03', value: 26, classification: 'Fear' }, previous: { day: '2026-11-02', value: 37, classification: 'Fear' }, weekAgo: null, source: 'alternative.me' },
      dominance: { btcPct: 59.2, ethPct: 10.6, totalUsd: 2.62e12, atMs: NOW, changePct24h: null, changePct7d: null, totalChangePct24h: -2.97, coverageDays: 0, source: 'coingecko' },
      btcVsTop: null, caps: [], capsDay: null, capsSource: 'coingecko', live: true,
    }) };
    const oi = { openInterest: async () => ({ points: [{ time: (NOW - 24 * H) / 1000, value: 1, notional: 100 }, { time: NOW / 1000, value: 1, notional: 110 }] }) };
    const tiles = Object.fromEntries((await kpis(cards, oi).kpis()).tiles.map((t) => [t.id, t]));
    expect(tiles.fear_greed).toMatchObject({ value: 26, delta: -11, source: { name: 'alternative.me' }, context: { key: 'kpi.ctx.fng_band', params: { band: 'fear' } } });
    expect(tiles.market_cap).toMatchObject({ value: 2.62e12, delta: -2.97 });
    expect(tiles.btc_oi).toMatchObject({ value: 110, delta: 10 });
  });
});
