import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
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
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  /** §11: the counts are pure, the sentence comes from the table. */
  readonly summary = computed(() => {
    const { total, empty, holes } = coverageCounts(this.rows());
    if (total === 0) return this.t('coverage.summary.none');
    if (empty === 0 && holes === 0) return this.t('coverage.summary.complete', { total });
    return this.t('coverage.summary.problems', { total, empty, holes });
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set(toCoverageViews((await this.api.coverage()).rows));
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
