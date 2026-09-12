import { Injectable, effect, signal } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { InstrumentsStore } from './instruments.store';
import { LayoutsStore } from './layouts.store';
import { TimeframeStore } from './timeframe.store';
import { ConnectionStore } from './connection.store';
import { PanelFeed } from './panel-feed';
import type { Layout, Timeframe } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §6.2 — replaces `MarketFeedService`. Boots
 * the app, then rebuilds one `PanelFeed` per panel whenever the active
 * layout or the shared timeframe changes: stop all → construct new
 * `PanelFeed`s → start all. Switching layout/timeframe is subscription
 * churn on the one socket, never a reconnect — `LiveSocket` itself is
 * untouched by a rebuild.
 */
@Injectable({ providedIn: 'root' })
export class LayoutFeedService {
  private feedsByPanelId = new Map<string, PanelFeed>();
  private readonly feedsSignal = signal<ReadonlyMap<string, PanelFeed>>(new Map());
  private rebuildToken = 0;

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
  ) {
    effect(() => {
      const layout = this.layouts.active();
      const tf = this.timeframe.selected();
      if (layout) {
        void this.rebuild(layout, tf);
      }
    });
  }

  async boot(): Promise<void> {
    await this.config.load();
    const [instruments, layouts] = await Promise.all([this.rest.getInstruments(), this.rest.getLayouts()]);
    this.instruments.setInstruments(instruments);
    this.layouts.setLayouts(layouts);

    this.socket.connectionState.subscribe((state) => this.connection.setConnectionState(state));
    this.socket.statusFrames$.subscribe((frame) =>
      this.connection.setVenueStatus(frame.instrument, frame.venueStatus, frame.lastClosedCandleTime),
    );
    this.socket.reconnected.subscribe(() => void this.healAllAfterReconnect());
    this.socket.connect(this.config.get().wsUrl);
  }

  feedFor(panelId: string): PanelFeed | undefined {
    return this.feedsByPanelId.get(panelId);
  }

  async loadOlder(panelId: string): Promise<void> {
    await this.feedsByPanelId.get(panelId)?.loadOlder();
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
    this.feedsSignal.set(new Map(nextFeeds));

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
