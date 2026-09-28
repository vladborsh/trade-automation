import { Injectable, effect, signal } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { InstrumentsStore } from './instruments.store';
import { LayoutsStore } from './layouts.store';
import { TimeframeStore } from './timeframe.store';
import { ConnectionStore } from './connection.store';
import { StrategiesStore } from './strategies.store';
import { PanelFeed } from './panel-feed';
import type { PanelSource } from '../../features/panel-grid/panel-source';
import { panelFeedSource } from '../../features/panel-grid/panel-feed-source';
import type { Layout, Timeframe } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §6.2 — replaces `MarketFeedService`. Boots
 * the app, then rebuilds one `PanelFeed` per panel whenever the active
 * layout or the shared timeframe changes: stop all → construct new
 * `PanelFeed`s → start all. Switching layout/timeframe is subscription
 * churn on the one socket, never a reconnect — `LiveSocket` itself is
 * untouched by a rebuild.
 *
 * backtest-app-system-design.md §2.3 (D2): the panels see each feed only as a `PanelSource`
 * (`feeds()`); the concrete `PanelFeed`s stay private here, for stop/start/heal.
 */
@Injectable({ providedIn: 'root' })
export class LayoutFeedService {
  private feedsByPanelId = new Map<string, PanelFeed>();
  private readonly feedsSignal = signal<ReadonlyMap<string, PanelSource>>(new Map());
  private rebuildToken = 0;
  private booting: Promise<void> | null = null;

  /** Reactive so `PanelGridComponent`'s template re-renders as feeds are (re)built. */
  readonly feeds = this.feedsSignal.asReadonly();

  constructor(
    private readonly config: AppConfigService,
    private readonly rest: RestClient,
    private readonly socket: LiveSocket,
    private readonly instruments: InstrumentsStore,
    private readonly layouts: LayoutsStore,
    private readonly timeframe: TimeframeStore,
    private readonly connection: ConnectionStore,
    private readonly strategies: StrategiesStore,
  ) {
    effect(() => {
      const layout = this.layouts.active();
      const tf = this.timeframe.selected();
      if (layout) {
        void this.rebuild(layout, tf);
      }
    });
  }

  /**
   * Once per app load. `/terminal` is a route (backtest-app-system-design.md §2.3), so the
   * shell — which calls this from its constructor — is re-created each time the user comes
   * back to it; the feeds and the socket are root singletons and must not be booted twice.
   */
  boot(): Promise<void> {
    this.booting ??= this.bootOnce().catch((err: unknown) => {
      this.booting = null; // a failed boot may be retried on the next visit
      throw err;
    });
    return this.booting;
  }

  private async bootOnce(): Promise<void> {
    await this.config.load();
    const [instruments, layouts] = await Promise.all([this.rest.getInstruments(), this.rest.getLayouts()]);
    this.instruments.setInstruments(instruments);
    this.layouts.setLayouts(layouts);

    this.socket.connectionState.subscribe((state) => this.connection.setConnectionState(state));
    this.socket.statusFrames$.subscribe((frame) =>
      this.connection.setVenueStatus(frame.instrument, frame.venueStatus, frame.lastClosedCandleTime),
    );
    this.socket.reconnected.subscribe(() => void this.healAllAfterReconnect());
    const { wsUrl } = this.config.get();
    // IB-030 made `wsUrl` optional for the dashboard, which has no socket. The backtest SPA does,
    // so a config without it is a misconfigured deployment and must fail loudly here rather than
    // connect to `undefined`.
    if (!wsUrl) throw new Error('config.json has no wsUrl: the backtest client needs one to stream');
    this.socket.connect(wsUrl);
  }

  private async rebuild(layout: Layout, tf: Timeframe): Promise<void> {
    const token = ++this.rebuildToken;

    for (const feed of this.feedsByPanelId.values()) {
      feed.stop();
    }

    const nextFeeds = new Map<string, PanelFeed>();
    for (const panel of layout.panels) {
      nextFeeds.set(panel.id, new PanelFeed(panel, tf, { rest: this.rest, socket: this.socket }));
    }
    this.feedsByPanelId = nextFeeds;
    this.feedsSignal.set(
      new Map([...nextFeeds].map(([panelId, feed]) => [panelId, panelFeedSource(feed, this.strategies.indicatorSpecs, this.connection)])),
    );

    await Promise.all([...nextFeeds.values()].map((feed) => feed.start()));

    if (token !== this.rebuildToken) {
      // a newer rebuild started while this one's history fetches were in flight —
      // this one is already superseded, stop what it just started and let the newer one own the feeds
      for (const feed of nextFeeds.values()) {
        feed.stop();
      }
    }
  }

  private async healAllAfterReconnect(): Promise<void> {
    await Promise.all([...this.feedsByPanelId.values()].map((feed) => feed.healAfterReconnect()));
  }
}
