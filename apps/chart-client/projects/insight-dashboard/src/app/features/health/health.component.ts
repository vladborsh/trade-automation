import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WebDbHealthResponse, WebStreamsResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { cellLabel, cellSeverity, toGapGrid, worstCells, type GapGrid } from './gap-grid.mapper';

/**
 * architecture/insight-bot-web-dashboard.md §2 — streams (mode, last message age, reconnects),
 * the two Binance weight gauges, open gaps, the last 14 daily gap reports as a symbol × day grid,
 * and the database's size and partition horizon.
 *
 * The class is wiring only: every mapping lives in `gap-grid.mapper.ts` beside it (AGENTS.md).
 */
@Component({
  selector: 'app-health',
  standalone: true,
  templateUrl: './health.component.html',
  styleUrl: './health.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly streams = signal<WebStreamsResponse | null>(null);
  readonly db = signal<WebDbHealthResponse | null>(null);
  readonly grid = signal<GapGrid | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);

  readonly openGaps = computed(() => (this.streams()?.streams ?? []).reduce((sum, s) => sum + s.gapsOpen, 0));
  readonly degraded = computed(() => (this.streams()?.streams ?? []).filter((s) => s.mode === 'degraded'));
  readonly worst = computed(() => {
    const grid = this.grid();
    return grid ? worstCells(grid) : [];
  });

  readonly label = cellLabel;
  readonly severity = cellSeverity;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [streams, reports, db] = await Promise.all([this.api.streams(), this.api.gapReports(14), this.api.dbHealth()]);
      this.streams.set(streams);
      this.grid.set(toGapGrid(reports));
      this.db.set(db);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  gigabytes(bytes: number): string {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  age(seconds: number | null): string {
    if (seconds === null) return this.t('state.never');
    if (seconds < 120) return `${seconds}s`;
    return seconds < 7200 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
  }
}
