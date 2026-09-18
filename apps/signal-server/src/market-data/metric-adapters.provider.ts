import { Venue } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { MetricAdapter } from './metrics/metric-adapter.port';
import { BinanceMetricsAdapter } from './metrics/binance/binance-metrics.adapter';
import { ReplayMetricAdapter } from './metrics/replay/replay-metric.adapter';

/**
 * architecture/chart-layouts.md §4.4 — `buildVenueAdapters`'s sibling, a separate function
 * (not a method on VenueAdapter): only venues that actually expose a metric get an adapter
 * here. Capital.com has no open interest, so it never appears in this map — a layout's metric
 * panel on a venue with no MetricAdapter is logged and marked 'down' by
 * MetricIngestionService, not a boot failure (same "no adapter for venue" precedent as
 * IngestionService).
 */
export function buildMetricAdapters(config: AppConfigService): Map<Venue, MetricAdapter> {
  const env = config.env;
  const mode = env.get('MARKET_DATA_MODE');
  const adapters = new Map<Venue, MetricAdapter>();

  if (mode === 'replay') {
    // aggregate-oi.md §5 — every aggregate leg replays from fixtures, so C3/C5 run end-to-end.
    for (const venue of ['binance', 'bybit', 'hyperliquid'] as const) {
      adapters.set(venue, new ReplayMetricAdapter(venue, env.get('REPLAY_FIXTURES_DIR')));
    }
    return adapters;
  }

  adapters.set('binance', new BinanceMetricsAdapter(env.get('BINANCE_REST_BASE_URL')));
  return adapters;
}
