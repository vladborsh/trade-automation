import { type WritableSignal, signal } from '@angular/core';
import type { AheadResponse, Candle, CompactCandleTuple, Panel, ReplayHistoryResponse, Timeframe } from '@trade-automation/contracts';
import { nextCursor } from '@trade-automation/replay-core';
import { AheadCache } from './ahead-cache';
import { AHEAD_PAGE_SIZE, cacheSizing } from './cache-sizing';
import { bucketStart, foldStep, seriesAt, type TfSeries } from './fold-on-step';
import { coversReveal, nextDataAcross } from './next-data';

/** The engine's I/O: the three session endpoints it uses (backtest-app-system-design.md §7.2). */
export interface ReplayApi {
  history(panelId: string, tf: Timeframe, before: number, limit: number): Promise<ReplayHistoryResponse>;
  ahead(panelId: string, fromMs: number, limit: number): Promise<AheadResponse>;
  patchTimeframe(tf: Timeframe): Promise<void>;
}

export interface ReplayEngineConfig {
  panels: readonly Panel[];
  cursorMs: number;
  /**
   * The cursor the server has stored for the session — history is served only up to it (422
   * FUTURE_REQUESTED). The session's cursor at load, then `confirmServerCursor()` per advance.
   */
  serverCursorMs: number;
  /** The session is already complete: nothing can be stepped or switched. */
  completed?: boolean;
  /**
   * Called after every step with the new cursor — the workspace queues it for the server (T-021) —
   * and, per panel, the 1m candles this step revealed: `from <= openTime` and `openTime + 60 000 <=
   * cursorMs`, the span the server walks for the same advance (§5.5), for the fill preview (T-023).
   */
  onStep?: (cursorMs: number, revealed: ReadonlyMap<string, readonly Candle[]>) => void;
  /**
   * §9.3 view-only rewind (decision 32): history at the cursor only — no ahead cache, no steps, a
   * timeframe switch re-fetches history and is never persisted. Nothing here can move the session.
   */
  viewOnly?: boolean;
  timeframe: Timeframe;
  periodToMs: number;
  skipWeekends: boolean;
}

/** Bars per history page, initial load and each `loadOlder()`. */
export const HISTORY_PAGE = 500;

interface PanelTape {
  readonly panel: Panel;
  readonly cache: AheadCache;
  readonly series: WritableSignal<TfSeries>;
  /** Serialises this panel's ahead fetches (§5.3). */
  queue: Promise<void>;
  refilling: boolean;
  loadingOlder: boolean;
  noMoreOlder: boolean;
}

class NeedMoreData extends Error {}

/**
 * backtest-app-system-design.md §5.1–5.4 on the client: the cursor, one 1m ahead cache and one
 * timeframe series per panel. `step()` moves the cursor with replay-core's `nextCursor` over all
 * panels' caches, folds the newly revealed 1m of every panel with `foldOneMinute` (fold-on-step.ts)
 * and refills the caches in the background. A step never renders a bar it does not have: when a
 * cache cannot answer, the step waits for the page (`blocked`) and then completes.
 *
 * Framework-free apart from its signals. The server is not told about advances yet (T-021).
 */
export class ReplayEngine {
  readonly cursor = signal(0);
  readonly timeframe = signal<Timeframe>('5m');
  /** A step (or a timeframe switch) is waiting for data: the toolbar shows "loading". */
  readonly blocked = signal(false);
  /**
   * T-037: a `→` pressed while a step or a switch was in flight. At most one — further presses fold
   * into it, so holding the key never builds a backlog — and it runs as soon as the work finishes.
   */
  readonly stepQueued = signal(false);
  /** `start()` has finished — the first history is in (or failed into `error`). An e2e hook (BUG-010). */
  readonly started = signal(false);
  /** The cursor has reached the end of the period. */
  readonly atEnd = signal(false);
  readonly error = signal<string | null>(null);
  /** The server has completed the session: stepping and switching are inert (decision 28). */
  readonly completed = signal(false);
  /** §9.3: viewing the past; nothing can be stepped or persisted. */
  readonly viewOnly: boolean;

  private readonly tapes: PanelTape[];
  private busy = false;

  /** T-052: a step or a switch is running right now (auto-play skips its tick rather than queue). */
  get inFlight(): boolean {
    return this.busy;
  }
  /** BUG-009: the store is replacing this engine (a reload) — blocked for good. */
  private retired = false;
  private serverCursor: number;

