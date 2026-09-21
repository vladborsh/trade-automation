import type { Candle } from '@trade-automation/contracts';
import { INDICATOR_CATALOG, computeAtr, indicatorById } from '@trade-automation/indicators';
import { acceptParam, effectiveParams, indicatorLabel, newIndicator, panelAtr14, panelIndicators } from './panel-indicators';

const M = 60_000;
function bars(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + Math.sin(i / 3) * 5 + i * 0.1;
    return { instrument: 'binance:BTCUSDT', timeframe: '5m', openTime: i * 5 * M, open: close - 0.3, high: close + 1 + (i % 3) * 0.2, low: close - 1 - (i % 2) * 0.3, close, volume: 1 + (i % 7), closed: true, source: 'storage' };
  });
}

describe('panel-indicators (T-028)', () => {
  const B = bars(120);

  it('computes every catalogue indicator with the lib function, one point per bar, one spec per instance', () => {
    const indicators = INDICATOR_CATALOG.map((e) => newIndicator(e.id)!);
    const view = panelIndicators(B, indicators, 'binance:BTCUSDT', '5m');
    expect(view.specs.size).toBe(INDICATOR_CATALOG.length);
    INDICATOR_CATALOG.forEach((entry, i) => {
      const seriesId = `${entry.id}-${i}`;
      const spec = view.specs.get(`replay:${seriesId}`)!;
      expect(spec.scale).toBe(entry.pane === 'separate' ? 'pane' : 'price');
      expect(spec.keys.map((k) => k.key)).toEqual(entry.outputs.map((o) => o.key));
      const direct = entry.compute(B, effectiveParams(entry, {}));
      const mine = view.points.filter((p) => p.seriesId === seriesId);
      for (const o of entry.outputs) {
        const shown = mine.filter((p) => p.values[o.key] !== null).map((p) => ({ time: p.time, value: p.values[o.key] }));
        expect([entry.id, o.key, shown]).toEqual([entry.id, o.key, direct[o.key]]);
      }
      expect(mine.every((p) => p.timeframe === '5m' && p.strategyId === 'replay')).toBe(true);
    });
    expect(view.specs.get('replay:rsi-3')).toMatchObject({ range: { min: 0, max: 100 }, levels: [30, 70] });
  });

  it('two instances of one indicator are separate series; stored params override the defaults', () => {
    const view = panelIndicators(B, [{ id: 'ema', params: { length: 9 } }, { id: 'ema', params: { length: 21, junk: 'x' } }], 'binance:BTCUSDT', '5m');
    expect([...view.specs.values()].map((s) => s.label)).toEqual(['EMA (9)', 'EMA (21)']);
  });

  it('skips unknown ids and params the function refuses; nothing for an empty panel', () => {
    expect(panelIndicators(B, [{ id: 'no-such-indicator', params: {} }, { id: 'ema', params: { length: 0 } }], 'binance:BTCUSDT', '5m')).toEqual({ points: [], specs: new Map() });
    expect(panelIndicators([], [{ id: 'ema', params: {} }], 'binance:BTCUSDT', '5m').specs.size).toBe(0);
    expect(panelIndicators(B, undefined, 'binance:BTCUSDT', '5m').points).toEqual([]);
  });

  it('labels, param acceptance and ATR(14)', () => {
    const macd = indicatorById('macd')!;
    expect(indicatorLabel(macd, effectiveParams(macd, {}))).toBe('MACD (12, 26, 9)');
    for (const [id, label] of [['vwap', 'VWAP'], ['prev-hour', 'PREV-HOUR'], ['fvg', 'FVG'], ['atr', 'ATR (20)']]) {
      expect(indicatorLabel(indicatorById(id)!, effectiveParams(indicatorById(id)!, {}))).toBe(label); // T-034: no empty "()"
    }
    expect(acceptParam(macd, 'fast', '8')).toBe(8);
    expect(acceptParam(macd, 'fast', '8.5')).toBeNull(); // integer
    expect(acceptParam(macd, 'fast', '0')).toBeNull(); // below min
    expect(acceptParam(macd, 'fast', '')).toBeNull();
    expect(acceptParam(indicatorById('bollinger')!, 'stdDevs', '2.5')).toBe(2.5);
    expect(acceptParam(macd, 'nope', '5')).toBeNull();
    expect(panelAtr14(B)).toBe(computeAtr(B, 14));
    expect(panelAtr14(B.slice(0, 14))).toBeNull();
    expect(newIndicator('nope')).toBeNull();
  });
});
