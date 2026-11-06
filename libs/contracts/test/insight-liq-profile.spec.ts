import {
  LIQ_PROFILE_MAX_BANDS, WebLiqProfileResponseSchema, bandOf, foldProfile, gridServes, groupRows, profileGrid, profileStep,
  type LiqProfilePrint,
} from '../src/insight';

/** IB-153 — the liquidation profile's grid and folding (pure; the SQL twin is pinned in the bot's DB spec). */
describe('liquidation profile grid (IB-153)', () => {
  it('picks a nice step giving 20 < bands ≤ 40 across the visible span, at every scale', () => {
    for (const [lo, hi] of [[76_200, 78_100], [3_000, 3_400], [0.00001, 0.0000123], [95, 140], [1, 1.0004], [60_000, 120_000]]) {
      const step = profileStep(lo, hi);
      const bands = (hi - lo) / step;
      expect(bands).toBeLessThanOrEqual(LIQ_PROFILE_MAX_BANDS + 1e-9);
      expect(bands).toBeGreaterThan(LIQ_PROFILE_MAX_BANDS / 2);
      // human widths: 1, 2, 2.5 or 5 × 10ⁿ, and their text is the clean decimal SQL receives
      const mantissa = Number((step / 10 ** Math.floor(Math.log10(step))).toPrecision(6));
      expect([1, 2, 2.5, 5]).toContain(mantissa);
      expect(String(step)).not.toMatch(/0000000|9999999/);
    }
    expect(profileStep(76_200, 78_100)).toBe(50); // 1 900 / 40 = 47.5 → 50, 38 bands
  });

  it('an empty span or a single price still gets a band of a sensible width', () => {
    expect(profileStep(77_000, 77_000)).toBe(20); // 1 % of 77 000 = 770 → /40 → 19.25 → 20
    expect(profileStep(5, 1)).toBe(0.1); // inverted: the width is what counts
    expect(profileStep(0, 0)).toBe(0.025); // span 1
    expect(profileStep(Number.NaN, Number.NaN)).toBe(0.025);
  });

  it('a print exactly on an edge belongs to the band above, despite floating division', () => {
    expect(bandOf(77_700, 100)).toBe(777);
    expect(bandOf(77_699.99, 100)).toBe(776);
    expect(bandOf(0.3, 0.1)).toBe(3); // 0.3 / 0.1 = 2.9999999999999996
    expect(bandOf(0.0000125, 0.0000025)).toBe(5);
  });

  it('the cover is half a span wider each side, snapped to chunks, and serves views inside it', () => {
    const grid = profileGrid(76_200, 78_100);
    expect(grid.step).toBe(50);
    expect(grid.coverLo * grid.step).toBeLessThanOrEqual(76_200 - 950);
    expect(grid.coverHi * grid.step).toBeGreaterThanOrEqual(78_100 + 950);
    expect(grid.coverLo % 10).toBe(0);
    expect(grid.coverHi % 10).toBe(0);
    expect(gridServes(grid, 76_200, 78_100)).toBe(true);
    expect(gridServes(grid, 75_800, 77_700)).toBe(true); // scrolled down, same step, inside
    expect(gridServes(grid, 72_000, 73_900)).toBe(false); // scrolled out of the cover
    expect(gridServes(grid, 76_200, 80_100)).toBe(false); // zoomed out: the step changes
  });
});

