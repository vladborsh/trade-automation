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
  readonly sessionId = input.required<string>();
  /** §9.3: the cursor being viewed, read-only; null in the normal workspace. */
  readonly viewingAt = input<number | null>(null);
  readonly cursorMs = input.required<number>();
  readonly timeframe = input.required<Timeframe>();
  readonly balance = input.required<number>();
  readonly currency = input.required<string>();
  /** A step or a switch is waiting for candles. */
  readonly loading = input(false);
  readonly atEnd = input(false);
  /** The server has completed the session: nothing can be stepped or switched (decision 28). */
  readonly completed = input(false);
  /** A request to the server is being retried after a network failure. */
  readonly retrying = input(false);
  /** A one-line message: resynced, reloaded from the server, … */
  readonly notice = input<string | null>(null);
  readonly error = input<string | null>(null);
  /** T-023: what every open position's current stop would lose (replay-core `openRisk`). */
  readonly openRisk = input(0);

  readonly step = output<void>();
  readonly timeframeChange = output<Timeframe>();

  readonly timeframes = REPLAY_TIMEFRAMES;
  readonly cursorText = computed(() => formatCursorUtc(this.cursorMs()));
  /** In view-only mode the timeframe can still change (not persisted); only a live, complete session locks it. */
  readonly timeframeLocked = computed(() => this.completed() && this.viewingAt() === null);
  readonly balanceText = computed(() => formatBalance(this.balance(), this.currency()));
  readonly openRiskText = computed(() => formatBalance(this.openRisk(), this.currency()));
}
