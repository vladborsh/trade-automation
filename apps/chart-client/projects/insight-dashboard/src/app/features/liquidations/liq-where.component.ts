import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebLiquidationCoinPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { whereRows } from './liq-layout';
import { formatUsd } from './liquidations.format';

/**
 * IB-089 (D8b) — where it is happening: one diverging bar per coin (longs left, shorts right, one
 * scale), the verdict against the coin's own norm («лонги ×2.2»), the coins with nothing counted.
 * Plain HTML bars with % widths: they reflow with the phone, nothing to measure.
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

  readonly view = computed(() => whereRows(this.perCoin()));
  readonly usd = formatUsd;
}