describe('liquidation profile folding (IB-153)', () => {
  const venues = ['binance', 'bybit', 'okx'];

  /** 600 small prints spread over the cover, plus 5 large ones: the old table's top-N would see only the large. */
  function tape(): LiqProfilePrint[] {
    const rows: LiqProfilePrint[] = [];
    for (let i = 0; i < 600; i++) {
      rows.push({ price: 76_300 + ((i * 37) % 1_700), side: i % 3 === 0 ? 'long' : 'short', venue: venues[i % 3]!, usd: 500 + (i % 7) * 100 });
    }
    for (let i = 0; i < 5; i++) rows.push({ price: 77_600 + i * 20, side: 'short', venue: 'binance', usd: 300_000 + i });
    return rows;
  }
  const total = (rows: readonly LiqProfilePrint[], side: 'long' | 'short') => rows.filter((r) => r.side === side).reduce((s, r) => s + r.usd, 0);

  it('band totals equal the sum of ALL rows — a top-N subset fails this', () => {
    const rows = tape();
    const grid = profileGrid(76_200, 78_100);
    const out = foldProfile(groupRows(rows, grid.step), grid);
    const sum = (side: 'long' | 'short') => out.bands.reduce((s, b) => s + b[side].usd, 0) + out.above[side].usd + out.below[side].usd;
    const count = out.bands.reduce((s, b) => s + b.long.count + b.short.count, 0);
    expect(sum('long')).toBeCloseTo(total(rows, 'long'), 6);
    expect(sum('short')).toBeCloseTo(total(rows, 'short'), 6);
    expect(count).toBe(rows.length);

    // the positive control: the same fold over the 50 largest, as the old table had them, does NOT add up
    const top50 = [...rows].sort((a, b) => b.usd - a.usd).slice(0, 50);
    const fromTop = foldProfile(groupRows(top50, grid.step), grid);
    expect(fromTop.bands.reduce((s, b) => s + b.long.usd, 0)).not.toBeCloseTo(total(rows, 'long'), 0);
  });

  it('the venue split of each band adds up to the band, and bands come sorted', () => {
    const grid = profileGrid(76_200, 78_100);
    const out = foldProfile(groupRows(tape(), grid.step), grid);
    for (const b of out.bands) {
      expect(b.venues.reduce((s, v) => s + v.longUsd, 0)).toBeCloseTo(b.long.usd, 6);
      expect(b.venues.reduce((s, v) => s + v.shortUsd, 0)).toBeCloseTo(b.short.usd, 6);
      expect(b.venues.reduce((s, v) => s + v.count, 0)).toBe(b.long.count + b.short.count);
    }
    expect(out.bands.map((b) => b.band)).toEqual([...out.bands.map((b) => b.band)].sort((a, b) => a - b));
  });

  it('prints outside the cover are counted above and below, not dropped', () => {
    const grid = profileGrid(76_200, 78_100);
    const rows: LiqProfilePrint[] = [
      { price: 90_000, side: 'short', venue: 'okx', usd: 7 },
      { price: 50_000, side: 'long', venue: 'bybit', usd: 11 },
      { price: grid.coverHi * grid.step, side: 'long', venue: 'okx', usd: 3 }, // on the cover's top edge: above
      { price: grid.coverLo * grid.step, side: 'long', venue: 'okx', usd: 5 }, // on its bottom edge: inside
    ];
    const out = foldProfile(groupRows(rows, grid.step), grid);
    expect(out.above).toEqual({ long: { usd: 3, count: 1 }, short: { usd: 7, count: 1 } });
    expect(out.below).toEqual({ long: { usd: 11, count: 1 }, short: { usd: 0, count: 0 } });
    expect(out.bands).toEqual([{ band: grid.coverLo, long: { usd: 5, count: 1 }, short: { usd: 0, count: 0 }, venues: [{ venue: 'okx', longUsd: 5, shortUsd: 0, count: 1 }] }]);
  });

  it('one side only, and an empty window', () => {
    const grid = profileGrid(76_200, 78_100);
    const out = foldProfile(groupRows([{ price: 77_000, side: 'short', venue: 'binance', usd: 9 }], grid.step), grid);
    expect(out.bands).toHaveLength(1);
    expect(out.bands[0]!.long).toEqual({ usd: 0, count: 0 });
    expect(foldProfile([], grid)).toEqual({ bands: [], above: { long: { usd: 0, count: 0 }, short: { usd: 0, count: 0 } }, below: { long: { usd: 0, count: 0 }, short: { usd: 0, count: 0 } } });
  });

  it('the answer parses, and a venue outside the three is refused', () => {
    const grid = profileGrid(76_200, 78_100);
    const answer = {
      symbol: 'BTCUSDT', from: 1, to: 2, ...grid, ...foldProfile(groupRows(tape(), grid.step), grid),
      venues: [{ venue: 'binance', state: 'recorded' }, { venue: 'bybit', state: 'not_recorded' }, { venue: 'okx', state: 'not_listed' }],
      undercounted: true,
    };
    expect(WebLiqProfileResponseSchema.safeParse(answer).success).toBe(true);
    expect(WebLiqProfileResponseSchema.safeParse({ ...answer, venues: [{ venue: 'kraken', state: 'recorded' }] }).success).toBe(false);
  });
});
