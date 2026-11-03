import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebPositioningRow } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { HEAT_COLUMNS, heatRow, sortHeat, type HeatColumn, type HeatRow, type HeatSort } from './pos-layout';

/**
 * IB-090 (D9) — one row per coin: price, OI, funding, L/S crowd, L/S top traders, liquidations.
 * A cell's colour is its RARITY against the coin's own 30 days, not its sign; a cell with no
 * rarity is hatched («cannot say»), never painted as typical. Columns sort on tap. On a phone the
 * table scrolls inside its own box with the ticker column pinned.
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
  readonly t = this.i18n.t.bind(this.i18n);

  readonly rows = input.required<readonly WebPositioningRow[]>();
  readonly columns = HEAT_COLUMNS;
  readonly sort = signal<HeatSort>({ column: 'rarity', dir: 'desc' });
  readonly view = computed(() => sortHeat(this.rows(), this.sort()).map(heatRow));

  /** Tap a header: sort by it, biggest first; tap again to flip; a third column resets nothing. */
  sortBy(column: HeatColumn | 'base'): void {
    const s = this.sort();
    this.sort.set(s.column === column ? { column, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { column, dir: column === 'base' ? 'asc' : 'desc' });
  }

  header(column: HeatColumn | 'base'): string {
    return this.t(`positioning.col.${column}` as StringKey);
  }

  arrow(column: HeatColumn | 'base'): string {
    const s = this.sort();
    return s.column !== column ? '' : s.dir === 'desc' ? '↓' : '↑';
  }

  heat(r: HeatRow, c: HeatColumn): string {
    return r.cells[c].heat;
  }

  text(r: HeatRow, c: HeatColumn): string {
    return r.cells[c].text ?? this.t('positioning.noValue');
  }

  /** Why the cell has no value or no rarity, in words (its title). */
  title(r: HeatRow, c: HeatColumn): string | null {
    const key = r.cells[c].reasonKey;
    return key === null ? null : this.t(key);
  }
}
