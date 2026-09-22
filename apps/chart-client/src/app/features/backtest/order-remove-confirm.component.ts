import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { OrderRemoval } from '../../core/replay/order-removal';

/**
 * BUG-017 — the one-step confirm before a live order's tool is removed: "Cancel order #N?" for a
 * pending order, "Close position #N at market?" for an open one. Confirm (or Enter) runs the queue's
 * cancel / close; Keep, Esc or a click outside leaves the order alone.
 */
@Component({
  selector: 'app-order-remove-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-remove-confirm.component.html',
  styleUrl: './order-remove-confirm.component.scss',
})
export class OrderRemoveConfirmComponent {
  readonly removal = input.required<OrderRemoval>();
  readonly confirm = output<void>();
  readonly dismiss = output<void>();

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.confirm.emit();
  }
}