  constructor(
    private readonly api: ReplayApi,
    private readonly config: ReplayEngineConfig,
  ) {
    this.cursor.set(config.cursorMs);
    this.serverCursor = config.serverCursorMs;
    this.completed.set(config.completed ?? false);
    this.viewOnly = config.viewOnly ?? false;
    this.timeframe.set(config.timeframe);
    this.atEnd.set(config.cursorMs >= config.periodToMs);
    this.tapes = config.panels.map(newTape);
  }

  /** The panel's bars, for its `ReplayPanelSource`. */
  seriesFor(panelId: string) {
    return this.tape(panelId).series.asReadonly();
  }

  /** History behind the cursor, and each cache filled from the open of the bar forming there. */
  async start(): Promise<void> {
    if (this.viewOnly) {
      await this.exclusive(async () => {
        this.blocked.set(true);
        await Promise.all(this.tapes.map((t) => this.loadHistory(t, this.timeframe())));
      });
      this.started.set(true);
      return;
    }
    await this.exclusive(async () => {
      const tf = this.timeframe();
      this.blocked.set(true);
      await Promise.all(
        this.tapes.map(async (t) => {
          t.cache.reset(bucketStart(this.cursor(), tf));
          await Promise.all([this.loadHistory(t, tf), this.fetchPage(t)]);
        }),
      );
    });
    this.refillAll();
    this.started.set(true);
  }

  /**
   * BUG-009: the store is reloading the session and will replace this engine. From now on it shows
   * "loading" and ignores every step and switch — its queue is already stopped, so a step taken
   * here would move the cursor on screen and then vanish with the reload. It is no longer
   * `started` either, so the readiness hook drops until the fresh engine's `start()` completes.
   */
  retire(): void {
    this.retired = true;
    this.blocked.set(true);
    this.started.set(false);
    this.stepQueued.set(false); // never carried across a reload
  }

  /** An advance response: the server's cursor, which history requests may not pass. */
  confirmServerCursor(ms: number): void {
    this.serverCursor = Math.max(this.serverCursor, ms);
  }

  /** The server says the session is complete. */
  complete(): void {
    this.completed.set(true);
  }

  /**
   * `→`. While a step or a switch is in flight the press is queued (one at most, `stepQueued`) and
   * runs when that finishes (T-037); a retired engine, the period end, a complete session and
   * view-only ignore it.
   */
  async step(): Promise<void> {
    if (this.atEnd() || this.completed() || this.viewOnly || this.retired) return;
    if (this.busy) {
      this.stepQueued.set(true);
      return;
    }
    await this.exclusive(async () => {
      for (;;) {
        try {
          this.advance();
          return;
        } catch (err) {
          if (!(err instanceof NeedMoreData)) throw err;
          this.blocked.set(true);
          await this.fetchLaggards();
        }
      }
    });
    this.refillAll();
  }

  /**
   * §5.4 timeframe switch: the cursor does not move, each cache is re-sized (nothing is
   * discarded) and the session is patched. The new series is what `GET …/candles?before=cursor`
   * would return — closed bars plus the partially formed one — built so it also works while the
   * client's cursor is ahead of the server's: history up to `anchor`, the new timeframe's bar
   * boundary at or before the server cursor, and the 1m from there folded with `foldOneMinute`.
   */
  async setTimeframe(tf: Timeframe): Promise<void> {
    if (tf === this.timeframe() || (this.completed() && !this.viewOnly)) return;
    if (this.viewOnly) return this.viewTimeframe(tf);
    await this.exclusive(async () => {
      this.blocked.set(true);
      const cursor = this.cursor();
      const anchor = bucketStart(Math.min(cursor, this.serverCursor), tf);
      const series = await Promise.all(
        this.tapes.map(async (t) => {
          await this.extendBack(t, anchor);
          const history = await this.api.history(t.panel.id, tf, anchor, HISTORY_PAGE);
          return seriesAt(history.bars, t.cache.revealed(anchor, cursor), tf, cursor);
        }),
      );
      // The new timeframe and its bars land together, only once every panel has them.
      this.timeframe.set(tf);
      this.tapes.forEach((t, i) => {
        t.series.set(series[i]);
        t.noMoreOlder = false;
      });
      this.api.patchTimeframe(tf).catch((err: unknown) => this.error.set(`Could not save the timeframe: ${describe(err)}`));
    });
    this.refillAll();
  }

