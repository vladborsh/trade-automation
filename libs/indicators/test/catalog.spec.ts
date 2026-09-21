import { Candle } from '@trade-automation/contracts';
import { INDICATOR_CATALOG, defaultParams, indicatorById } from '../src';
import real from './fixtures/btcusdt-1m-2days.json';

describe('INDICATOR_CATALOG (T-027, T-034) — what the client picker renders', () => {
  // Real bars (T-034): Range(200) needs 201 bars and the iFVG line needs real gaps.
  const bars: Candle[] = (real.bars as number[][]).map(([openTime, open, high, low, close, volume]) => ({
    instrument: 'binance:BTCUSDT', timeframe: '1m', openTime, open, high, low, close, volume, closed: true, source: 'venue-rest',
  }));

  it('lists the eleven indicators once each, with the right panes', () => {
    expect(INDICATOR_CATALOG.map((e) => [e.id, e.pane])).toEqual([
      ['sma', 'overlay'],
      ['ema', 'overlay'],
      ['bollinger', 'overlay'],
      ['rsi', 'separate'],
      ['macd', 'separate'],
      ['stochastic', 'separate'],
      ['vwap', 'overlay'],
      ['atr', 'separate'],
      ['range', 'overlay'],
      ['prev-hour', 'overlay'],
      ['fvg', 'overlay'],
    ]);
  });

  it('defaults are the classic settings, and the plug-in\'s for the lifted five', () => {
    expect(Object.fromEntries(INDICATOR_CATALOG.map((e) => [e.id, defaultParams(e)]))).toEqual({
      sma: { length: 20 },
      ema: { length: 20 },
      bollinger: { length: 20, stdDevs: 2 },
      rsi: { length: 14 },
      macd: { fast: 12, slow: 26, signal: 9 },
      stochastic: { kLength: 14, dLength: 3, smoothing: 3 },
      // T-034: the vwap-band-reversal plug-in's (strategies.yaml atrBars, rangeBars)
      vwap: {},
      atr: { length: 20 },
      range: { length: 200 },
      'prev-hour': {},
      fvg: {},
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
