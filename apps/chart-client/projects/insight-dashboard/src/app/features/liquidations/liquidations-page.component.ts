import { ChangeDetectionStrategy, Component, inject, signal, type OnDestroy } from '@angular/core';
import type { WebLiquidationsOverviewResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { LiquidationsFeedComponent } from './liquidations-feed.component';
import { LiquidationsNowComponent } from './liquidations-now.component';
import { LiquidationsWhereComponent } from './liquidations-where.component';

/** §12.3: the feed is polled with the page. The server caches 15 s, so this costs one query. */
export const POLL_MS = 30_000;

/**
 * IB-038 — **a placeholder page that IB-037 replaces.**
 *
 * The task mounts the card, the table and the feed on the landing page, and the landing page is
 * dev-1's IB-037 market page, which is not on master. Rather than ship three components nobody
 * can click — "a whole-app run means a user can reach the feature by CLICKING", the IB-031
 * review lesson — this gives them a route of their own at `/market` until that page lands.
 *
 * **When IB-037 merges, delete this component and mount the three children under its cards.**
 * Agreed with dev-1 in writing (`reports/dev-1-IB-037-038-seam.md`): dev-2 merges first, dev-1
 * resolves `app.routes.ts`, `app.html` and the i18n tables in favour of their version. The three
 * children are input-only and read no route precisely so that move is three lines of template.
 */
@Component({
  selector: 'app-liquidations-page',
  standalone: true,
  imports: [LiquidationsNowComponent, LiquidationsWhereComponent, LiquidationsFeedComponent],
  templateUrl: './liquidations-page.component.html',
  styleUrl: './liquidations-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidationsPageComponent implements OnDestroy {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly data = signal<WebLiquidationsOverviewResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly minUsd = signal(100_000);

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.load();
    this.timer = setInterval(() => void this.load(), POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  onMinUsdChange(value: number): void {
    this.minUsd.set(value);
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      this.data.set(await this.api.liquidationsOverview(this.minUsd()));
    } catch (err) {
      // The poll keeps running: a blip must not freeze the page on a stale error for ever, and
      // the last good data stays on screen rather than being blanked by a failed refresh.
      this.error.set(this.t('liq.loadFailed', { message: (err as Error).message }));
    } finally {
      this.loading.set(false);
    }
  }
}
