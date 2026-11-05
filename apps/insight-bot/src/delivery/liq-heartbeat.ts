import { LIQ_TICK_SEC } from '@trade-automation/contracts';
import type { LiqTickReport } from '../alerts/liquidations/liq-alert-loop';

/**
 * IB-BUG-044 — the liquidation-alert loop's heartbeat. The loop logs a tick line only when it journalled
 * something or failed, so a dead loop and a quiet market used to look the same in the log. Now the first
 * COMPLETED tick of every 15-min UTC slot (:00/:15/:30/:45) logs one line covering the ticks since the
 * previous one; the boot tick is the first of its slot, so a fresh process logs one at once.
 *
 * The deploy watch (infra/insight-bot/scripts/deploy-watch.py, `liq_loop_missing`) owes one line per slot
 * whose start plus its lag fell inside the window, and one by boot + lag. A tick that throws or is skipped
 * (the previous one still running) never produces a line: a loop that only fails goes silent, and the watch
 * says so. Both line shapes are pinned by test/fixtures/liq-heartbeat-lines.txt, which the watch's own test
 * parses too.
 */
export const LIQ_HEARTBEAT_SEC = 15 * 60;
const SLOT_MS = LIQ_HEARTBEAT_SEC * 1_000;

/** Logged once at bootstrap when the loop is on. The watch checks heartbeats only for an image that says this. */
export const LIQ_LOOP_ON_LINE = `liq alerts loop on: tick ${LIQ_TICK_SEC} s, heartbeat every ${LIQ_HEARTBEAT_SEC / 60} min`;

export class LiqHeartbeat {
  private slot: number | null = null;
  private ticks = 0;
  private prints = 0;
  private journalled = 0;
  private lagMs = 0;
  private failed = 0;
  private skipped = 0;

  /** A tick that threw. Counted; never a line by itself. */
  failedTick(): void { this.failed++; }

  /** A tick skipped because the previous one was still running. Counted; never a line by itself. */
  skippedTick(): void { this.skipped++; }

  /**
   * A completed tick (`r.toMs` is its evaluated-to moment, the cursor) that finished at `doneMs`. Returns the
   * heartbeat line when it is the first completed tick of a new 15-min slot, else null.
   */
  record(r: LiqTickReport, doneMs: number): string | null {
    this.ticks++;
    this.prints += r.prints;
    this.journalled += r.alerts + r.continuations + r.controls;
    this.lagMs = Math.max(this.lagMs, doneMs - r.toMs);
    const slot = Math.floor(r.toMs / SLOT_MS) * SLOT_MS;
    if (this.slot !== null && slot <= this.slot) return null;
    this.slot = slot;
    const line = `liq alerts heartbeat @${new Date(slot).toISOString()}: ${this.ticks} ticks, ${this.prints} prints read, `
      + `${this.journalled} journalled, cursor lag ≤ ${(Math.max(0, this.lagMs) / 1_000).toFixed(1)} s`
      + `${this.failed ? `, failed ${this.failed}` : ''}${this.skipped ? `, skipped ${this.skipped}` : ''}`;
    this.ticks = this.prints = this.journalled = this.lagMs = this.failed = this.skipped = 0;
    return line;
  }
}
