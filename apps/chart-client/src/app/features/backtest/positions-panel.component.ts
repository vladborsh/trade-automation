import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { formatMoney, formatPrice, formatSignedMoney } from './journal-format';
import type { PositionRow } from './positions.view';

/**
 * T-023 — pending and open orders: side, entry (fill or limit), stop, target, size, floating PnL
 * (open only, marked at the last close adjusted for spread) and risk; cancel for pending,
 * close-at-market for open. The actions go through the queue (the workspace wires them).
 */
@Component({
  selector: 'app-positions-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './positions-panel.component.html',
  styleUrl: './positions-panel.component.scss',
})
export class PositionsPanelComponent {
  readonly rows = input.required<readonly PositionRow[]>();
  readonly currency = input.required<string>();
  readonly pricePrecision = input<ReadonlyMap<string, number>>(new Map());

  readonly cancel = output<string>();
  readonly close = output<string>();

  protected price(row: PositionRow, v: number | null): string {
    return formatPrice(v, this.pricePrecision().get(row.order.instrument));
  }

  protected readonly signed = (v: number | null) => formatSignedMoney(v, this.currency());
  protected readonly money = (v: number | null) => formatMoney(v, this.currency());
}
