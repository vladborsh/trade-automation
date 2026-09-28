import type { MarkFundingRow } from '../writers/tables';
import { markRowFromTicker } from './mappers';
import type { BybitTickerData } from './payloads';

/**
 * IB-008 — the snapshot+delta merge and §3.3's volume rule, as a pure state machine.
 *
 * Two things this exists for:
 *
 * 1. **`tickers` deltas carry only what changed.** A delta with no `markPrice` must not erase the
 *    mark price we know; it updates the fields it carries and leaves the rest. Confirmed live:
 *    the second message on `tickers.BTCUSDT` was `{symbol, indexPrice, bid1Price, bid1Size}`.
 * 2. **Bybit mark rows are written per minute only for the signal set** (BTC/ETH/SOL), and for
 *    every other symbol **only at a funding settlement** (§3.3's row-count rule: per-minute marks
 *    for all 30 symbols on three venues is 31.6 M rows/year for no stage-1 gain).
 *
 * As in IB-005, a settlement is noticed by `nextFundingTime` moving, and the caller owns the clock.
 */
export interface BybitRollover {
  symbol: string;
  /** The funding time that just settled (the venue's own previous `nextFundingTime`). */
  settledAt: Date;
  /** The last prediction before it, stamped at the settlement second. */
  lastPrediction: MarkFundingRow;
}

export class TickerState {
  /** symbol → the merged snapshot, kept across minutes (a settlement lands on a boundary). */
  private readonly merged = new Map<string, BybitTickerData>();
  /** symbols updated since the last `sampleMinute` — only these get a per-minute row. */
  private readonly fresh = new Set<string>();
  private readonly pendingRollovers: BybitRollover[] = [];

  constructor(private readonly signalSet: ReadonlySet<string>) {}

  /** One `tickers` message, snapshot or delta. */
  accept(symbol: string, data: BybitTickerData, type: 'snapshot' | 'delta'): void {
    const previous = this.merged.get(symbol);
    const next: BybitTickerData = type === 'snapshot' || !previous ? { ...data } : { ...previous, ...stripUndefined(data) };

    const before = Number(previous?.nextFundingTime ?? 0);
    const after = Number(next.nextFundingTime ?? 0);
    if (previous && before > 0 && after > before) {
      const settledAt = new Date(before);
      this.pendingRollovers.push({ symbol, settledAt, lastPrediction: markRowFromTicker(symbol, previous, settledAt) });
    }

    this.merged.set(symbol, next);
    this.fresh.add(symbol);
  }

  /**
   * The rows for this minute boundary: **signal-set symbols only** (§3.3). Everything else is
   * written at its settlement, by `rollovers()`.
   */
  sampleMinute(boundary: Date): MarkFundingRow[] {
    const rows: MarkFundingRow[] = [];
    for (const symbol of this.fresh) {
      if (!this.signalSet.has(symbol)) continue;
      const data = this.merged.get(symbol);
      if (data) rows.push(markRowFromTicker(symbol, data, boundary));
    }
    this.fresh.clear();
    return rows;
  }

  /** Settlements noticed since the last call, drained. */
  rollovers(): BybitRollover[] {
    return this.pendingRollovers.splice(0, this.pendingRollovers.length);
  }

  /** The merged view of one symbol (specs and /health). */
  snapshotOf(symbol: string): BybitTickerData | undefined {
    return this.merged.get(symbol);
  }

  get trackedSymbols(): number {
    return this.merged.size;
  }
}

/** A delta may carry explicit `undefined`s after JSON round-trips through optional fields. */
function stripUndefined(data: BybitTickerData): BybitTickerData {
  const out: BybitTickerData = { symbol: data.symbol };
  for (const [key, value] of Object.entries(data)) if (value !== undefined) out[key] = value;
  return out;
}
