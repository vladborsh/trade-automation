/**
 * IB-BUG-006 — one queue in front of CoinGecko, so the forward-only series cannot be starved by
 * a backfill.
 *
 * **The defect this exists to remove.** `/global` and the 365-day per-coin backfill are two
 * schedulers sharing one keyless IP allowance. They never coordinated: the backfill ran flat out
 * while `/global` fired on its own 10-minute clock, lost the race, took the 429, retried into the
 * same pressure and lost again. Measured on 2026-09-28: **one `/global` row in twenty minutes,
 * then none.** `market_cap_global` has no history endpoint — CoinGecko's is paid — so every slot
 * lost that way is lost permanently, which is why the dashboard's dominance card has to print
 * «в ряду пропуск сбора» to this day.
 *
 * **What this is not.** It does not raise the request rate. The spacing is the same 30 s measured
 * for the backfill in `schedule.ts`, and it now applies to *every* CoinGecko request rather than
 * only to the gaps between coins — so the total rate is unchanged and `/global` simply takes one
 * of the slots the backfill would have used. A `/global` sample costs the backfill 30 seconds
 * once every ten minutes; the backfill has nothing waiting on it, and the series it delays by
 * half a minute can be re-fetched for a year back at any time. The one that cannot is the one
 * that now goes first.
 *
 * The rule, in one line: **when two requests are waiting, the one whose data can never be
 * recovered goes first**, and a 429 pauses everyone, because the allowance is shared.
 */

/**
 * Why a caller is here. `forward-only` is the series with no history endpoint; `backfill` is
 * anything that could be re-fetched later if it had to be.
 */
export type CoingeckoPriority = 'forward-only' | 'backfill';

const RANK: Record<CoingeckoPriority, number> = { 'forward-only': 0, backfill: 1 };

export interface CoingeckoGateOptions {
  /** Minimum gap between any two CoinGecko requests. Defaults to the measured backfill spacing. */
  minSpacingMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called when a `forward-only` request is dispatched ahead of queued backfill work. The whole
   * point of the task is visible here, so it is worth a log line rather than silence.
   */
  onPreempt?: (info: { queuedBehind: number; waitedMs: number }) => void;
}

interface Task {
  priority: CoingeckoPriority;
  seq: number;
  enqueuedAtMs: number;
  run: () => Promise<void>;
}

export class CoingeckoGate {
  private readonly queue: Task[] = [];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private busy = false;
  private seq = 0;
  private nextAllowedAtMs = 0;

  constructor(private readonly options: CoingeckoGateOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Runs `fn` in a slot of its own, after any higher-priority work already waiting.
   *
   * One request is in flight at a time and the next may not start until `minSpacingMs` after the
   * last one finished. **A retry must call this again rather than holding its slot**, which is
   * what `ContextClient` does: a backfill call sleeping off a 429 inside the gate would block the
   * `/global` poll for the length of the back-off and reproduce the bug through the fix.
   */
  async run<T>(priority: CoingeckoPriority, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        priority,
        seq: (this.seq += 1),
        enqueuedAtMs: this.now(),
        run: async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        },
      });
      void this.pump();
    });
  }

  /**
   * Hold every caller back until `ms` from now — used after a 429.
   *
   * It applies to all priorities on purpose: the 429 says the shared allowance is spent, so
   * sending `/global` into it would only convert one rate-limited caller into two. A ten-minute
   * slot has room to absorb a minute of back-off; it does not have room to lose the sample.
   */
  backOff(ms: number): void {
    this.nextAllowedAtMs = Math.max(this.nextAllowedAtMs, this.now() + ms);
  }

  /** How many requests are waiting — the figure the collector logs when `/global` jumps them. */
  get queued(): number {
    return this.queue.length;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const wait = this.nextAllowedAtMs - this.now();
        if (wait > 0) await this.sleep(wait);
        // Sorted AFTER the wait, never before it: a `/global` poll that arrives while the gate is
        // holding the spacing must still go first. Sorting at enqueue time would have fixed the
        // order at the moment the backfill queued twenty coins, which is the bug.
        this.queue.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);
        const task = this.queue.shift();
        if (!task) break;
        if (task.priority === 'forward-only' && this.queue.length > 0) {
          this.options.onPreempt?.({ queuedBehind: this.queue.length, waitedMs: this.now() - task.enqueuedAtMs });
        }
        try {
          await task.run();
        } finally {
          this.nextAllowedAtMs = Math.max(this.nextAllowedAtMs, this.now() + this.options.minSpacingMs);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
