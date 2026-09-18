import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, computed, effect, inject, signal } from '@angular/core';
import type { Panel } from '@trade-automation/contracts';
import { ChartSyncService } from '../chart/chart-sync.service';
import { LayoutsStore } from '../../core/state/layouts.store';
import { LayoutFeedService } from '../../core/state/layout-feed.service';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { SignalsStore } from '../../core/state/signals.store';
import { IndicatorsStore } from '../../core/state/indicators.store';
import type { PanelFeed } from '../../core/state/panel-feed';
import { ChartPanelComponent } from './chart-panel.component';

/**
 * architecture/chart-layouts.md §6.1/§6.4 — CSS grid sized from
 * `layout.grid`, one `ChartPanelComponent` per panel. Provides
 * `ChartSyncService` for this grid instance (one shared sync per active
 * layout, fresh on every layout switch since the component itself is
 * recreated) so tests can instantiate it in isolation.
 *
 * Each panel is rendered through `NgComponentOutlet` with a per-panel child
 * `Injector` that overrides `InstrumentsStore`/`SignalsStore`/`IndicatorsStore`
 * with instances scoped to that one panel — see chart-panel.component.ts's
 * doc comment for why (keeping the VWAP client unit's `ResearchBadgeComponent`
 * working, unmodified, per panel instead of per one globally-selected
 * instrument).
 *
 * Injectors are built inside an `effect()`, never inline in the template:
 * building one calls `InstrumentsStore.setInstruments()`/`.select()` on a
 * fresh scoped instance, which are signal writes, and Angular forbids
 * writing a signal from code invoked while it is refreshing a view
 * (`NG0600`) even when that signal is private and untracked by anything
 * else. The effect populates a `WeakMap` keyed by `PanelFeed` identity (so
 * it needs no explicit invalidation — a rebuild's new `PanelFeed`s simply
 * miss the cache) and bumps a plain version signal so the template's
 * (read-only) `injectorFor()` lookups re-run once an entry lands. A stable
 * `Injector` reference across change-detection cycles for the same feed
 * also matters because `NgComponentOutlet` recreates its component whenever
 * the injector reference changes.
 */
@Component({
  selector: 'app-panel-grid',
  standalone: true,
  imports: [NgComponentOutlet],
  providers: [ChartSyncService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-grid.component.html',
  styleUrl: './panel-grid.component.scss',
})
export class PanelGridComponent {
  readonly chartPanelComponent = ChartPanelComponent;

  readonly panels = computed(() => this.layouts.active()?.panels ?? []);

  private readonly injector = inject(Injector);
  private readonly injectorCache = new WeakMap<PanelFeed, Injector>();
  private readonly injectorVersion = signal(0);

  constructor(
    private readonly layouts: LayoutsStore,
    private readonly layoutFeed: LayoutFeedService,
    private readonly instruments: InstrumentsStore,
  ) {
    effect(() => {
      const feeds = this.layoutFeed.feeds();
      let changed = false;
      for (const feed of feeds.values()) {
        if (!this.injectorCache.has(feed)) {
          this.injectorCache.set(feed, this.buildInjector(feed));
          changed = true;
        }
      }
      if (changed) {
        this.injectorVersion.update((v) => v + 1);
      }
    });
  }

  gridColumns(): string {
    const grid = this.layouts.active()?.grid;
    return grid ? `repeat(${grid.columns}, 1fr)` : '1fr';
  }

  gridRows(): string {
    const grid = this.layouts.active()?.grid;
    return grid ? `repeat(${grid.rows}, 1fr)` : '1fr';
  }

  feedFor(panelId: string): PanelFeed | undefined {
    return this.layoutFeed.feeds().get(panelId);
  }

  /** Pure read (plus a signal read for reactivity) — never builds anything itself. */
  injectorFor(feed: PanelFeed): Injector | undefined {
    this.injectorVersion();
    return this.injectorCache.get(feed);
  }

  panelInputs(panel: Panel, feed: PanelFeed): Record<string, unknown> {
    return { panel, feed };
  }

  private buildInjector(feed: PanelFeed): Injector {
    const scopedInstruments = new InstrumentsStore();
    scopedInstruments.setInstruments(this.instruments.instruments());
    scopedInstruments.select(feed.panel.instrument);

    return Injector.create({
      parent: this.injector,
      providers: [
        { provide: InstrumentsStore, useValue: scopedInstruments },
        { provide: SignalsStore, useValue: feed.signals },
        { provide: IndicatorsStore, useValue: feed.indicators },
      ],
    });
  }
}