  /**
   * T-029: a panel added mid-session gets its own tape at the current cursor — history plus the
   * bar forming there, and an ahead cache — built the way `setTimeframe` rebuilds a series, so it
   * also works while the client's cursor is ahead of the server's: history up to `anchor` (the bar
   * boundary at or before the server cursor), the 1m from `anchor` folded with `foldOneMinute`.
   * The server must already know the panel (its layout was patched first).
   */
  async addPanel(panel: Panel): Promise<void> {
    await this.whenIdle();
    await this.exclusive(async () => {
      if (this.tapes.some((t) => t.panel.id === panel.id)) return;
      this.blocked.set(true);
      const tf = this.timeframe();
      const cursor = this.cursor();
      const anchor = bucketStart(Math.min(cursor, this.serverCursor), tf);
      const t = newTape(panel);
      t.cache.reset(anchor);
      while (!t.cache.endOfTape && !coversReveal([t.cache], cursor)) await this.fetchPage(t);
      const history = await this.api.history(panel.id, tf, anchor, HISTORY_PAGE);
      t.series.set(seriesAt(history.bars, t.cache.revealed(anchor, cursor), tf, cursor));
      t.cache.dropBefore(bucketStart(cursor, tf)); // as after a step: the cache starts at the forming bar
      this.tapes.push(t);
    });
    this.refillAll();
  }

  /** T-029: a panel removed mid-session drops its tape. */
  async removePanel(panelId: string): Promise<void> {
    await this.whenIdle();
    await this.exclusive(async () => {
      const i = this.tapes.findIndex((t) => t.panel.id === panelId);
      if (i >= 0) this.tapes.splice(i, 1);
    });
  }

  /** §9.3: in view-only mode `cursor <= server cursor`, so history with the forming bar is servable as is. */
  private async viewTimeframe(tf: Timeframe): Promise<void> {
    await this.exclusive(async () => {
      this.blocked.set(true);
      const histories = await Promise.all(this.tapes.map((t) => this.api.history(t.panel.id, tf, this.cursor(), HISTORY_PAGE)));
      this.timeframe.set(tf); // not persisted: no PATCH in view-only mode
      this.tapes.forEach((t, i) => {
        t.series.set({ closed: histories[i].bars, forming: histories[i].forming });
        t.noMoreOlder = false;
      });
    });
  }

  /** Older closed bars for one panel (the chart scrolled back to its oldest bar). */
  async loadOlder(panelId: string): Promise<void> {
    const t = this.tape(panelId);
    const { closed, forming } = t.series();
    if (t.loadingOlder || t.noMoreOlder) return;
    const tf = this.timeframe();
    const newest = closed[0]?.openTime ?? forming?.openTime ?? bucketStart(this.cursor(), tf);
    const before = Math.min(newest, this.serverCursor); // the server serves history only up to its cursor
    t.loadingOlder = true;
    try {
      const res = await this.api.history(t.panel.id, tf, before, HISTORY_PAGE);
      if (tf !== this.timeframe()) return; // a switch replaced this series meanwhile
      const older = res.bars.filter((b) => b.openTime < before);
      if (older.length === 0) t.noMoreOlder = true;
      else t.series.update((s) => ({ closed: [...older, ...s.closed], forming: s.forming }));
    } finally {
      t.loadingOlder = false;
    }
  }

  /** One step, synchronously, or `NeedMoreData` when a cache cannot answer yet. */
  private advance(): void {
    const tf = this.timeframe();
    const from = this.cursor();
    const caches = this.tapes.map((t) => t.cache);
    const next = nextCursor(from, tf, this.config.skipWeekends, (ms) => {
      const r = nextDataAcross(caches, ms);
      if (r.kind === 'unknown') throw new NeedMoreData();
      return r.kind === 'at' ? r.ms : null;
    }, this.config.periodToMs);
    if (!coversReveal(caches, next)) throw new NeedMoreData();
    if (next <= from) {
      this.atEnd.set(true);
      return;
    }
    const carryFrom = bucketStart(from, tf);
    const revealed = new Map<string, readonly Candle[]>();
    for (const t of this.tapes) {
      const bars = t.cache.revealed(carryFrom, next);
      revealed.set(t.panel.id, bars.filter((b) => b.openTime >= from));
      t.series.set(foldStep(t.series(), bars, tf, next));
      t.cache.dropBefore(bucketStart(next, tf));
    }
    this.cursor.set(next);
    this.atEnd.set(next >= this.config.periodToMs);
    this.config.onStep?.(next, revealed);
  }

