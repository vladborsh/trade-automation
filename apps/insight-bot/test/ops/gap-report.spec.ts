import { BINANCE_WEIGHT_BUDGET, buildGapReport, renderGapReport, type GapReportInput } from '../../src/ops/gap-report';

/**
 * IB-011 — the stage-0 exit instrument (§6.2). `clean` is what fourteen consecutive days must be,
 * so the specs are mostly about what may and may not make a day dirty.
 */

const DAY = '2026-09-27';
const GENERATED = Date.UTC(2026, 8, 28, 0, 10, 0);
const DAY_START = Date.UTC(2026, 8, 27);

const input = (over: Partial<GapReportInput> = {}): GapReportInput => ({
  day: DAY,
  candles: [
    { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', present: 1440, expected: 1440 },
    { venue: 'binance', market: 'spot', symbol: 'BTCUSDT', present: 1440, expected: 1440 },
  ],
  openInterest: [{ venue: 'binance', symbol: 'BTCUSDT', present: 288, expected: 288 }],
  longShort: [{ venue: 'binance', symbol: 'BTCUSDT', present: 288, expected: 288 }],
  gaps: [],
  binanceWeightPeak: 178,
  binanceWeightIsEstimate: false,
  silenceThresholdMin: 3,
  ...over,
});

describe('buildGapReport — a clean day', () => {
  it('is clean when every series is complete and nothing was left unrepaired', () => {
    const report = buildGapReport(input(), GENERATED);
    expect(report.clean).toBe(true);
    expect(report.candles).toMatchObject({ series: 2, expected: 2880, present: 2880, missing: [] });
    expect(report.unrepaired).toEqual([]);
    expect(report.binanceWeight).toEqual({ peak1m: 178, isEstimate: false, budget: BINANCE_WEIGHT_BUDGET });
  });

  it('a gap that WAS repaired does not make the day dirty — that is the system working', () => {
    const report = buildGapReport(input({
      gaps: [{ stream: 'binance-perp:kline_1m', venue: 'binance', symbol: 'BTCUSDT', gapFromMs: DAY_START, gapToMs: DAY_START + 3 * 60_000, expected: 4, repaired: 4, error: null }],
    }), GENERATED);
    expect(report.clean).toBe(true);
    expect(report.unrepaired).toEqual([]);
  });

  it('the retention edge is not a gap (§16.8): a series whose expected is 0 cannot be missing', () => {
    const report = buildGapReport(input({
      openInterest: [{ venue: 'binance', symbol: 'NEWUSDT', present: 0, expected: 0 }],
    }), GENERATED);
    expect(report.clean).toBe(true);
    expect(report.openInterest.missing).toEqual([]);
  });

  it('a collector that started mid-day is judged from its first row, not from midnight', () => {
    // the reader (candleCoverage) computes `expected` from the first stored row; here that is
    // half a day, and the collector has every minute since — a clean day, not a 720-bar hole
    const report = buildGapReport(input({
      candles: [{ venue: 'bybit', market: 'perp', symbol: 'BTCUSDT', present: 720, expected: 720 }],
    }), GENERATED);
    expect(report.clean).toBe(true);
  });
});

describe('buildGapReport — a dirty day', () => {
  it('lists missing candles per series, worst first, and is not clean', () => {
    const report = buildGapReport(input({
      candles: [
        { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', present: 1439, expected: 1440 },
        { venue: 'binance', market: 'perp', symbol: 'ETHUSDT', present: 1400, expected: 1440 },
        { venue: 'binance', market: 'spot', symbol: 'BTCUSDT', present: 1440, expected: 1440 },
      ],
    }), GENERATED);
    expect(report.clean).toBe(false);
    expect(report.candles.missing).toEqual([
      { venue: 'binance', market: 'perp', symbol: 'ETHUSDT', missing: 40, expected: 1440 },
      { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', missing: 1, expected: 1440 },
    ]);
  });

  it('missing OI or L/S slots make the day dirty', () => {
    expect(buildGapReport(input({ openInterest: [{ venue: 'binance', symbol: 'BTCUSDT', present: 287, expected: 288 }] }), GENERATED).clean).toBe(false);
    expect(buildGapReport(input({ longShort: [{ venue: 'binance', symbol: 'BTCUSDT', present: 200, expected: 288 }] }), GENERATED).clean).toBe(false);
  });

  it('unrepaired silence longer than the threshold is what the criterion forbids', () => {
    const fourMinutes = {
      stream: 'binance-perp:forceOrder', venue: 'binance', symbol: null,
      gapFromMs: DAY_START, gapToMs: DAY_START + 4 * 60_000, expected: 0, repaired: 0,
      error: 'degraded mode: !forceOrder has no REST equivalent, liquidations in this window are lost',
    };
    const report = buildGapReport(input({ gaps: [fourMinutes] }), GENERATED);
    expect(report.clean).toBe(false);
    expect(report.unrepaired).toEqual([{ stream: 'binance-perp:forceOrder', symbol: null, minutes: 4, reason: fourMinutes.error }]);
  });

  it('a two-minute unrepaired spell is listed but does NOT fail the day (the threshold is 3)', () => {
    const report = buildGapReport(input({
      gaps: [{ stream: 'binance-perp:forceOrder', venue: 'binance', symbol: null, gapFromMs: DAY_START, gapToMs: DAY_START + 2 * 60_000, expected: 0, repaired: 0, error: 'x' }],
    }), GENERATED);
    expect(report.unrepaired).toHaveLength(1);
    expect(report.clean).toBe(true);
  });

  it('a partially repaired gap counts as unrepaired', () => {
    const report = buildGapReport(input({
      gaps: [{ stream: 'binance-perp:kline_1m', venue: 'binance', symbol: 'ETHUSDT', gapFromMs: DAY_START, gapToMs: DAY_START + 10 * 60_000, expected: 11, repaired: 5, error: null }],
    }), GENERATED);
    expect(report.unrepaired[0]).toMatchObject({ stream: 'binance-perp:kline_1m', symbol: 'ETHUSDT', minutes: 10 });
    expect(report.clean).toBe(false);
  });
});

describe('renderGapReport — what the operator reads at 08:00', () => {
  it('a clean day is short and says so', () => {
    const text = renderGapReport(buildGapReport(input(), GENERATED));
    expect(text).toContain('✅');
    expect(text).toContain(`за ${DAY}`);
    expect(text).toContain('2880 из 2880');
    expect(text).toContain('Пропущенных свечей нет');
    expect(text.split('\n').length).toBeLessThan(12);
  });

  it('a dirty day names the symbols and the counts', () => {
    const text = renderGapReport(buildGapReport(input({
      candles: [{ venue: 'binance', market: 'perp', symbol: 'ETHUSDT', present: 1400, expected: 1440 }],
      gaps: [{ stream: 'bybit:allLiquidation', venue: 'bybit', symbol: null, gapFromMs: DAY_START, gapToMs: DAY_START + 7 * 60_000, expected: 0, repaired: 0, error: 'socket down' }],
    }), GENERATED));
    expect(text).toContain('⚠️');
    expect(text).toContain('ETHUSDT: нет 40 из 1440');
    expect(text).toContain('bybit:allLiquidation: 7 мин — socket down');
  });

  it('caps the list so one bad night cannot produce a 300-line message', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ venue: 'binance', market: 'perp', symbol: `SYM${i}USDT`, present: 0, expected: 1440 }));
    const text = renderGapReport(buildGapReport(input({ candles: many }), GENERATED));
    expect(text).toContain('…и ещё 22');
    expect(text.split('\n').length).toBeLessThan(20);
  });

  it('a peak of 0 is reported as "no data", not as "we used nothing" (a CLI re-run)', () => {
    const text = renderGapReport(buildGapReport(input({ binanceWeightPeak: 0, binanceWeightIsEstimate: true }), GENERATED));
    expect(text).toContain('нет данных');
    expect(text).not.toContain('0 из 2400');
  });

  it('says when the Binance figure is our own estimate rather than the venue’s', () => {
    const text = renderGapReport(buildGapReport(input({ binanceWeightPeak: 150, binanceWeightIsEstimate: true }), GENERATED));
    expect(text).toContain('150 из 2400');
    expect(text).toContain('наша собственная оценка');
  });
});
