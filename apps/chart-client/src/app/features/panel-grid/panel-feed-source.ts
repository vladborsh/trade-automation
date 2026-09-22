import { type Signal, computed } from '@angular/core';
import type { IndicatorSeriesSpec } from '@trade-automation/contracts';
import type { ConnectionStore } from '../../core/state/connection.store';
import type { PanelFeed } from '../../core/state/panel-feed';
import { signalsToOverlays } from '../chart/overlay/signal-to-overlays';
import type { PanelSource } from './panel-source';

/**
 * The live terminal's `PanelSource` (backtest-app-system-design.md §2.3, D2): a thin adapter
 * over one `PanelFeed`, with no behaviour of its own. `overlays` is derived exactly as
 * `ChartPanelComponent` derived it before the boundary existed (signal markers on candle panels
 * only); `indicatorSpecs` is the app-wide strategies catalogue, which is what the panel used to
 * read from `StrategiesStore` directly. `venueStatus` (T-060) is the live connection's status for
 * the panel's instrument, `down` until the server has reported one — what the panel header read
 * from `ConnectionStore` directly before.
 */
export function panelFeedSource(
  feed: PanelFeed,
  indicatorSpecs: Signal<ReadonlyMap<string, IndicatorSeriesSpec>>,
  connection: Pick<ConnectionStore, 'statusFor'>,
): PanelSource {
  return {
    panel: feed.panel,
    candles: feed.candles.candles,
    points: feed.points.points,
    overlays: computed(() => (feed.panel.kind === 'candles' ? signalsToOverlays(feed.signals.signals()) : [])),
    indicatorPoints: feed.indicators.points,
    indicatorSpecs,
    researchScope: { signals: feed.signals, indicators: feed.indicators },
    venueStatus: computed(() => connection.statusFor(feed.panel.instrument)?.venueStatus ?? 'down'),
    loadOlder: () => feed.loadOlder(),
  };
}
