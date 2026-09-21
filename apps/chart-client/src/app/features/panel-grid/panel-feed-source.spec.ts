import { vi } from 'vitest';
import { signal } from '@angular/core';
import type { IndicatorSeriesSpec, Panel, Signal as TradeSignal } from '@trade-automation/contracts';
import { PanelFeed, type PanelFeedDeps } from '../../core/state/panel-feed';
import { signalsToOverlays } from '../chart/overlay/signal-to-overlays';
import { panelFeedSource } from './panel-feed-source';

const NO_DEPS = {} as PanelFeedDeps; // never started: the adapter must not touch REST or the socket

const entry: TradeSignal = {
  id: '00000000-0000-4000-8000-00000000000a',
  strategyId: 'example-cross',
  instrument: 'binance:BTCUSDT',
  timeframe: '5m',
  time: 300_000,
  tier: 'demo',
  kind: 'entry',
  direction: 'long',
  overlay: [{ type: 'priceLine', price: 100, label: 'entry' }],
  meta: {},
};

function feedFor(panel: Panel): PanelFeed {
  const feed = new PanelFeed(panel, '5m', NO_DEPS);
  feed.signals.setHistory([entry]);
  return feed;
}

describe('panelFeedSource (backtest-app-system-design.md §2.3, D2)', () => {
  const specs = signal<ReadonlyMap<string, IndicatorSeriesSpec>>(new Map());

  it('exposes the feed’s own store signals as-is', () => {
    const feed = feedFor({ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: true });
    const source = panelFeedSource(feed, specs);

    expect(source.panel).toBe(feed.panel);
    expect(source.candles).toBe(feed.candles.candles);
    expect(source.points).toBe(feed.points.points);
    expect(source.indicatorPoints).toBe(feed.indicators.points);
    expect(source.indicatorSpecs).toBe(specs);
    expect(source.researchScope).toEqual({ signals: feed.signals, indicators: feed.indicators });
  });

  it('derives overlays from signals on candle panels only, as ChartPanelComponent did', () => {
    const candles = panelFeedSource(feedFor({ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: true }), specs);
    expect(candles.overlays()).toEqual(signalsToOverlays([entry]));
    expect(candles.overlays().length).toBeGreaterThan(0);

    const metric = panelFeedSource(
      feedFor({ id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest', signals: false }),
      specs,
    );
    expect(metric.overlays()).toEqual([]);
  });

  it('delegates loadOlder to the feed', async () => {
    const feed = feedFor({ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false });
    const loadOlder = vi.spyOn(feed, 'loadOlder').mockResolvedValue(undefined);

    await panelFeedSource(feed, specs).loadOlder();
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});
