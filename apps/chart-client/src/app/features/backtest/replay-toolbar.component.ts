import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Timeframe } from '@trade-automation/contracts';
import { formatBalance, formatCursorUtc } from './replay-format';
import { REPLAY_TIMEFRAMES } from './replay-keys';
import { AUTOPLAY_SPEEDS_MS, type AutoPlaySpeedMs } from '../../core/replay/auto-play';

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
  /** The engine takes step presses (started, not reloading); one pressed while busy is queued (T-037). */
  readonly stepReady = input(true);
  /** T-037: a step press waiting for the step or switch in flight. */
  readonly stepQueued = input(false);
  readonly atEnd = input(false);
  /** The server has completed the session: nothing can be stepped or switched (decision 28). */
  readonly completed = input(false);
  /** T-059: the session reached the server's numeric limit — this message stays; nothing can be stepped or switched. */
  readonly halted = input<string | null>(null);
  /** A request to the server is being retried after a network failure. */
  readonly retrying = input(false);
  /** A one-line message: resynced, reloaded from the server, … */
  readonly notice = input<string | null>(null);
  readonly error = input<string | null>(null);
  /** T-023: what every open position's current stop would lose (replay-core `openRisk`). */
  readonly openRisk = input(0);
  /** T-054: used margin ÷ equity (D12); null when the account cannot be marked. */
  readonly marginUtilisation = input<number | null>(null);
  /** T-052: auto-play is running, and its seconds per candle. */
  readonly playing = input(false);
  readonly speedMs = input<AutoPlaySpeedMs>(500);

  readonly step = output<void>();
  readonly playToggle = output<void>();
  readonly speedChange = output<AutoPlaySpeedMs>();
  readonly speeds = AUTOPLAY_SPEEDS_MS;
  /** Play needs what a step needs: a started, live, unfinished (T-059: and not halted) session. */
  readonly canPlay = computed(() => this.stepReady() && !this.atEnd() && !this.completed() && this.halted() === null && this.viewingAt() === null);
  readonly timeframeChange = output<Timeframe>();

  readonly timeframes = REPLAY_TIMEFRAMES;
  readonly cursorText = computed(() => formatCursorUtc(this.cursorMs()));
  /** In view-only mode the timeframe can still change (not persisted); only a live, complete (or halted) session locks it. */
  readonly timeframeLocked = computed(() => (this.completed() || this.halted() !== null) && this.viewingAt() === null);
  readonly balanceText = computed(() => formatBalance(this.balance(), this.currency()));
  readonly openRiskText = computed(() => formatBalance(this.openRisk(), this.currency()));
  readonly marginText = computed(() => {
    const u = this.marginUtilisation();
    return u === null ? null : `margin ${Math.round(u * 100)} %`;
  });
  /** Above 80 % of equity in margin (design §6 D12). */
  readonly marginAmber = computed(() => (this.marginUtilisation() ?? 0) > 0.8);

  onSpeed(value: string): void {
    this.speedChange.emit(Number(value) as AutoPlaySpeedMs);
  }
}
