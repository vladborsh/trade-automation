import { ChangeDetectionStrategy, Component, type OnDestroy, effect, input, output } from '@angular/core';
import type { CloseNotice } from '../../core/replay/close-notices';
import { formatR, formatSignedMoney } from './journal-format';

/** How long a notice stays before it goes by itself. */
export const CLOSE_NOTICE_MS = 6_000;

const REASONS: Record<CloseNotice['reason'], string> = {
  stop: 'stopped out',
  'take-profit': 'target hit',
  manual: 'closed by hand',
  'end-of-session': 'closed at the session end',
};

/**
 * T-051 (the user's feedback, item 17) — a snackbar per closed trade, bottom-right over the
 * workspace: instrument, direction, why it closed, P&L in the session currency and in R. Each goes
 * after CLOSE_NOTICE_MS, or at once on its ×.
 */
@Component({
  selector: 'app-trade-close-snackbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trade-close-snackbar.component.html',
  styleUrl: './trade-close-snackbar.component.scss',
})
export class TradeCloseSnackbarComponent implements OnDestroy {
  readonly notices = input.required<readonly CloseNotice[]>();
  readonly currency = input.required<string>();
  readonly dismiss = output<number>();

  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    effect(() => {
      for (const n of this.notices()) {
        if (!this.timers.has(n.id)) this.timers.set(n.id, setTimeout(() => this.dismiss.emit(n.id), CLOSE_NOTICE_MS));
      }
    });
  }

  ngOnDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
  }

  protected reason(n: CloseNotice): string {
    return REASONS[n.reason];
  }

  protected pnl(n: CloseNotice): string {
    return `${formatSignedMoney(n.pnlCcy, this.currency())} · ${formatR(n.pnlR)}`;
  }
}
