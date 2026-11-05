import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { WebLiquidationsLargeQuery, WebLiquidationsLargeResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { HelpBlockComponent } from '../../ui/help-block.component';
import { LoaderComponent } from '../../ui/loader.component';
import { BlockScheduler } from '../market/shell/block-scheduler';
import { bindVisibility } from '../market/shell/scheduler-visibility';
import { LiqBubblesComponent } from './liq-bubbles.component';
import { LiqFiltersComponent } from './liq-filters.component';
import { liqPageParams, parseLiqPage, type LiqPageState } from './liq-page-query';
import { nextLiqSort, type LiqColumn } from './liq-table';
import { LiqTableComponent } from './liq-table.component';

/** The help's five points, in the mockup's order; each is a bold lead and its text (mockup.html, verbatim). */
export const LIQ_HELP_ITEMS = ['what', 'sides', 'series', 'read', 'venues'] as const;

/**
 * IB-120 (market-round2 design §4) — /liquidations: every large liquidation of the period from our
 * tape, as Market's bubble chart and a sortable table, with filter chips. Reached from Market's
 * «Все ликвидации →» and by link; no nav item (§4).
 *
 * The filters and the sort live in the URL (`liq-page-query.ts`), so a link reproduces the view and
 * a reload keeps it. Refreshed by the Market scheduler at the liquidation block's 10 s — the
 * server's cache for one filter set — and paused while the tab is hidden.
 */
@Component({
  selector: 'app-liquidations-page',
  standalone: true,
  imports: [RouterLink, HelpBlockComponent, LiqBubblesComponent, LiqFiltersComponent, LiqTableComponent, LoaderComponent],
  templateUrl: './liquidations-page.component.html',
  styleUrl: './liquidations-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidationsPageComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly state = signal<LiqPageState>(parseLiqPage((name) => this.route.snapshot.queryParamMap.get(name)));
  readonly data = signal<WebLiquidationsLargeResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly helpItems = LIQ_HELP_ITEMS;
  readonly week = computed(() => this.state().query.period === '7d');
  /** The breadcrumb back to Market keeps the period. */
  readonly marketParams = computed(() => ({ p: this.state().query.period }));
  private readonly scheduler: BlockScheduler;

  constructor() {
    const doc = inject(DOCUMENT);
    this.scheduler = new BlockScheduler(
      { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      () => this.error.set(this.scheduler.snapshot().find((b) => b.id === 'liquidations')?.state.error ?? null),
    );
    // an answer for filters the reader has since changed is dropped
    this.scheduler.register('liquidations', async () => {
      const query = this.state().query;
      const r = await this.api.liquidationsLarge(query);
      if (query === this.state().query) this.data.set(r);
    });
    const detachVisibility = bindVisibility(doc, this.scheduler);
    this.scheduler.start();
    inject(DestroyRef).onDestroy(() => {
      this.scheduler.stop();
      detachVisibility();
    });
  }

  help(item: (typeof LIQ_HELP_ITEMS)[number], part: 'lead' | 'text'): string {
    return this.t(`liqPage.help.${item}.${part}` as StringKey);
  }

  /** «1 000», as the mockup groups it, in both languages. */
  count(n: number): string {
    return n.toLocaleString('en-US').replace(/,/g, ' ');
  }

  onQuery(patch: Partial<WebLiquidationsLargeQuery>): void {
    this.state.update((s) => ({ ...s, query: { ...s.query, ...patch } }));
    this.data.set(null);
    this.syncUrl();
    this.scheduler.refresh('liquidations');
  }

  onSort(column: LiqColumn): void {
    this.state.update((s) => ({ ...s, sort: nextLiqSort(s.sort, column) }));
    this.syncUrl();
  }

  private syncUrl(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: liqPageParams(this.state()), queryParamsHandling: 'merge', replaceUrl: true });
  }
}
