import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { WebPositioningRow } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { formatUsd } from '../liquidations/liquidations.format';
import { HEAT_COLUMNS, heatRow, PHONE_HEAT_LIMIT, type HeatColumn, type HeatRow } from './pos-layout';
import { DEFAULT_SORT, nextSort, sortRows, type SortKey, type SortState } from './pos-sort';
import { hasMoreRight } from './scroll-fade';

/**
 * IB-090 (D9) — one row per coin: price, OI, funding, L/S crowd, L/S top traders, liquidations.
 * A cell's colour is its RARITY against the coin's own 30 days, not its sign; a cell with no
 * rarity is hatched («cannot say»), never painted as typical. On a phone the table scrolls inside
 * its own box with the ticker column pinned.
 *
 * IB-103: one component for both places.
 * - Market (`limit` = 5): the five most unusual rows, no sorting, no «show all» — a conclusion.
 * - /positioning (`limit` null): every row; a header sorts by its value, its «r» button by its rarity,
 *   «OI, $» by open interest, the ticker A→Z. The sort is the PAGE's (it lives in the URL): this
 *   component takes it as `sort` and asks for a new one through `sortChange`. A row opens the coin.
 */
@Component({
  selector: 'app-pos-heat',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './pos-heat.component.html',
  styleUrl: './pos-heat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosHeatComponent {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly rows = input.required<readonly WebPositioningRow[]>();
  /** IB-103: the compact Market table shows only this many rows (by the default sort) and cannot be re-sorted. */
  readonly limit = input<number | null>(null);
  readonly sort = input<SortState>(DEFAULT_SORT);
  readonly sortChange = output<SortState>();

  readonly columns = HEAT_COLUMNS;
  readonly compact = computed(() => this.limit() !== null);
  private readonly sorted = computed(() => sortRows(this.rows(), this.compact() ? DEFAULT_SORT.key : this.sort().key, this.compact() ? DEFAULT_SORT.dir : this.sort().dir));
  readonly view = computed(() => {
    const limit = this.limit();
    const rows = limit === null ? this.sorted() : this.sorted().slice(0, limit);
    return rows.map((r) => ({ ...heatRow(r), oiUsd: r.oiUsd }));
  });
  /** On a phone the full table stops here, most unusual first, with «показать все» (the 4 900 px rule). */
  readonly phoneLimit = PHONE_HEAT_LIMIT;
  readonly expanded = signal(false);

  /**
   * IB-BUG-041: the right-edge fade. The phone hides the box's scrollbar, so without it the box's
   * edge cuts a number in half and reads as «the table runs off the screen». Re-checked on scroll and
   * whenever the box or the table changes width («show all», a sort, a period, a rotated phone).
   */
  readonly moreRight = signal(false);
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.box().nativeElement;
      this.updateFade();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.updateFade());
      ro.observe(el);
      const table = el.querySelector('table');
      if (table) ro.observe(table);
      destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  updateFade(): void {
    this.moreRight.set(hasMoreRight(this.box().nativeElement));
  }

  sortBy(key: SortKey): void {
    if (!this.compact()) this.sortChange.emit(nextSort(this.sort(), key));
  }

  open(symbol: string): void {
    void this.router.navigate(['/instrument', symbol]);
  }

  header(column: HeatColumn | 'base' | 'oi'): string {
    return this.t(`positioning.col.${column}` as StringKey);
  }

  arrow(key: SortKey): string {
    const s = this.compact() ? DEFAULT_SORT : this.sort();
    return s.key !== key ? '' : s.dir === 'desc' ? '↓' : '↑';
  }

  rarityKey(column: HeatColumn): SortKey {
    return `${column}.rarity`;
  }

  heat(r: HeatRow, c: HeatColumn): string {
    return r.cells[c].heat;
  }

  text(r: HeatRow, c: HeatColumn): string {
    return r.cells[c].text ?? this.t('positioning.noValue');
  }

  oi(value: number | null): string {
    return value === null ? this.t('positioning.noValue') : formatUsd(value);
  }

  /** Why the cell has no value or no rarity, in words (its title). */
  title(r: HeatRow, c: HeatColumn): string | null {
    const key = r.cells[c].reasonKey;
    return key === null ? null : this.t(key);
  }
}
