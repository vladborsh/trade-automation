import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import type { WebMarketPeriod, WebPositioningResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { LoaderComponent } from '../../ui/loader.component';
import { BlockScheduler } from '../market/shell/block-scheduler';
import { parsePeriod } from '../market/shell/market-text';
import { PeriodSwitchComponent } from '../market/shell/period-switch.component';
import { PosHeatComponent } from './pos-heat.component';
import { PosQuadrantComponent } from './pos-quadrant.component';
import { parseSort, sortQuery, type SortState } from './pos-sort';

/** IB-103: the quadrant on its own page may grow taller than the Market block's 360 px cap. */
export const PAGE_QUADRANT_MAX_HEIGHT = 520;

/**
 * IB-103 — positioning as a page: the price × OI quadrant, larger and labelled, and the full heat
 * table, sortable. It reads the SAME endpoint as the Market block (`/market/positioning?period=`),
 * so the server's per-period cache serves both: no extra venue weight and no extra memory.
 *
 * The period (`?p=`) and the sort (`?sort=&dir=`) live in the URL, so a link opens the same view.
 * Refreshed by the same `BlockScheduler` as Market, at the positioning block's cadence, paused while
 * the tab is hidden.
 */
@Component({
  selector: 'app-positioning-page',
  standalone: true,
  imports: [PeriodSwitchComponent, PosQuadrantComponent, PosHeatComponent, LoaderComponent],
  templateUrl: './positioning-page.component.html',
  styleUrl: './positioning-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositioningPageComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly period = signal<WebMarketPeriod>(parsePeriod(this.route.snapshot.queryParamMap.get('p')));
  readonly sort = signal<SortState>(parseSort(this.route.snapshot.queryParamMap.get('sort'), this.route.snapshot.queryParamMap.get('dir')));
  readonly data = signal<WebPositioningResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly quadrantMaxHeight = PAGE_QUADRANT_MAX_HEIGHT;
  private readonly scheduler: BlockScheduler;

  constructor() {
    const doc = inject(DOCUMENT);
    this.scheduler = new BlockScheduler(
      { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      () => this.error.set(this.scheduler.snapshot().find((b) => b.id === 'positioning')?.state.error ?? null),
    );
    // an answer for a period the reader has since left is dropped, as on Market
    this.scheduler.register('positioning', async () => {
      const period = this.period();
      const r = await this.api.marketPositioning(period);
      if (period === this.period()) this.data.set(r);
    });
    this.scheduler.start();
    const onVisibility = () => this.scheduler.setVisible(doc.visibilityState !== 'hidden');
    doc.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.scheduler.stop();
      doc.removeEventListener('visibilitychange', onVisibility);
    });
  }

  onPeriodChange(p: WebMarketPeriod): void {
    this.period.set(p);
    this.data.set(null);
    this.syncUrl();
    this.scheduler.refresh('positioning');
  }

  onSortChange(s: SortState): void {
    this.sort.set(s);
    this.syncUrl();
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { p: this.period(), ...sortQuery(this.sort()) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
