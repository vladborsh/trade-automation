import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Timeframe } from '@trade-automation/contracts';
import { formatBalance, formatCursorUtc } from './replay-format';
import { REPLAY_TIMEFRAMES } from './replay-keys';

/**
 * backtest-app-system-design.md §2.3 — the workspace's top bar: session name, cursor (UTC),
 * timeframe picker, step button, balance. Presentational: the workspace owns the engine.
 */
@Component({
  selector: 'app-replay-toolbar',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './replay-toolbar.component.html',
  styleUrl: './replay-toolbar.component.scss',
})
export class ReplayToolbarComponent {
  readonly sessionName = input.required<string>();
  readonly cursorMs = input.required<number>();
  readonly timeframe = input.required<Timeframe>();
  readonly balance = input.required<number>();
  readonly currency = input.required<string>();
  /** A step or a switch is waiting for candles. */
  readonly loading = input(false);
  readonly atEnd = input(false);
  readonly error = input<string | null>(null);

  readonly step = output<void>();
  readonly timeframeChange = output<Timeframe>();

  readonly timeframes = REPLAY_TIMEFRAMES;
  readonly cursorText = computed(() => formatCursorUtc(this.cursorMs()));
  readonly balanceText = computed(() => formatBalance(this.balance(), this.currency()));
}