  private async loadHistory(t: PanelTape, tf: Timeframe): Promise<void> {
    const res = await this.api.history(t.panel.id, tf, this.cursor(), HISTORY_PAGE);
    t.series.set({ closed: res.bars, forming: res.forming });
  }

  /** Makes the cache know every 1m from `fromMs` (a coarser bar opens before the cache does). */
  private async extendBack(t: PanelTape, fromMs: number): Promise<void> {
    const knownFrom = t.cache.knownFrom;
    if (fromMs >= knownFrom) return;
    const older: CompactCandleTuple[] = [];
    for (let from = fromMs; from < knownFrom; ) {
      // At most one 1m candle per minute of the missing range — no need for a full page.
      const need = Math.min(AHEAD_PAGE_SIZE, Math.ceil((knownFrom - from) / 60_000));
      const page = await this.api.ahead(t.panel.id, from, need);
      const inRange = page.candles.filter((c) => c[0] < knownFrom);
      older.push(...inRange);
      if (page.endOfTape || inRange.length < page.candles.length || page.candles.length === 0) break;
      const last = page.candles[page.candles.length - 1][0];
      if (last + 60_000 >= knownFrom) break; // no minute left before the cache's start
      from = last + 1;
    }
    t.cache.prependRange(fromMs, older);
  }

  /** One page for every panel whose cache knows the least — the one holding the step back. */
  private async fetchLaggards(): Promise<void> {
    const open = this.tapes.filter((t) => !t.cache.endOfTape);
    if (open.length === 0) throw new Error('Replay tape exhausted but the cursor could not advance');
    const least = Math.min(...open.map((t) => t.cache.knownUntil));
    await Promise.all(open.filter((t) => t.cache.knownUntil === least).map((t) => this.fetchPage(t)));
  }

  private fetchPage(t: PanelTape): Promise<void> {
    t.queue = t.queue.then(async () => {
      if (t.cache.endOfTape) return;
      const page = await this.api.ahead(t.panel.id, t.cache.knownUntil, AHEAD_PAGE_SIZE);
      t.cache.appendPage(page.candles, page.endOfTape);
    });
    return t.queue;
  }

  /** §5.3 background refill: below `refill1m` ahead, fetch pages until `target1m` ahead. */
  private refillAll(): void {
    if (this.viewOnly) return;
    const { target1m, refill1m } = cacheSizing(this.timeframe());
    for (const t of this.tapes) {
      if (t.refilling || t.cache.endOfTape || t.cache.countAtOrAfter(this.cursor()) >= refill1m) continue;
      t.refilling = true;
      void (async () => {
        try {
          while (!t.cache.endOfTape && t.cache.countAtOrAfter(this.cursor()) < target1m) await this.fetchPage(t);
        } catch (err) {
          this.error.set(`Could not load candles ahead: ${describe(err)}`);
        } finally {
          t.refilling = false;
        }
      })();
    }
  }

  /** Runs `fn` unless a step or switch is already in flight; errors land in `error`. */
  private async exclusive(fn: () => Promise<void>): Promise<void> {
    if (this.busy || this.retired) return;
    this.busy = true;
    this.error.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(describe(err));
    } finally {
      this.busy = false;
      this.blocked.set(this.retired);
      if (this.stepQueued()) {
        this.stepQueued.set(false);
        void this.step(); // the queued press (T-037); it re-checks the end, completion and retirement
      }
    }
  }

  /** Waits out a step or switch in flight: `exclusive` would otherwise skip the call. */
  private async whenIdle(): Promise<void> {
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private tape(panelId: string): PanelTape {
    const t = this.tapes.find((x) => x.panel.id === panelId);
    if (!t) throw new Error(`Unknown panel '${panelId}'`);
    return t;
  }
}

function newTape(panel: Panel): PanelTape {
  return {
    panel,
    cache: new AheadCache(panel.instrument),
    series: signal<TfSeries>({ closed: [], forming: null }),
    queue: Promise.resolve(),
    refilling: false,
    loadingOlder: false,
    noMoreOlder: false,
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
