import { WEB_KPI_IDS } from '@trade-automation/contracts';
import { Logger } from '@nestjs/common';
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

describe('IB-119: hourlyCloses (R4 on 7d) and breadth\'s last hour (R7), from the same cached read', () => {
  it('closes since a moment, stamped at each bar\'s CLOSE; no venue call beyond positioning()\'s', async () => {
    const f = fakes(30 * 24);
    const calls = { candles: 0 };
    const counted = { ...f, candles: { candles: async (...a: Parameters<typeof f.candles.candles>) => { calls.candles++; return f.candles.candles(...a); } } };
    // breadth needs three coins
    const svc = new PositioningService({
      symbols: [...SYMBOLS, sym('SOLUSDT', 'SOL', 'crypto')] as never, cache: new TtlCache({ now: () => NOW }), summary: counted.summary as never,
      candles: counted.candles as never, funding: counted.funding as never, oiLs: counted.oiLs as never, liquidations: null, now: () => NOW,
    });
    await svc.positioning('24h');
    const before = calls.candles;
    const closes = await svc.hourlyCloses('BTCUSDT', NOW - 7 * 86_400_000);
    expect(calls.candles).toBe(before); // the cached baselines, not a read of its own
    const lastClose = Date.UTC(2026, 10, 3, 12) / 1000; // NOW is 12:30: the 11:00 bar closed at 12:00
    expect(closes.at(-1)?.time).toBe(lastClose);
    expect(closes[0]?.time).toBeGreaterThanOrEqual((NOW - 7 * 86_400_000) / 1000);
    expect(closes).toHaveLength(168);
    expect(await svc.hourlyCloses('NOPEUSDT', 0)).toEqual([]);
    expect((await svc.breadth('24h'))?.lastHourEnd).toBe(lastClose);
  });
});

describe('KpisService', () => {
  const failing = { cards: async () => { throw new Error('down'); } };
  const down = async () => { throw new Error('down'); };
  const kpis = (cards: unknown, oiLs: unknown = { openInterest: down, longShort: down }, summary: unknown = { summary: down }) => new KpisService({
    cache: new TtlCache({ now: () => NOW }), cards: cards as never, liquidations: null, oiLs: oiLs as never,
    summary: summary as never, btcSymbol: 'BTCUSDT', now: () => NOW,
  });
  const cardsWith = (fearGreed: unknown, ethPct: number | null) => ({ cards: async () => ({
    fearGreed, dominance: { btcPct: 59.2, ethPct, totalUsd: 2.62e12, atMs: NOW, changePct24h: 0.4, changePct7d: null, totalChangePct24h: -2.97, coverageDays: 0, source: 'coingecko' },
    btcVsTop: null, caps: [], capsDay: null, capsSource: 'coingecko', live: true,
  }) });
  const reading = (day: string, value: number) => ({ day, value, classification: 'Fear' });
  const fng = (previous: unknown, weekAgo: unknown) => ({ now: reading('2026-11-03', 26), previous, weekAgo, history: [], source: 'alternative.me' });
  const fundingOk = { summary: async () => ({ asOfMs: NOW, venue: 'binance-perp', rows: [{ id: 'BTCUSDT', base: 'BTC', volumeRank: 1, lastPrice: 1, changePct24h: 0, fundingRate: 0.0001, nextFundingTimeMs: null, oiChangePct24h: 0 }] }) };
  const byId = async (k: KpisService) => Object.fromEntries((await k.kpis()).tiles.map((t) => [t.id, t]));

  it('every source down: still FIVE tiles, in order, each saying why it is empty', async () => {
    const res = await kpis(failing).kpis();
    expect(res.tiles.map((t) => t.id)).toEqual([...WEB_KPI_IDS]);
    expect(res.tiles.every((t) => t.value === null && t.unavailable === 'venue_unavailable')).toBe(true);
    expect(res.tiles.every((t) => t.note === null)).toBe(true);
  });

  it('IB-106 notes: ETH share, BTC account L/S (the last point of ONE global_account read over 2 h)', async () => {
    const calls: unknown[][] = [];
    const oiLs = {
      openInterest: down,
      longShort: async (...args: unknown[]) => {
        calls.push(args);
        return { points: [{ time: (NOW - 10 * 60_000) / 1000, ratio: 2.4 }, { time: (NOW - 5 * 60_000) / 1000, ratio: 2.6189 }] };
      },
    };
    const tiles = await byId(kpis(cardsWith(fng(reading('2026-11-02', 37), reading('2026-10-27', 48)), 10.6349), oiLs, fundingOk));
    expect(tiles.btc_dominance.note).toEqual({ key: 'kpi.note.eth_share', params: { ethPct: 10.6 } });
    expect(tiles.btc_funding.note).toEqual({ key: 'kpi.note.ls_accounts', params: { ratio: 2.62 } });
    expect(calls).toEqual([['BTCUSDT', 'global_account', NOW - 2 * H, NOW]]);
    // the other three tiles have no note — and with F&G history on the cards, no tile carries it (IB-117)
    expect(Object.keys(tiles)).not.toContain('fear_greed');
    expect([tiles.market_cap.note, tiles.liquidations_24h.note, tiles.btc_oi.note]).toEqual([null, null, null]);
  });

  it('IB-106 null cases: no ETH share, an L/S read that fails or is empty — no note, and no tile value lost', async () => {
    const failed = await byId(kpis(cardsWith(fng(null, null), null), { openInterest: down, longShort: down }, fundingOk));
    expect(failed.btc_dominance).toMatchObject({ value: 59.2, note: null });
    expect(failed.btc_funding).toMatchObject({ value: 0.0001, unavailable: null, note: null });

    const empty = await byId(kpis(cardsWith(fng(null, reading('2026-10-27', 48)), 10.6), { openInterest: down, longShort: async () => ({ points: [] }) }, fundingOk));
    expect(empty.btc_funding.note).toBeNull();
  });

  it('IB-106: the L/S note is its own fact — it stands when the funding read failed', async () => {
    const tiles = await byId(kpis(cardsWith(fng(null, null), null), { openInterest: down, longShort: async () => ({ points: [{ time: NOW / 1000, ratio: 1.9 }] }) }));
    expect(tiles.btc_funding).toMatchObject({ value: null, unavailable: 'venue_unavailable', note: { key: 'kpi.note.ls_accounts', params: { ratio: 1.9 } } });
  });

  it('IB-117: F&G on the cards makes no tile (the gauge reads it); BTC OI its 24 h change', async () => {
    const cards = { cards: async () => ({
      fearGreed: { now: { day: '2026-11-03', value: 26, classification: 'Fear' }, previous: { day: '2026-11-02', value: 37, classification: 'Fear' }, weekAgo: null, source: 'alternative.me' },
      dominance: { btcPct: 59.2, ethPct: 10.6, totalUsd: 2.62e12, atMs: NOW, changePct24h: null, changePct7d: null, totalChangePct24h: -2.97, coverageDays: 0, source: 'coingecko' },
      btcVsTop: null, caps: [], capsDay: null, capsSource: 'coingecko', live: true,
    }) };
    const oi = { longShort: down, openInterest: async () => ({ points: [{ time: (NOW - 24 * H) / 1000, value: 1, notional: 100 }, { time: NOW / 1000, value: 1, notional: 110 }] }) };
    const tiles = Object.fromEntries((await kpis(cards, oi).kpis()).tiles.map((t) => [t.id, t]));
    expect(Object.keys(tiles)).toEqual([...WEB_KPI_IDS]);
    expect(Object.keys(tiles)).not.toContain('fear_greed');
    expect(Object.values(tiles).map((t) => t.source.name)).not.toContain('alternative.me');
    expect(tiles.market_cap).toMatchObject({ value: 2.62e12, delta: -2.97 });
    expect(tiles.btc_oi).toMatchObject({ value: 110, delta: 10 });
  });
});

