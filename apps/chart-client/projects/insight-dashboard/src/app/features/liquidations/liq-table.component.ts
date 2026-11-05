import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { WebLiquidationLargeRow } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { LIQ_COLUMNS, LIQ_PHONE_HIDDEN, liqRowView, sortLiqRows, type LiqColumn, type LiqRowView, type LiqSort } from './liq-table';

/**
 * IB-120 (market-round2 design §4) — the /liquidations table: time, coin, side, amount, price,
 * venue, series. Every header sorts (client-side, over the rows given); a row opens the coin's
 * chart at that minute. At ≤ 480 px price and venue are hidden.
 */
@Component({
  selector: 'app-liq-table',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './liq-table.component.html',
  styleUrl: './liq-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqTableComponent {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly rows = input.required<readonly WebLiquidationLargeRow[]>();
  readonly sort = input.required<LiqSort>();
  /** 7d: the time cell carries the day as well. */
  readonly withDay = input(false);
  readonly sortChange = output<LiqColumn>();

  readonly columns = LIQ_COLUMNS;
  readonly views = computed(() => sortLiqRows(this.rows(), this.sort()).map((r) => liqRowView(r, this.withDay())));

  heading(column: LiqColumn): string {
    return this.t(`liqPage.col.${column}` as StringKey);
  }

  phoneHidden(column: LiqColumn): boolean {
    return LIQ_PHONE_HIDDEN.includes(column);
  }

  ariaSort(column: LiqColumn): 'ascending' | 'descending' | null {
    const s = this.sort();
    return s.column !== column ? null : s.dir === 'asc' ? 'ascending' : 'descending';
  }

  side(view: LiqRowView): string {
    return this.t(view.row.side === 'long' ? 'liq.side.longs' : 'liq.side.shorts');
  }

  series(view: LiqRowView): string {
    return view.series === null ? '—' : this.t('liqPage.series', view.series);
  }

  open(view: LiqRowView): void {
    void this.router.navigate(view.link.commands, { queryParams: view.link.queryParams });
  }
}
