import type { Instrument, MetricAggregate, MetricKind, MetricUnit, Panel } from '@trade-automation/contracts';

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
 * §11.1 — the unit the metric panel shows: it plots the notional side, which is by definition in
 * the instrument's quoteCurrency (`BTCUSDT · Open interest · USDT`), whatever `unit` `value` is in.
 * Null until the series has data.
 */
export function plottedMetricUnit(points: readonly unknown[]): MetricUnit | null {
  return points.length > 0 ? 'quote' : null;
}

/**
 * The panel header text. Candle panels: the layout's `title`, else the instrument's displayName.
 * Metric panels: the layout's `title`, else `<symbol> · <metric label>`, then ` · <unit>` once
 * the series has told us its unit (`BTCUSDT · Open interest · BTC`).
 * Aggregate panels (architecture/aggregate-oi.md §1): `<displayName> · <metric label> · USD` — the
 * legs are USDT and USDC summed at par (§4), so the unit is USD, not any one leg's quote currency.
 */
export function panelTitle(
  panel: Panel,
  instrument: Pick<Instrument, 'symbol' | 'quoteCurrency' | 'displayName'> | null,
  unit: MetricUnit | null,
  aggregate: Pick<MetricAggregate, 'displayName'> | null = null,
): string {
  if (panel.kind !== 'metric') {
    return panel.title ?? instrument?.displayName ?? panel.instrument;
  }
  const label = panel.metric ? METRIC_LABELS[panel.metric] : 'Metric';
  if (panel.aggregate) {
    const head = panel.title ?? `${aggregate?.displayName ?? panel.aggregate} · ${label}`;
    return unit ? `${head} · USD` : head;
  }
  const symbol = instrument?.symbol ?? panel.instrument.slice(panel.instrument.indexOf(':') + 1);
  const head = panel.title ?? `${symbol} · ${label}`;
  return unit && instrument ? `${head} · ${metricUnitLabel(unit, instrument)}` : head;
}
