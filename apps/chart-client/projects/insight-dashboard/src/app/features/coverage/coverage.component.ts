import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { basisState, collectorTotals, toCollectorViews, type CollectorView } from './collector-rows';
import { coverageCounts, toCoverageViews, type CoverageView } from './coverage.rows';
import {
  dexFieldTotals, MIN_ASKS_FOR_A_RATE, toDexFieldViews, unpromoted, type DexFieldView,
} from './dex-field-rows';
import { frameTotals, toFrameViews, type FrameView } from './frame-rows';

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
  /** IB-015 — feature-frame coverage. Its own block: see `frame-rows.ts`. */
  readonly frames = signal<FrameView[]>([]);
  /** IB-028 — GoPlus field presence as a rate. Its own block: see `dex-field-rows.ts`. */
  readonly dexFields = signal<DexFieldView[]>([]);
  readonly minAsks = MIN_ASKS_FOR_A_RATE;
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
    // IB-044: no basis is not a basis of zero. «покрыто 0 из 0 часов» stated a measurement that
    // does not exist; a collector older than IB-BUG-010 has a zero-wide responsible window on its
    // first run and must say so instead.
    if (basisState(totals) === 'not-recorded') {
      return totals.streams === 0
        ? this.t('coverage.collectors.none')
        : this.t('coverage.collectors.notRecorded', { days: this.windowDays() });
    }
    return this.t('coverage.collectors.basis', {
      days: this.windowDays(),
      covered: totals.coveredHours,
      elapsed: totals.elapsedHours,
      outages: totals.outages,
    });
  });

  /**
   * The frame block's basis line. Like the collector one it states what it has rather than
   * reassuring: a reader who sees "0 of 96 written" knows the pass did not run, which no count
   * of the frames that DO exist could have told them.
   */
  readonly frameBasis = computed(() => {
    const totals = frameTotals(this.frames());
    if (totals.timeframes === 0) return this.t('coverage.frames.none');
    return this.t('coverage.frames.basis', {
      days: this.windowDays(),
      written: totals.written,
      expected: totals.expected,
      unhealed: totals.unhealed,
      missing: totals.missing,
    });
  });

  /**
   * The field-presence basis. It states how many fields a rate is even possible for, because the
   * alarm here is a RATE going to zero and a rate needs a population: '0 %' over two asks and
   * '0 %' over four hundred are the same number about different worlds.
   */
  readonly dexBasis = computed(() => {
    const totals = dexFieldTotals(this.dexFields());
    if (totals.answered === 0) return this.t('coverage.dex.none');
    return this.t('coverage.dex.basis', {
      days: this.windowDays(),
      measured: totals.measured,
      fields: totals.fields,
      gone: totals.gone,
    });
  });

  /**
   * Why a field at 100 % is still optional, printed next to the number.
   *
   * Without this the correct row reads as a stale classification, and the obvious "correction" —
   * promoting it to always-present — reinstates the throw-on-absence that discarded good rows.
   * A decision that looks wrong gets fixed by someone acting in good faith.
   */
  readonly dexUnpromoted = computed(() => unpromoted(this.dexFields()).map((view) => this.t(
    'coverage.dex.unpromoted',
    { field: view.field, family: view.chainFamily, evidence: view.evidence },
  )));

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
      this.frames.set(toFrameViews(response.frames ?? []));
      this.dexFields.set(toDexFieldViews(response.dexFields ?? []));
      this.windowDays.set(response.windowDays ?? 30);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }
}
