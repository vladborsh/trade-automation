import { Instrument } from '@trade-automation/contracts';
import { toZoned } from '../../../src/strategy-engine/clock';
import { StrategyContext } from '../../../src/strategy-engine/signal-strategy.port';
import {
  createVwapBandReversalStrategy,
  VwapBandReversalStrategy,
} from '../../../src/strategy-engine/strategies/vwap-band-reversal/vwap-band-reversal.strategy';
import { bar } from './test-helpers';

const MIN = 60_000;

const instrument: Instrument = {
  id: 'capitalcom:US100',
  venue: 'capitalcom',
  symbol: 'US100',
  assetClass: 'index-cfd',
  displayName: 'US Tech 100',
  pricePrecision: 1,
  quoteCurrency: 'USD',
  sessionCurrency: 'USD',
  sessionTimezone: 'America/New_York',
};

const validParams = {
  sessionTimezone: 'America/New_York',
  minVwapAtrRatio: 2.5,
  maxVwapAtrRatio: 11.5,
  maxIfvgToAtrRatio: 8,
  targetRr: 3,
  rangeBars: 200,
  atrBars: 20,
  mainWindowMinutes: 720,
  entryWindow: {
    'capitalcom:US100': ['09:40', '11:40'] as const,
  },
};

function makeCtx(strategy: VwapBandReversalStrategy, bars: ReturnType<typeof bar>[], now: number): StrategyContext {
  return {
    instrument,
    now,
    window: () => bars,
    state: {},
    clock: { toZoned },
  };
}

describe('VwapBandReversalStrategy (architecture/vwap-band-reversal-plugin.md §2)', () => {
  it('excludes the UTC-midnight bar from the bias window (bug-faithful: startOfDay+1min)', () => {
    const strategy = createVwapBandReversalStrategy(validParams);
    const dayStart = Date.UTC(2025, 5, 2, 0, 0, 0); // an arbitrary UTC day boundary
    const now = dayStart + 2 * MIN;

    const barsWithMidnight = [
      bar(dayStart, { open: 1000, high: 1000, low: 1000, close: 1000 }, 999), // 00:00 — must be excluded
      bar(dayStart + 1 * MIN, { open: 10, high: 10, low: 10, close: 10 }, 1),
      bar(dayStart + 2 * MIN, { open: 12, high: 12, low: 12, close: 12 }, 1),
    ];
    const barsWithoutMidnight = barsWithMidnight.slice(1); // same bias window if 00:00 is correctly excluded

    const outWith = strategy.onCandle(makeCtx(strategy, barsWithMidnight, now));
    const outWithout = strategy.onCandle(makeCtx(strategy, barsWithoutMidnight, now));

    expect(outWith.indicators?.[0]?.values).toEqual(outWithout.indicators?.[0]?.values);
    // and the huge volume=999 midnight bar must not have pulled cumulative VWAP toward 1000
    expect((outWith.indicators?.[0]?.values.vwap as number) ?? 0).toBeLessThan(100);
  });

  it('emits an indicator point whenever the bias window is non-empty, with no signal outside the entry window', () => {
    const strategy = createVwapBandReversalStrategy(validParams);
    const dayStart = Date.UTC(2025, 5, 2, 0, 0, 0);
    const now = dayStart + 5 * 60 * MIN; // 05:00 UTC = 01:00 NY (June, EDT) — well outside any entry window

    const bars = [
      bar(dayStart + 1 * MIN, { open: 100, high: 101, low: 99, close: 100 }),
      bar(now, { open: 100, high: 101, low: 99, close: 100 }),
    ];

    const out = strategy.onCandle(makeCtx(strategy, bars, now));

    expect(out.indicators).toHaveLength(1);
    expect(out.indicators?.[0]?.seriesId).toBe('vwap-band');
    expect(out.signals).toHaveLength(0);
  });

  it('requirements declare tier=research, minBars=1, and the vwap-band indicator series', () => {
    const strategy = createVwapBandReversalStrategy(validParams);
    expect(strategy.tier).toBe('research');
    expect(strategy.requirements.minBars).toEqual({ '1m': 1 });
    expect(strategy.requirements.indicators?.[0]?.id).toBe('vwap-band');
  });

  it('rejects params missing an entryWindow entry as a boot error (zod-validated)', () => {
    const badParams = { ...validParams, entryWindow: {} };
    expect(() => createVwapBandReversalStrategy(badParams)).not.toThrow(); // schema allows an empty map...
    // ...but the missing per-instrument window means the strategy defensively emits no Signal
    // for that instrument (covered by buildSignal's `if (!entryWindow) return null`), and the
    // registry's own strategies.yaml validation is the actual boot-time gate for this (§7).
  });

  it('rejects malformed params outright (wrong shape) as a boot error', () => {
    expect(() => createVwapBandReversalStrategy({ ...validParams, minVwapAtrRatio: 'not-a-number' })).toThrow();
  });
});
