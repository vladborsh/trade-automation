import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { InsightApiClient } from '../../core/insight-api.client';
import { coverageSummary, toCoverageViews, type CoverageView } from './coverage.rows';

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

  readonly rows = signal<CoverageView[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly summary = computed(() => coverageSummary(this.rows()));

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
