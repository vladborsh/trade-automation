import type { PaneData } from './pane-data';
import { barSeconds, snapTime } from './time-grid';

/**
 * IB-066 — the instrument page's live tail (user, 2026-10-29: "the last candle does not update and
 * no new ones appear; fresh data only after switching timeframe"). The page used to read its window
 * once. Now it polls the bot (not Binance from the browser, the user's choice):
 * - the candles, and the taker delta/CVD drawn from them, every `CANDLES_EVERY_MS`;
 * - open interest, funding, long/short, liquidations, the top-50 table and the summary every
 *   `SIDE_EVERY_MS`: they come from the bot's collectors, which do not move faster than that.
 *
 * Venue cost: only the candle poll reaches Binance, as a tail of one or two bars at `limit=99`,
 * documented weight 1 — **~12 weight/min per open tab** against the 2 400/min budget (the bot's
 * `candles.service.ts` has the arithmetic). The minute's poll reads the bot's database, plus one
 * daily-candle tail per UTC day for the previous-day levels.
 *
 * The scheduler is here rather than in the component (AGENTS.md) and knows nothing of what it
 * fetches: each job reads, and hands back how to apply what it read. The rules it owns:
 * - **one request in flight per job**: a slow answer is not stacked on;
 * - **a tick is skipped while the page is busy** (a load, an earlier window), or before it has a window;
 * - **an answer is dropped when the generation moved** while it was in flight (another symbol or
 *   timeframe), the same rule `load()` keeps;
 * - **a hidden tab polls nothing.** Back in view, it catches up at once from where each job last
 *   read; a gap wider than the window is not tailed but reloaded;
 * - `stop()` (the component's `DestroyRef`) clears every timer and listener.
 */

export const CANDLES_EVERY_MS = 5_000;
export const SIDE_EVERY_MS = 60_000;

export interface TailJob {
  readonly every: number;
  /**
   * Reads what changed since `sinceMs` — the moment the previous applied read of this job started,
   * or the window's end after a load — and returns how to apply it.
   */
  read(sinceMs: number, nowMs: number): Promise<() => void>;
}

/** The slice of `document` the scheduler watches; a fake in the spec. */
export interface Visibility {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface LiveTailOptions {
  jobs: readonly TailJob[];
  generation: () => number;
  /** True while nothing should be tailed: a load or an earlier window in flight, or no window yet. */
  busy: () => boolean;
  /** The widest gap a tail may close; a longer absence reloads the window instead. */
  maxGapMs: () => number;
  reload: () => void;
  visibility: Visibility;
  now?: () => number;
}

export class LiveTail {
  private readonly now: () => number;
  private readonly since = new Map<TailJob, number>();
  private readonly inFlight = new Set<TailJob>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private started = false;
  private readonly onVisibility = (): void => this.visibilityChanged();

  constructor(private readonly opts: LiveTailOptions) {
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.opts.visibility.addEventListener('visibilitychange', this.onVisibility);
    if (this.opts.visibility.visibilityState === 'visible') this.arm();
  }

  stop(): void {
    this.started = false;
    this.opts.visibility.removeEventListener('visibilitychange', this.onVisibility);
    this.disarm();
  }

  /** A fresh window was drawn ending at `toMs`: every job tails from there. */
  reset(toMs: number): void {
    for (const job of this.opts.jobs) this.since.set(job, toMs);
  }

  private arm(): void {
    this.disarm();
    this.timers = this.opts.jobs.map((job) => setInterval(() => void this.tick(job), job.every));
  }

  private disarm(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private visibilityChanged(): void {
    if (!this.started) return;
    if (this.opts.visibility.visibilityState !== 'visible') {
      this.disarm();
      return;
    }
    this.arm();
    if (this.opts.busy()) return; // a load is under way and will be the catch-up
    const read = this.opts.jobs.map((j) => this.since.get(j)).filter((t): t is number => t !== undefined);
    if (read.length === 0) return;
    if (this.now() - Math.min(...read) > this.opts.maxGapMs()) {
      this.opts.reload();
      return;
    }
    for (const job of this.opts.jobs) void this.tick(job);
  }

  private async tick(job: TailJob): Promise<void> {
    const sinceMs = this.since.get(job);
    if (sinceMs === undefined || this.inFlight.has(job) || this.opts.busy()) return;
    if (this.opts.visibility.visibilityState !== 'visible') return;
    const generation = this.opts.generation();
    const startedAt = this.now();
    this.inFlight.add(job);
    try {
      const apply = await job.read(sinceMs, startedAt);
      if (generation !== this.opts.generation() || !this.started) return; // another symbol or timeframe now
      apply();
      this.since.set(job, startedAt);
    } catch {
      // a failed poll leaves the chart as it was; the next tick asks again from the same point
    } finally {
      this.inFlight.delete(job);
    }
  }
}

const BUCKET_MS: Readonly<Record<string, number>> = { '1m': 60_000, '15m': 900_000, '1h': 3_600_000 };

/**
 * Where the candle poll starts: the open of the last bar on screen, which is the bar still forming
 * (or the last closed one, if a new bar has opened since). Without any bar, where the last read ended.
 */
export function candleTailFrom(panes: PaneData, sinceMs: number): number {
  const last = panes.candles.candles.at(-1);
  return last ? last.time * 1000 : sinceMs;
}

/**
 * Where the minute's poll starts: the start of the liquidation bucket the last read ended in, or
 * of the chart's bar (a week from its Monday) if that is earlier, so both the bucket and the bar
 * that were still filling are read whole again and replaced (`appendLater`). Since IB-068 the
 * markers come grouped per bar; a read starting mid-bar would bring back a part-sum for it.
 * Every bucket edge lies on the bar grid or the other way round, so the earlier one is on both.
 */
export function sideTailFrom(sinceMs: number, timeframe: string, bucket: string): number {
  const width = BUCKET_MS[bucket] ?? 60_000;
  const bucketStart = Math.floor(sinceMs / width) * width;
  const barStart = snapTime(Math.floor(sinceMs / 1000), barSeconds(timeframe)) * 1000;
  return Math.min(bucketStart, barStart);
}

/**
 * The daily candles behind the previous-day levels need re-reading only when a new UTC day has
 * begun since the last one on screen: then the day that was forming at load has closed. Returns
 * that day's open, or null when there is nothing to read.
 */
export function dailyTailFrom(panes: PaneData, nowMs: number): number | null {
  const last = panes.dailyCandles.at(-1);
  if (!last) return null;
  return Math.floor(nowMs / 86_400_000) * 86_400 > last.time ? last.time * 1000 : null;
}
