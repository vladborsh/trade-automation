import { BINANCE_WEIGHT_BUDGET, buildGapReport, renderGapReport, type GapReportInput } from '../../src/ops/gap-report';

/**
 * IB-011 — the stage-0 exit instrument (§6.2). `clean` is what fourteen consecutive days must be,
 * so the specs are mostly about what may and may not make a day dirty. WD-010: the minute-candle
 * section went with the candle tape; OI/LS slots and liquidation-stream silence remain.
 */

const DAY = '2026-09-27';
const GENERATED = Date.UTC(2026, 8, 28, 0, 10, 0);
const DAY_START = Date.UTC(2026, 8, 27);

const input = (over: Partial<GapReportInput> = {}): GapReportInput => ({
  day: DAY,
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
    expect(report.openInterest).toEqual({ symbols: 1, missing: [] });
    expect(report).not.toHaveProperty('candles');
    expect(report.unrepaired).toEqual([]);
    expect(report.binanceWeight).toEqual({ peak1m: 178, isEstimate: false, budget: BINANCE_WEIGHT_BUDGET });
  });

  it('a gap that WAS repaired does not make the day dirty — that is the system working', () => {
    const report = buildGapReport(input({
      gaps: [{ stream: 'binance-perp:oi-ls-5m', venue: 'binance', symbol: 'BTCUSDT', gapFromMs: DAY_START, gapToMs: DAY_START + 15 * 60_000, expected: 3, repaired: 3, error: null }],
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

  it('a poller that started mid-day is judged from its first slot, not from midnight', () => {
    // the reader (slotCoverage) computes `expected` from the first stored slot; here that is
    // half a day, and every slot since is present — a clean day, not a 144-slot hole
    const report = buildGapReport(input({
      openInterest: [{ venue: 'binance', symbol: 'BTCUSDT', present: 144, expected: 144 }],
    }), GENERATED);
    expect(report.clean).toBe(true);
  });
});

describe('buildGapReport — a dirty day', () => {
  it('lists missing OI slots per symbol, worst first, and is not clean', () => {
    const report = buildGapReport(input({
      openInterest: [
        { venue: 'binance', symbol: 'BTCUSDT', present: 287, expected: 288 },
        { venue: 'binance', symbol: 'ETHUSDT', present: 248, expected: 288 },
        { venue: 'binance', symbol: 'SOLUSDT', present: 288, expected: 288 },
      ],
    }), GENERATED);
    expect(report.clean).toBe(false);
    expect(report.openInterest.missing).toEqual([
      { venue: 'binance', symbol: 'ETHUSDT', missing: 40, expected: 288 },
      { venue: 'binance', symbol: 'BTCUSDT', missing: 1, expected: 288 },
    ]);
  });

  it('OKX\'s liquidation channel is an event stream too: its silence is loss, listed like the others', () => {
    const report = buildGapReport(input({
      gaps: [{ stream: 'okx:liquidation-orders', venue: 'okx', symbol: null, gapFromMs: DAY_START, gapToMs: DAY_START + 5 * 60_000, expected: 0, repaired: 0, error: 'not running' }],
    }), GENERATED);
    expect(report.unrepaired).toEqual([{ stream: 'okx:liquidation-orders', symbol: null, minutes: 5, reason: 'not running' }]);
    expect(report.clean).toBe(false);
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
      gaps: [{ stream: 'binance-perp:oi-ls-5m', venue: 'binance', symbol: 'ETHUSDT', gapFromMs: DAY_START, gapToMs: DAY_START + 10 * 60_000, expected: 3, repaired: 1, error: null }],
    }), GENERATED);
    expect(report.unrepaired[0]).toMatchObject({ stream: 'binance-perp:oi-ls-5m', symbol: 'ETHUSDT', minutes: 10 });
    expect(report.clean).toBe(false);
  });
});

describe('renderGapReport — what the operator reads at 08:00', () => {
  it('a clean day is short and says so', () => {
    const text = renderGapReport(buildGapReport(input(), GENERATED));
    expect(text).toContain('✅');
    expect(text).toContain(`за ${DAY}`);
    expect(text).toContain('все пятиминутные слоты на месте (1 монет)');
    expect(text).toContain('Незакрытых пропусков в потоках нет');
    expect(text).not.toContain('свеч');
    expect(text.split('\n').length).toBeLessThan(12);
  });

  it('a dirty day names the symbols and the counts', () => {
    const text = renderGapReport(buildGapReport(input({
      openInterest: [{ venue: 'binance', symbol: 'ETHUSDT', present: 248, expected: 288 }],
      gaps: [{ stream: 'bybit:allLiquidation', venue: 'bybit', symbol: null, gapFromMs: DAY_START, gapToMs: DAY_START + 7 * 60_000, expected: 0, repaired: 0, error: 'socket down' }],
    }), GENERATED));
    expect(text).toContain('⚠️');
    expect(text).toContain('ETHUSDT: нет 40 из 288');
    expect(text).toContain('bybit:allLiquidation: 7 мин — socket down');
  });

  it('caps the list so one bad night cannot produce a 300-line message', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ venue: 'binance', symbol: `SYM${i}USDT`, present: 0, expected: 288 }));
    const text = renderGapReport(buildGapReport(input({ openInterest: many }), GENERATED));
    expect(text).toContain('не хватает слотов у 30 монет');
    expect(text.split('\n').filter((l) => l.startsWith('  • SYM'))).toHaveLength(8);
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