describe('IB-118: fundingSettlements — the baseline keeps each settlement\'s time next to its rate', () => {
  const counted = () => {
    const f = fakes(30 * 24);
    const calls = { funding: 0 };
    const svc = new PositioningService({
      symbols: SYMBOLS as never, cache: new TtlCache({ now: () => NOW }), summary: f.summary as never, candles: f.candles as never,
      funding: { binanceSettledHistory: async () => { calls.funding++; return Array.from({ length: 90 }, (_, i) => ({ time: 1_790_000_000 + i * 28_800, rate: i / 1e6 })); } } as never,
      oiLs: f.oiLs as never, liquidations: null, now: () => NOW,
    });
    return { svc, calls };
  };

  it('{time, rate} per settlement, oldest first, all 90 of the 30 days — the shape R5 (IB-119) reads', async () => {
    const { svc } = counted();
    const btc = (await svc.fundingSettlements()).get('BTCUSDT');
    expect(btc).toHaveLength(90);
    expect(btc?.[0]).toEqual({ time: 1_790_000_000, rate: 0 });
    expect(btc?.[89]).toEqual({ time: 1_790_000_000 + 89 * 28_800, rate: 89 / 1e6 });
  });

  it('held: null before anything built the baselines, and it starts no build (no venue call)', async () => {
    const { svc, calls } = counted();
    expect(await svc.fundingSettlements({ held: true })).toBeNull();
    expect(calls.funding).toBe(0);
    await svc.positioning('24h');
    const before = calls.funding;
    expect((await svc.fundingSettlements({ held: true }))?.get('BTCUSDT')).toHaveLength(90);
    expect(calls.funding).toBe(before);
  });
});

