import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { WebLiquidationEpisodesResponse, WebLiquidationsLargeQuery, WebLiquidationsLargeResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { HelpBlockComponent } from '../../ui/help-block.component';
import { LoaderComponent } from '../../ui/loader.component';
import { BlockScheduler } from '../market/shell/block-scheduler';
import { bindVisibility } from '../market/shell/scheduler-visibility';
import { mergeCoinOptions } from './liq-episodes';
import { LiqEpisodesComponent } from './liq-episodes.component';
import { LiqFiltersComponent } from './liq-filters.component';
import { liqPageParams, parseLiqPage, type LiqPageState } from './liq-page-query';
import { nextLiqSort, type LiqColumn } from './liq-table';
import { LiqTableComponent } from './liq-table.component';
import { formatUsd } from './liquidations.format';

/** The help's points (IB-134, design E9), each a bold lead and its text. */
export const LIQ_HELP_ITEMS = ['what', 'norm', 'split', 'sides', 'min', 'chart', 'venues'] as const;

/**
 * IB-120 / IB-134 — /liquidations. Since IB-134 (liquidation-episodes design E3–E9) the page is the
 * period's **episodes**: a summary line and one card per episode (`app-liq-episodes`). IB-120's flat
 * table stays, behind «все ликвидации списком →» (`?view=list`), and is the page while the norm is
 * still collecting (E2). IB-120's bubble chart is retired here: Market draws it (owner ruling 1).
 *
 * The filters, the sort and the view live in the URL (`liq-page-query.ts`). Refreshed by the Market
 * scheduler at the liquidation block's 10 s — the server's cache for one filter set — and paused
 * while the tab is hidden. The episodes are always asked for (the help quotes their threshold); the
 * flat list only when it is shown.
 */
@Component({
  selector: 'app-liquidations-page',
  standalone: true,
  imports: [RouterLink, HelpBlockComponent, LiqEpisodesComponent, LiqFiltersComponent, LiqTableComponent, LoaderComponent],
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
  readonly episodes = signal<WebLiquidationEpisodesResponse | null>(null);
  readonly data = signal<WebLiquidationsLargeResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly helpItems = LIQ_HELP_ITEMS;
  readonly week = computed(() => this.state().query.period === '7d');
  readonly collecting = computed(() => this.episodes()?.norm.status === 'collecting');
  /** The flat list is shown when asked for, and instead of episodes while there is no norm yet (E2). */
  readonly showList = computed(() => this.state().view === 'list' || this.collecting());
  readonly listParams = computed(() => liqPageParams({ ...this.state(), view: 'list' }));
  readonly episodeParams = computed(() => liqPageParams({ ...this.state(), view: 'episodes' }));
  /** Coins seen in this period's episodes: the coin filter's options on the episode view. */
  private readonly episodeCoins = signal<Array<{ symbol: string; base: string }>>([]);
  readonly coins = computed(() => (this.showList() ? this.data()?.coins ?? [] : this.episodeCoins()));
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
      const episodes = await this.api.liquidationEpisodes(query);
      if (query !== this.state().query) return;
      this.episodes.set(episodes);
      this.episodeCoins.update((known) => mergeCoinOptions(known, episodes.episodes));
      if (!this.showList()) return;
      const large = await this.api.liquidationsLarge(query);
      if (query === this.state().query) this.data.set(large);
    });
    // the view links are router links (IB-BUG-035): the page follows its URL's `view`
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((map) => {
      const view = map.get('view') === 'list' ? 'list' : 'episodes';
      if (view === this.state().view) return;
      this.state.update((s) => ({ ...s, view }));
      if (this.showList() && this.data() === null) this.scheduler.refresh('liquidations');
    });
    const detachVisibility = bindVisibility(doc, this.scheduler);
    this.scheduler.start();
    inject(DestroyRef).onDestroy(() => {
      this.scheduler.stop();
      detachVisibility();
    });
  }

  help(item: (typeof LIQ_HELP_ITEMS)[number], part: 'lead' | 'text'): string {
    if (item === 'norm' && part === 'text') {
      const norm = this.episodes()?.norm;
      return norm?.status === 'ready'
        ? this.t('liqPage.help.norm.text', { d: norm.heldDays, usd: formatUsd(norm.thresholdUsd) })
        : this.t('liqPage.help.norm.collecting');
    }
    return this.t(`liqPage.help.${item}.${part}` as StringKey);
  }

  /** «1 000», as the mockup groups it, in both languages. */
  count(n: number): string {
    return n.toLocaleString('en-US').replace(/,/g, ' ');
  }

  onQuery(patch: Partial<WebLiquidationsLargeQuery>): void {
    const before = this.state().query.period;
    this.state.update((s) => ({ ...s, query: { ...s.query, ...patch } }));
    if (this.state().query.period !== before) this.episodeCoins.set([]);
    this.episodes.set(null);
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
