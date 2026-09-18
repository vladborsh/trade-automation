import type { Timeframe } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §11.2 rule 4 — how a metric panel draws. At 1 m a line: history
 * buckets sit 5 min apart with no predecessor, so candles there would be flat dashes next to a
 * live part with bodies. Every other timeframe draws candles.
 */
export type MetricSeriesStyle = 'line' | 'candles';

export function metricSeriesStyle(tf: Timeframe): MetricSeriesStyle {
  return tf === '1m' ? 'line' : 'candles';
}

export interface MetricSeriesCaption {
  text: string;
  tooltip: string;
}

/** §11.2 rule 5 — the header caption chip telling the user why the panel looks the way it does; none at ≥ 15 m. */
export function metricSeriesCaption(tf: Timeframe): MetricSeriesCaption | null {
  switch (tf) {
    case '1m':
      return {
        text: 'line · source is one reading per 5 min',
        tooltip:
          'Open-interest history is one reading per 5 minutes, so 1-minute candles would be flat dashes. ' +
          'Drawn as a line; switch to 5m or higher for candles.',
      };
    case '5m':
      return {
        text: 'candles: change per 5 min, no wicks',
        tooltip:
          'Each candle opens at the previous close and closes at the latest reading: the body is the change ' +
          'over 5 minutes. There is one reading per 5 minutes, so there are no wicks.',
      };
    default:
      return null;
  }
}

/** §11.2 rule 5 — OI candles use their own colours so they never read as price candles. */
export const METRIC_UP_COLOR = '#58a6ff';
export const METRIC_DOWN_COLOR = '#f0883e';
