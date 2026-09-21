import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { formatMoney, formatPrice } from './journal-format';
import { orderPanelView } from './order-panel.view';

/**
 * T-023 — the order panel: the active draft's derived size, amount risked (1R), reward multiple,
 * notional and the notional warning (decision 25), with the risk % the order will use (the
 * session's default unless changed here). `Enter` or the button places it.
 */
@Component({
  selector: 'app-order-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-panel.component.html',
  styleUrl: './order-panel.component.scss',
})
export class OrderPanelComponent {
  readonly draft = input<PositionToolState | null>(null);
  readonly lastClose = input<number | null>(null);
  readonly balance = input.required<number>();
  readonly riskPct = input.required<number>();
  readonly notionalWarnMultiple = input.required<number>();
  readonly currency = input.required<string>();
  readonly pricePrecision = input(2);

  readonly riskPctChange = output<number>();
  readonly place = output<void>();

  readonly view = computed(() => {
    const draft = this.draft();
    const lastClose = this.lastClose();
    if (!draft || lastClose === null) return null;
    return orderPanelView(draft, { balance: this.balance(), riskPct: this.riskPct(), lastClose, notionalWarnMultiple: this.notionalWarnMultiple() });
  });

  protected readonly money = (v: number | null) => formatMoney(v, this.currency());
  protected readonly price = (v: number | null) => formatPrice(v, this.pricePrecision());

  protected onRiskInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value) && value > 0) this.riskPctChange.emit(value);
  }
}
