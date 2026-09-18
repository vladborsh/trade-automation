import { Venue } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { MetricAdapter } from './metrics/metric-adapter.port';
import { BinanceMetricsAdapter } from './metrics/binance/binance-metrics.adapter';
import { BybitMetricsAdapter } from './metrics/bybit/bybit-metrics.adapter';
import { MetricsService } from '../observability/metrics.service';
import { ReplayMetricAdapter } from './metrics/replay/replay-metric.adapter';

/**
 * architecture/chart-layouts.md §4.4 — `buildVenueAdapters`'s sibling, a separate function
 * (not a method on VenueAdapter): only venues that actually expose a metric get an adapter
 * here. Capital.com has no open interest, so it never appears in this map — a layout's metric
 * panel on a venue with no MetricAdapter is logged and marked 'down' by
 * MetricIngestionService, not a boot failure (same "no adapter for venue" precedent as
 * IngestionService).
 */
export function buildMetricAdapters(
  config: AppConfigService,
  appMetrics?: MetricsService,
): Map<Venue, MetricAdapter> {
  const env = config.env;
  const mode = env.get('MARKET_DATA_MODE');
  const adapters = new Map<Venue, MetricAdapter>();

  if (mode === 'replay') {
    adapters.set('binance', new ReplayMetricAdapter('binance', env.get('REPLAY_FIXTURES_DIR')));
    return adapters;
  }

  adapters.set('binance', new BinanceMetricsAdapter(env.get('BINANCE_REST_BASE_URL')));
  adapters.set(
    'bybit',
    new BybitMetricsAdapter(env.get('BYBIT_REST_BASE_URL'), {
      historyDays: env.get('BYBIT_OI_HISTORY_DAYS'),
      onSidednessDrift: (source) => appMetrics?.metricSidednessDriftTotal.inc({ source }),
    }),
  );
  return adapters;
}