describe('IB-118: KpisService — the three charts, each its own soft read', () => {
  const down = async () => { throw new Error('down'); };
  afterEach(() => jest.restoreAllMocks());
  const cards = { cards: async () => ({
    fearGreed: null,
    dominance: { btcPct: 59.2, ethPct: 10.6, totalUsd: 2.62e12, atMs: NOW, changePct24h: 0.4, changePct7d: null, totalChangePct24h: -2.97, coverageDays: 0, source: 'coingecko' },
    btcVsTop: null, caps: [], capsDay: null, capsSource: 'coingecko', live: true,
  }) };
  const oiCalls: unknown[][] = [];
  const oiLs = {
    longShort: down,
    openInterest: async (...args: unknown[]) => {
      oiCalls.push(args);
      const hourly = args[3] === H;
      const n = hourly ? 168 : 2;
      const step = hourly ? H : 24 * H;
      return { points: Array.from({ length: n }, (_, i) => ({ time: (NOW - (n - 1 - i) * step) / 1000, value: 1, notional: 7e9 + i * 1e6 })) };
    },
  };
  const settlements = Array.from({ length: 90 }, (_, i) => ({ time: 1_790_000_000 + i * 28_800, rate: (i % 7 - 2) / 1e5 }));
  const make = (over: Record<string, unknown>) => new KpisService({
    cache: new TtlCache({ now: () => NOW }), cards: cards as never, liquidations: null, oiLs: oiLs as never, summary: { summary: down } as never,
    btcSymbol: 'BTCUSDT', now: () => NOW, ...over,
  });
  const byId = async (k: KpisService) => Object.fromEntries((await k.kpis()).tiles.map((t) => [t.id, t]));
  const capRows = (n: number) => async (sinceMs: number) => {
    expect(sinceMs).toBe(NOW - 7 * 24 * H);
    return Array.from({ length: n }, (_, i) => ({ tsMs: NOW - (n - 1 - i) * 600_000, totalUsd: 2.6e12 + i * 1e9 }));
  };

  it('OI: ONE 7-day read at a 1 h floor, 168 USD points; the 24 h tile value and delta still from its own read', async () => {
    oiCalls.length = 0;
    const tiles = await byId(make({}));
    expect(oiCalls.filter((a) => a[3] === H)).toEqual([['BTCUSDT', NOW - 7 * 24 * H, NOW, H]]);
    expect(tiles.btc_oi.history).toMatchObject({ kind: 'area', min: 7e9, max: 7e9 + 167e6, breakAfterSec: 5400 });
    expect(tiles.btc_oi.history?.points).toHaveLength(168);
    expect(tiles.btc_oi.value).toBe(7e9 + 1e6); // the 24 h read's last point, unchanged
  });

  it('funding: the last 21 settlements as bars, from the HELD baseline only', async () => {
    const asked: unknown[] = [];
    const positioning = { fundingSettlements: async (o: unknown) => { asked.push(o); return new Map([['BTCUSDT', settlements]]); } };
    const tiles = await byId(make({ positioning }));
    expect(asked).toEqual([{ held: true }]);
    expect(tiles.btc_funding.history?.kind).toBe('bars');
    expect(tiles.btc_funding.history?.points.map((p) => p.time)).toEqual(settlements.slice(-21).map((s) => s.time));
  });

  it('baseline rebuilding: the last bars seen stand in, for at most 2 h — then no chart', async () => {
    let now = NOW;
    let held: Map<string, unknown> | null = new Map([['BTCUSDT', settlements]]);
    const svc = make({ positioning: { fundingSettlements: async () => held }, now: () => now, cache: new TtlCache({ now: () => now }) });
    const first = (await svc.kpis()).tiles[4].history;
    expect(first?.points).toHaveLength(21);
    held = null;
    now += 61_000; // past the 60 s cache
    expect((await svc.kpis()).tiles[4].history).toEqual(first);
    now += 2 * H;
    expect((await svc.kpis()).tiles[4].history).toBeNull();
  });

  it('funding baseline not held yet: no chart, nothing else lost', async () => {
    const tiles = await byId(make({ positioning: { fundingSettlements: async () => null } }));
    expect(tiles.btc_funding.history).toBeNull();
    expect(tiles.btc_oi.history).not.toBeNull();
  });

  it('cap: a week of rows is a chart; under 6 h is no chart and «копим историю: {h} ч»', async () => {
    const week = await byId(make({ capRows: capRows(1008) }));
    expect(week.market_cap.history?.points).toHaveLength(1008);
    expect(week.market_cap.note).toBeNull();
    const fresh = await byId(make({ capRows: capRows(20) })); // 3 h 10 min
    expect(fresh.market_cap.history).toBeNull();
    expect(fresh.market_cap.note).toEqual({ key: 'kpi.note.collecting', params: { hours: 3 } });
    expect(fresh.market_cap.value).toBe(2.62e12); // the value is the cards', untouched
  });

  it('every history read failing: all three null, values and notes as before', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const tiles = await byId(make({
      oiLs: { longShort: down, openInterest: down },
      positioning: { fundingSettlements: down },
      capRows: down,
    }));
    expect(Object.values(tiles).map((t) => t.history)).toEqual([null, null, null, null, null]);
    expect(tiles.market_cap).toMatchObject({ value: 2.62e12, note: null });
  });
});
