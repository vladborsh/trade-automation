import type { Timeframe } from '@trade-automation/contracts';
import { metricSeriesCaption, metricSeriesStyle } from './metric-series-style';

describe('metricSeriesStyle (architecture/chart-layouts.md §11.2 rule 4)', () => {
  it('draws a line at 1m and candles at every other timeframe', () => {
    expect(metricSeriesStyle('1m')).toBe('line');
    const others: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
    for (const tf of others) {
      expect(metricSeriesStyle(tf)).toBe('candles');
    }
  });
});

describe('metricSeriesCaption (§11.2 rule 5)', () => {
  it('explains the line at 1m and the wickless candles at 5m', () => {
    expect(metricSeriesCaption('1m')?.text).toBe('line · source is one reading per 5 min');
    expect(metricSeriesCaption('5m')?.text).toBe('candles: change per 5 min, no wicks');
    expect(metricSeriesCaption('1m')?.tooltip).toBeTruthy();
    expect(metricSeriesCaption('5m')?.tooltip).toBeTruthy();
  });

  it('has no caption at 15m and above', () => {
    const tfs: Timeframe[] = ['15m', '1h', '4h', '1d'];
    for (const tf of tfs) {
      expect(metricSeriesCaption(tf)).toBeNull();
    }
  });
});
