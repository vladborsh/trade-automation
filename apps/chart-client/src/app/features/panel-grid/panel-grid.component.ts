import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { Panel, Timeframe } from '@trade-automation/contracts';
import { ChartSyncService } from '../chart/chart-sync.service';
import { LayoutsStore } from '../../core/state/layouts.store';
import { LayoutFeedService } from '../../core/state/layout-feed.service';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { SignalsStore } from '../../core/state/signals.store';
import { IndicatorsStore } from '../../core/state/indicators.store';
import { CollapsedPanelsStore } from '../../core/state/collapsed-panels.store';
import { ChartPanelComponent } from './chart-panel.component';
import { CollapsedPanelStripComponent } from './collapsed-panel-strip.component';
import { panelTitle } from './panel-title';
import type { PanelSource } from './panel-source';

/**
 * architecture/chart-layouts.md §6.1/§6.4, amended by §11.3 — ONE ROW of columns, left to
 * right in panel order, for every layout (`layout.grid` only bounds the panel count now; it is
 * not read for arrangement). One `ChartPanelComponent` per expanded panel; a collapsed panel is a
 * `CollapsedPanelStripComponent` instead, so its chart is destroyed, not hidden (§11.3 sync
 * rule 1) while its source (a `PanelFeed`, owned by `LayoutFeedService`) keeps running. Provides
 * `ChartSyncService` for this grid instance (one shared sync, reset on every
 * feed rebuild — layout or timeframe change) so tests can instantiate it in
 * isolation.
 *
 * Each panel is rendered through `NgComponentOutlet` with a per-panel child
 * `Injector` that overrides `InstrumentsStore` — and, when the source carries a
 * `researchScope` (panel-source.ts), `SignalsStore`/`IndicatorsStore` — with
 * instances scoped to that one panel — see chart-panel.component.ts's
 * doc comment for why (keeping the VWAP client unit's `ResearchBadgeComponent`
 * working, unmodified, per panel instead of per one globally-selected
 * instrument).
 *
 * Injectors are built inside an `effect()`, never inline in the template:
 * building one calls `InstrumentsStore.setInstruments()`/`.select()` on a
 * fresh scoped instance, which are signal writes, and Angular forbids
 * writing a signal from code invoked while it is refreshing a view
 * (`NG0600`) even when that signal is private and untracked by anything
 * else. The effect populates a `WeakMap` keyed by `PanelSource` identity (so
 * it needs no explicit invalidation — a rebuild's new sources simply
 * miss the cache) and bumps a plain version signal so the template's
 * (read-only) `injectorFor()` lookups re-run once an entry lands. A stable
 * `Injector` reference across change-detection cycles for the same feed
 * also matters because `NgComponentOutlet` recreates its component whenever
 * the injector reference changes.
 */
@Component({
  selector: 'app-panel-grid',
  standalone: true,
  imports: [NgComponentOutlet, CollapsedPanelStripComponent],
  providers: [ChartSyncService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-grid.component.html',
  styleUrl: './panel-grid.component.scss',
})
export class PanelGridComponent {
  readonly chartPanelComponent = ChartPanelComponent;

  /**
   * A replay session (T-020) supplies its own panels, sources and timeframe; the live terminal
   * passes none and the grid reads `LayoutsStore` / `LayoutFeedService` as it always has.
   */
  readonly panelsIn = input<readonly Panel[] | null>(null, { alias: 'panels' });
  readonly sourcesIn = input<ReadonlyMap<string, PanelSource> | null>(null, { alias: 'sources' });
  readonly timeframe = input<Timeframe | null>(null);

  readonly panels = computed(() => this.panelsIn() ?? this.layouts.active()?.panels ?? []);
  private readonly sources = computed(() => this.sourcesIn() ?? this.layoutFeed.feeds());
  private readonly collapsedIds = computed(() => {
    const layout = this.layouts.active();
    return layout ? this.collapsed.collapsedIds(layout) : [];
  });

  private readonly injector = inject(Injector);
  private readonly injectorCache = new WeakMap<PanelSource, Injector>();
  private readonly injectorVersion = signal(0);

  constructor(
    private readonly layouts: LayoutsStore,
    private readonly layoutFeed: LayoutFeedService,
    private readonly instruments: InstrumentsStore,
    private readonly collapsed: CollapsedPanelsStore,
    private readonly sync: ChartSyncService,
  ) {
    // §6.2: a rebuild (layout or timeframe change) starts from no shared range. Needed now that a
    // mounting chart JOINS an existing shared range (§11.3 rule 2) instead of proposing its own —
    // without this, the new timeframe's charts would join the previous timeframe's window.
    effect(() => {
      this.sources();
      untracked(() => this.sync.reset());
    });

    // §11.3 sync rule 3: after each collapse/restore has re-flowed the columns, every chart
    // re-applies the shared range to its new width. Skips the initial run (nothing changed yet).
    let previousCollapsed: string | null = null;
    effect(() => {
      const key = `${this.layouts.active()?.id ?? ''}|${this.collapsedIds().join(',')}`;
      if (previousCollapsed !== null && previousCollapsed !== key) {
        afterNextRender(() => this.sync.reassert(), { injector: this.injector });
      }
      previousCollapsed = key;
    });

    effect(() => {
      const feeds = this.sources();
      let changed = false;
      for (const source of feeds.values()) {
        if (!this.injectorCache.has(source)) {
          this.injectorCache.set(source, this.buildInjector(source));
          changed = true;
        }
      }
      if (changed) {
        this.injectorVersion.update((v) => v + 1);
      }
    });
  }

  isCollapsed(panelId: string): boolean {
    return this.collapsedIds().includes(panelId);
  }

  /** The strip's title — the same text as the expanded header (incl. the §11.1 metric unit, once known). */
  titleFor(panel: Panel): string {
    const instrument = this.instruments.instruments().find((i) => i.id === panel.instrument) ?? null;
    const points = this.sourceFor(panel.id)?.points() ?? [];
    const unit = points.length > 0 ? points[points.length - 1].unit : null;
    return panelTitle(panel, instrument, unit);
  }

  expand(panelId: string): void {
    const layout = this.layouts.active();
    if (layout) {
      this.collapsed.expand(layout, panelId);
    }
  }

  sourceFor(panelId: string): PanelSource | undefined {
    return this.sources().get(panelId);
  }

  /** Pure read (plus a signal read for reactivity) — never builds anything itself. */
  injectorFor(source: PanelSource): Injector | undefined {
    this.injectorVersion();
    return this.injectorCache.get(source);
  }

  panelInputs(panel: Panel, source: PanelSource): Record<string, unknown> {
    return { panel, source, timeframe: this.timeframe() };
  }

  private buildInjector(source: PanelSource): Injector {
    const scopedInstruments = new InstrumentsStore();
    scopedInstruments.setInstruments(this.instruments.instruments());
    scopedInstruments.select(source.panel.instrument);

    const research = source.researchScope;
    return Injector.create({
      parent: this.injector,
      providers: [
        { provide: InstrumentsStore, useValue: scopedInstruments },
        ...(research
          ? [
              { provide: SignalsStore, useValue: research.signals },
              { provide: IndicatorsStore, useValue: research.indicators },
            ]
          : []),
      ],
    });
  }
}
