import type { Instrument, MetricKind, MetricUnit, Panel } from '@trade-automation/contracts';

const METRIC_LABELS: Record<MetricKind, string> = {
  openInterest: 'Open interest',
};

/**
 * architecture/chart-layouts.md §11.1 — what a metric value's `unit` reads as in the header:
 * 'base' → the base asset (`symbol` minus its `quoteCurrency` suffix: BTCUSDT → BTC),
 * 'quote' → the quoteCurrency, 'contracts' → `contracts`.
 */
export function metricUnitLabel(unit: MetricUnit, instrument: Pick<Instrument, 'symbol' | 'quoteCurrency'>): string {
  switch (unit) {
    case 'base': {
      const { symbol, quoteCurrency } = instrument;
      return symbol.endsWith(quoteCurrency) && symbol.length > quoteCurrency.length
        ? symbol.slice(0, -quoteCurrency.length)
        : symbol;
    }
    case 'quote':
      return instrument.quoteCurrency;
    case 'contracts':
      return 'contracts';
  }
}

/**
 * The panel header text. Candle panels: the layout's `title`, else the instrument's displayName.
 * Metric panels: the layout's `title`, else `<symbol> · <metric label>`, then ` · <unit>` once
 * the series has told us its unit (`BTCUSDT · Open interest · BTC`).
 */
export function panelTitle(
  panel: Panel,
  instrument: Pick<Instrument, 'symbol' | 'quoteCurrency' | 'displayName'> | null,
  unit: MetricUnit | null,
): string {
  if (panel.kind !== 'metric') {
    return panel.title ?? instrument?.displayName ?? panel.instrument;
  }
  const symbol = instrument?.symbol ?? panel.instrument.slice(panel.instrument.indexOf(':') + 1);
  const head = panel.title ?? `${symbol} · ${panel.metric ? METRIC_LABELS[panel.metric] : 'Metric'}`;
  return unit && instrument ? `${head} · ${metricUnitLabel(unit, instrument)}` : head;
}
