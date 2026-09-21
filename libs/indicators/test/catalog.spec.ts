import { Candle } from '@trade-automation/contracts';
import { INDICATOR_CATALOG, defaultParams, indicatorById } from '../src';
import { bar } from './test-helpers';

describe('INDICATOR_CATALOG (T-027) — what the client picker renders', () => {
  const bars: Candle[] = Array.from({ length: 120 }, (_, i) => bar(i * 60_000, { open: 100, high: 101 + (i % 5), low: 99 - (i % 3), close: 100 + Math.sin(i) }));

  it('lists the six indicators once each, with the right panes', () => {
    expect(INDICATOR_CATALOG.map((e) => [e.id, e.pane])).toEqual([
      ['sma', 'overlay'],
      ['ema', 'overlay'],
      ['bollinger', 'overlay'],
      ['rsi', 'separate'],
      ['macd', 'separate'],
      ['stochastic', 'separate'],
    ]);
  });

  it('defaults are the classic settings', () => {
    expect(Object.fromEntries(INDICATOR_CATALOG.map((e) => [e.id, defaultParams(e)]))).toEqual({
      sma: { length: 20 },
      ema: { length: 20 },
      bollinger: { length: 20, stdDevs: 2 },
      rsi: { length: 14 },
      macd: { fast: 12, slow: 26, signal: 9 },
      stochastic: { kLength: 14, dLength: 3, smoothing: 3 },
    });
  });

  it('every entry computes, with its defaults, exactly the output series it declares; every default is inside its range', () => {
    for (const entry of INDICATOR_CATALOG) {
      const out = entry.compute(bars, defaultParams(entry));
      expect({ id: entry.id, keys: Object.keys(out).sort() }).toEqual({ id: entry.id, keys: entry.outputs.map((o) => o.key).sort() });
      expect(Object.values(out).every((s) => s.length > 0)).toBe(true);
      for (const p of entry.params) expect(p.default >= p.min && p.default <= p.max).toBe(true);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('oscillators carry a 0..100 range and reference levels; indicatorById finds entries', () => {
    expect(indicatorById('rsi')).toMatchObject({ range: { min: 0, max: 100 }, levels: [30, 70] });
    expect(indicatorById('stochastic')).toMatchObject({ range: { min: 0, max: 100 }, levels: [20, 80] });
    expect(indicatorById('macd')?.levels).toEqual([0]);
    expect(indicatorById('nope')).toBeUndefined();
  });
});
