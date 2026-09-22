import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { formatMoney, formatPrice } from './journal-format';
import { orderPanelView } from './order-panel.view';

/**
 * T-023 — the order panel: the active draft's derived size, amount risked (1R), reward multiple,
 * notional and the notional warning (decision 25), with the risk % the order will use (the
 * session's default unless changed here).
 *
 * T-045 (the user's feedback, item 11): a popup, shown only at the submit step — `Enter` on an
 * active draft opens it, never B/S — so the draft's levels are set on the chart unobstructed.
 * Confirm (or `Enter`, also inside the risk field) places it; Cancel, `Esc` or a click outside
 * closes it and keeps the draft. A draft with a problem cannot be confirmed.
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
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  readonly view = computed(() => {
    const draft = this.draft();
    const lastClose = this.lastClose();
    if (!draft || lastClose === null) return null;
    return orderPanelView(draft, { balance: this.balance(), riskPct: this.riskPct(), lastClose, notionalWarnMultiple: this.notionalWarnMultiple() });
  });

  protected readonly money = (v: number | null) => formatMoney(v, this.currency());
  protected readonly price = (v: number | null) => formatPrice(v, this.pricePrecision());

  protected onRiskInput(event: Event): void {
    this.applyRisk(event.target as HTMLInputElement);
  }

  /** Enter in the risk field submits before its change event: take the typed value first. */
  protected onSubmit(event: Event): void {
    event.preventDefault();
    const field = (event.target as HTMLFormElement).elements.namedItem('riskPct');
    if (field instanceof HTMLInputElement) this.applyRisk(field);
    if (this.view()?.problem === null) this.confirm.emit();
  }

  private applyRisk(field: HTMLInputElement): void {
    const value = Number(field.value);
    if (Number.isFinite(value) && value > 0 && value !== this.riskPct()) this.riskPctChange.emit(value);
  }
}
