import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebLiquidationBlock, WebLiquidationCoinPeriod, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { whereRows } from './liq-layout';
import { collapseRows } from './liq-where-collapse';
import { otherLine } from './liq-where-other';
import { formatUsd } from './liquidations.format';

/**
 * IB-089 (D8b) — where it is happening: one diverging bar per coin (longs left, shorts right, one
 * scale), the verdict against the coin's own norm («лонги ×2.2»), the coins with nothing counted.
 * Plain HTML bars with % widths: they reflow with the phone, nothing to measure.
 *
 * IB-101: folded to the top 8 coins (`liq-where-collapse.ts`), with «ещё K · $X» and a show-all
 * button. The fold is applied after `whereRows`, so ranking, bar scale and verdicts are over every
 * coin. Unfolding is this component's own state: not in the URL, not stored, and a new period
 * folds the block again.
 */
@Component({
  selector: 'app-liq-where',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './liq-where.component.html',
  styleUrl: './liq-where.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqWhereComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly perCoin = input.required<readonly WebLiquidationCoinPeriod[]>();
  readonly note = input<string | null>(null);
  /** Only so a new period folds the block again (IB-101). */
  readonly period = input<WebMarketPeriod | null>(null);
  /** IB-BUG-025: the crypto in no row, stated after the rows and outside the fold. */
  readonly other = input<WebLiquidationBlock['otherCoins'] | null>(null);

  readonly view = computed(() => whereRows(this.perCoin()));
  readonly collapsed = computed(() => collapseRows(this.view().rows));
  /** Reset to folded whenever the period changes: the source is the period, the value is always false. */
  readonly expanded = linkedSignal({ source: this.period, computation: () => false });
  readonly otherView = computed(() => otherLine(this.other()));
  readonly visibleRows = computed(() => (this.expanded() ? this.view().rows : this.collapsed().shown));

  toggle(): void {
    this.expanded.update((open) => !open);
  }
  readonly usd = formatUsd;
}
