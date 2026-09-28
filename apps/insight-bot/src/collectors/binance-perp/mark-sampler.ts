import type { MarkFundingRow } from '../writers/tables';
import { markRowFromEvent } from './mappers';
import type { MarkPriceEvent } from './payloads';

/**
 * IB-005 — D5's per-minute sampling and §4.1's funding rollover, as a pure state machine.
 *
 * `!markPrice@arr@1s` sends every symbol every second. Storing that is 2.6 M rows/day; the design
 * stores **the last sample of each minute** instead. Two extra rules:
 *
 * - when a symbol's `nextFundingTime` changes, the interval just settled: the **last prediction
 *   before it** is written as its own row stamped at the settlement second, so the number the
 *   venue actually charged on is never lost between two minute samples;
 * - the settled rate itself is fetched by REST by the caller — `rollovers()` reports which
 *   symbols rolled and at what time, and owns no I/O.
 *
 * The caller drives the clock: `accept()` on every event, `sampleMinute(boundary)` once per minute
 * boundary. Nothing here reads `Date.now()`.
 */
export interface FundingRollover {
  symbol: string;
  /** The funding time that just settled — the venue's own `T` from before the change. */
  settledAt: Date;
  /** The last prediction seen before the rollover, stamped at `settledAt`. */
  lastPrediction: MarkFundingRow;
}

interface Sample {
  event: MarkPriceEvent;
  /** `T` of the last event, to notice the rollover. */
  nextFundingTime: number;
}

export class MarkSampler {
  /** The last sample per symbol, kept ACROSS minutes: a settlement lands on the hour, i.e. exactly
   * on a minute boundary, so the comparison that spots the rollover must survive the boundary. */
  private readonly last = new Map<string, Sample>();
  /** The symbols that sent something in the current minute — only these are written (D5). */
  private readonly fresh = new Set<string>();
  private readonly pendingRollovers: FundingRollover[] = [];

  /** Records one event; returns nothing — rollovers are collected and drained by `rollovers()`. */
  accept(event: MarkPriceEvent): void {
    const previous = this.last.get(event.s);
    if (previous && event.T > previous.nextFundingTime && previous.nextFundingTime > 0) {
      // the interval that ended at previous.nextFundingTime has settled
      const settledAt = new Date(previous.nextFundingTime);
      this.pendingRollovers.push({
        symbol: event.s,
        settledAt,
        lastPrediction: markRowFromEvent(previous.event, settledAt),
      });
    }
    this.last.set(event.s, { event, nextFundingTime: event.T });
    this.fresh.add(event.s);
  }

  /**
   * The rows to write for this minute boundary: the last sample of each symbol, stamped at the
   * boundary. Symbols that sent nothing in the minute are simply absent — a stale sample is not
   * re-stamped, so a silent stream leaves a hole the gap report can see.
   */
  sampleMinute(boundary: Date): MarkFundingRow[] {
    const rows: MarkFundingRow[] = [];
    for (const symbol of this.fresh) {
      const sample = this.last.get(symbol);
      if (sample) rows.push(markRowFromEvent(sample.event, boundary));
    }
    this.fresh.clear(); // only symbols heard from in the NEXT minute get a row then
    return rows;
  }

  /** Drains the rollovers noticed since the last call. */
  rollovers(): FundingRollover[] {
    return this.pendingRollovers.splice(0, this.pendingRollovers.length);
  }

  /** Symbols with a sample in the current minute (for /health). */
  get pendingSymbols(): number {
    return this.fresh.size;
  }
}

/** The minute boundary a timestamp belongs to (the start of its minute). */
export function minuteBoundary(ms: number): Date {
  return new Date(Math.floor(ms / 60_000) * 60_000);
}
