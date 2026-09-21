import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';
import { Resampler } from '@trade-automation/replay-core';
import { CandleStore } from '../storage/candle-store.port';

const DAY_MS = 24 * 60 * 60 * 1000;

/** architecture/backtest-app-system-design.md §10 — the timeframes this job persists. */
export const DERIVED_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

export interface DeriveOptions {
  /** Start of the 1m walk; floored to its UTC day so the first derived bars see every minute. */
  fromMs?: number;
  /** Also rewrite bars this job wrote before (`source: 'resampled'`). Never touches other sources. */
  force: boolean;
}

type PerTf = Record<Timeframe, number>;

export interface DeriveCounts {
  instrument: InstrumentId;
  /** UTC days of 1m walked, and 1m candles read. */
  days1m: number;
  candles1m: number;
  /** Closed derived bars written where the target tf had nothing at that openTime. */
  written: Partial<PerTf>;
  /** Existing `resampled` bars rewritten (only with `force`). */
  replaced: Partial<PerTf>;
  /** Closed derived bars not written because the target tf already holds that openTime. */
  skipped: Partial<PerTf>;
}

/**
 * architecture/backtest-app-system-design.md §10 — derive and persist the closed 5m/15m/1h/4h/1d
 * bars of one instrument from its stored 1m, through the replay-core `Resampler` (the one
 * definition of a derived bar). Returns `null` when the instrument has no 1m.
 *
 * - **Streaming.** 1m is read in ascending order through `CandleStore.stream`, which reads one day
 *   at a time; derived bars are buffered for at most one day and written in day-sized batches per
 *   tf. The tape is never held in memory.
 * - **Closed bars only.** The `Resampler` closes a bar when a 1m candle from a later bucket
 *   arrives, so the still-forming bars at the end of the 1m tape (a partial day, a partial bar)
 *   are never written.
 * - **Fills gaps, never overwrites.** Before writing a day's batch for a tf, the day's existing
 *   bars at that tf are read; a bar is written only where no bar with that `openTime` exists.
 *   A live/venue-sourced bar is therefore never replaced by a resampled one. With `force`, bars
 *   previously written by this job (`source: 'resampled'`) are rewritten too — still never a
 *   bar from another source. `CandleStore.upsert` itself always overwrites, so this
 *   read-then-write is how "insert only if absent" is expressed without changing the port.
 * - **Idempotent.** A second run finds every bar present and writes nothing.
 * - No venue calls; only the store.
 */
export async function deriveTimeframes(
  store: CandleStore,
  instrument: InstrumentId,
  options: DeriveOptions,
): Promise<DeriveCounts | null> {
  const coverage = await store.coverage(instrument, '1m');
  if (!coverage) return null;

  const counts: DeriveCounts = { instrument, days1m: 0, candles1m: 0, written: {}, replaced: {}, skipped: {} };
  const start = floorDay(Math.max(coverage.from, options.fromMs ?? coverage.from));
  if (start > coverage.to) return counts;

  const resampler = new Resampler();
  let pending: Candle[] = [];
  let currentDay: number | null = null;

  for await (const bar of store.stream(instrument, '1m', start, coverage.to)) {
    counts.candles1m++;
    // The first 1m of a new day closes the previous day's last buckets, so it is fed before the
    // flush: everything pending then belongs to earlier days.
    pending.push(...resampler.onClosed1m(bar).closed);
    const day = floorDay(bar.openTime);
    if (day !== currentDay) {
      counts.days1m++;
      currentDay = day;
      await writeBatch(store, instrument, pending, options.force, counts);
      pending = [];
    }
  }
  await writeBatch(store, instrument, pending, options.force, counts);
  return counts;
}

async function writeBatch(
  store: CandleStore,
  instrument: InstrumentId,
  closed: readonly Candle[],
  force: boolean,
  counts: DeriveCounts,
): Promise<void> {
  const groups = new Map<string, { tf: Timeframe; day: number; bars: Candle[] }>();
  for (const bar of closed) {
    const day = floorDay(bar.openTime);
    const key = `${bar.timeframe}|${day}`;
    const group = groups.get(key) ?? { tf: bar.timeframe, day, bars: [] };
    group.bars.push(bar);
    groups.set(key, group);
  }

  for (const { tf, day, bars } of groups.values()) {
    const existing = new Map(
      (await store.query(instrument, tf, day, day + DAY_MS - 1)).map((c) => [c.openTime, c.source]),
    );
    const toWrite: Candle[] = [];
    for (const bar of bars) {
      const source = existing.get(bar.openTime);
      if (source === undefined) {
        toWrite.push(bar);
        bump(counts.written, tf);
      } else if (force && source === 'resampled') {
        toWrite.push(bar);
        bump(counts.replaced, tf);
      } else {
        bump(counts.skipped, tf);
      }
    }
    if (toWrite.length > 0) await store.upsert(toWrite);
  }
}

function bump(counter: Partial<PerTf>, tf: Timeframe): void {
  counter[tf] = (counter[tf] ?? 0) + 1;
}

function floorDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export interface DeriveArgs {
  instrument?: InstrumentId;
  fromMs?: number;
  force: boolean;
}

/** `[--instrument <id>] [--from <iso>] [--force]`. Throws on anything else. */
export function parseDeriveArgs(argv: readonly string[]): DeriveArgs {
  const args: DeriveArgs = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--force') {
      args.force = true;
    } else if (flag === '--instrument' || flag === '--from') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--instrument') {
        args.instrument = value as InstrumentId;
      } else {
        const ms = Date.parse(value);
        if (Number.isNaN(ms)) throw new Error(`--from: not an ISO date: ${value}`);
        args.fromMs = ms;
      }
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  return args;
}
