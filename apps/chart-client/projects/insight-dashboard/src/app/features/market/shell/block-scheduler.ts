/**
 * IB-088 (market-page design D13) — one scheduler per page, one entry per block.
 *
 * Pure logic over injected timers and a visibility source, so every rule is a fake-timer spec:
 * - each block polls at its own cadence (`BLOCK_INTERVALS_MS`);
 * - **no overlap**: a tick while that block's request is still in flight is skipped, not queued;
 * - **hidden tab pauses everything**; becoming visible fires every block once, then resumes;
 * - **back-off ×2 up to 5 min** after an error, back to the cadence on the next success; the error
 *   stays on that block only (`state(id).error`), the others keep polling.
 */
export const BLOCK_INTERVALS_MS = {
  liquidations: 10_000,
  insights: 60_000,
  kpis: 60_000,
  positioning: 60_000,
  caps: 120_000,
  /** IB-090: the Fear & Greed card (/context/cards) — a daily index, read as often as the caps. */
  sentiment: 120_000,
  flows: 300_000,
} as const;
export type BlockId = keyof typeof BLOCK_INTERVALS_MS;
export const MAX_BACKOFF_MS = 300_000;

export interface SchedulerTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BlockState {
  /** Last successful load, epoch ms; null before the first. */
  lastOkAt: number | null;
  /** The last error's message, cleared by the next success. */
  error: string | null;
  inFlight: boolean;
  /** The delay before the next attempt: the cadence, or the back-off after errors. */
  delayMs: number;
}

interface Entry {
  id: BlockId;
  intervalMs: number;
  load: () => Promise<void>;
  state: BlockState;
  timer: unknown;
  /** A refresh arrived while in flight: run once more as soon as the current request lands. */
  rerun: boolean;
}

export class BlockScheduler {
  private readonly entries = new Map<BlockId, Entry>();
  private visible = true;
  private running = false;

  constructor(
    private readonly timers: SchedulerTimers,
    private readonly onChange: () => void = () => undefined,
  ) {}

  register(id: BlockId, load: () => Promise<void>, intervalMs: number = BLOCK_INTERVALS_MS[id]): void {
    this.entries.set(id, { id, intervalMs, load, timer: null, rerun: false, state: { lastOkAt: null, error: null, inFlight: false, delayMs: intervalMs } });
  }

  state(id: BlockId): BlockState | null {
    const e = this.entries.get(id);
    return e ? { ...e.state } : null;
  }

  /** Every registered block with its cadence and state — the live indicator reads this. */
  snapshot(): Array<{ id: BlockId; intervalMs: number; state: BlockState }> {
    return [...this.entries.values()].map((e) => ({ id: e.id, intervalMs: e.intervalMs, state: { ...e.state } }));
  }

  /** Starts every block now (a first load), then on its cadence. */
  start(): void {
    this.running = true;
    for (const e of this.entries.values()) void this.fire(e);
  }

  stop(): void {
    this.running = false;
    for (const e of this.entries.values()) this.clear(e);
  }

  /**
   * Fires one block now (e.g. its period changed), keeping the no-overlap rule: if that block is
   * in flight, the request carrying the OLD parameters finishes and exactly one new one follows at
   * once — a refresh is never dropped, which would leave the old period's data up until the next tick.
   */
  refresh(id: BlockId): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.state.inFlight) e.rerun = true;
    else void this.fire(e);
  }

  /** `document.visibilitychange`: pause while hidden; on return, fire every block once and resume. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!this.running) return;
    if (!visible) {
      for (const e of this.entries.values()) this.clear(e);
      return;
    }
    for (const e of this.entries.values()) void this.fire(e);
  }

  private async fire(e: Entry): Promise<void> {
    if (!this.running || !this.visible) return;
    this.clear(e);
    if (e.state.inFlight) return; // no overlap: the running request will schedule the next one
    e.state.inFlight = true;
    this.onChange();
    try {
      await e.load();
      e.state.lastOkAt = this.timers.now();
      e.state.error = null;
      e.state.delayMs = e.intervalMs;
    } catch (error) {
      e.state.error = (error as Error).message ?? String(error);
      e.state.delayMs = Math.min(MAX_BACKOFF_MS, Math.max(e.intervalMs, e.state.delayMs) * 2);
    } finally {
      e.state.inFlight = false;
      this.onChange();
      if (e.rerun) {
        e.rerun = false;
        void this.fire(e);
      } else {
        this.schedule(e);
      }
    }
  }

  private schedule(e: Entry): void {
    if (!this.running || !this.visible) return;
    this.clear(e);
    e.timer = this.timers.setTimeout(() => void this.fire(e), e.state.delayMs);
  }

  private clear(e: Entry): void {
    if (e.timer !== null) this.timers.clearTimeout(e.timer);
    e.timer = null;
  }
}

/**
 * D13 as amended by the TL (2026-11-03): "live · обновлено N с назад" is the age of the NEWEST
 * successful update — a block refreshed 2 s ago next to «118 с назад» read as a stale page — and it
 * turns amber when ANY loaded block is past 2× ITS OWN cadence; `stale` names those blocks for the
 * title. A block not yet loaded does not count (the page shows its own skeleton); none loaded → null.
 */
export function liveAge(
  blocks: ReadonlyArray<{ id: BlockId; intervalMs: number; state: Pick<BlockState, 'lastOkAt'> }>,
  nowMs: number,
): { seconds: number; stale: BlockId[] } | null {
  const loaded = blocks.filter((b) => b.state.lastOkAt !== null);
  if (loaded.length === 0) return null;
  const age = (b: (typeof loaded)[number]) => Math.max(0, nowMs - (b.state.lastOkAt as number));
  const newestMs = Math.min(...loaded.map(age));
  return { seconds: Math.floor(newestMs / 1000), stale: loaded.filter((b) => age(b) > 2 * b.intervalMs).map((b) => b.id) };
}
