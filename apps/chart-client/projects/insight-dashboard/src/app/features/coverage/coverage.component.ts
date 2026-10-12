import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { collectorTotals, toCollectorViews, type CollectorView } from './collector-rows';
import { coverageCounts, toCoverageViews, type CoverageView } from './coverage.rows';

/** architecture/insight-bot-web-dashboard.md §2 — `GET /api/web/coverage`, per symbol × series. */
@Component({
  selector: 'app-coverage',
  standalone: true,
  templateUrl: './coverage.component.html',
  styleUrl: './coverage.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoverageComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly rows = signal<CoverageView[]>([]);
  /** IB-BUG-010 — collector uptime, and the liquidation rows that map to no known symbol. */
  readonly collectors = signal<CollectorView[]>([]);
  readonly unmappedTotal = signal(0);
  readonly windowDays = signal(30);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  /** §11: the counts are pure, the sentence comes from the table. */
  readonly summary = computed(() => {
    const { total, empty, holes } = coverageCounts(this.rows());
    if (total === 0) return this.t('coverage.summary.none');
    if (empty === 0 && holes === 0) return this.t('coverage.summary.complete', { total });
    return this.t('coverage.summary.problems', { total, empty, holes });
  });

  /**
   * The basis line. It states the numbers it actually has rather than reassuring anyone: a reader
   * who can see "9 of 226 covered" knows not to trust a ratio built on 226.
   */
  readonly collectorBasis = computed(() => {
    const totals = collectorTotals(this.collectors());
    if (totals.streams === 0) return this.t('coverage.collectors.none');
    return this.t('coverage.collectors.basis', {
      days: this.windowDays(),
      covered: totals.coveredHours,
      elapsed: totals.elapsedHours,
      outages: totals.outages,
    });
  });

  readonly unmappedSummary = computed(() =>
    this.unmappedTotal() === 0
      ? this.t('coverage.unmapped.none')
      : this.t('coverage.unmapped.some', { total: this.unmappedTotal() }));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.coverage();
      this.rows.set(toCoverageViews(response.rows));
      this.collectors.set(toCollectorViews(response.collectors ?? []));
      this.unmappedTotal.set(response.unmapped?.total ?? 0);
      this.windowDays.set(response.windowDays ?? 30);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
