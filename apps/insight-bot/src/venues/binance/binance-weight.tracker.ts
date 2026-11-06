import { Injectable } from '@nestjs/common';
import { currentWeightCaller, type WeightCaller } from './weight-caller';

const MINUTE_MS = 60_000;

/**
 * architecture/insight-bot-system-design.md §4.5, D15 — what the app has spent of Binance's
 * 2400 weight/min, for the admin health page's futures weight (`/api/web/health/streams`) and the
 * `ib_binance_weight_used_1m` gauge (§6.1).
 *
 * **`/futures/data/*` returns NO `X-MBX-USED-WEIGHT-1M` header; `/fapi/*` does.**
 * Measured 2026-09-28 per AGENTS.md's repetition rule: **5 requests to each endpoint on two
 * occasions, 21:11 and 21:16 UTC — the header was absent 0/5 and 0/5 on `/futures/data/`
 * `openInterestHist`, and present 5/5 and 5/5 on `/fapi/v1/openInterest`.** So this poller,
 * which calls nothing but `/futures/data/*`, cannot read its own usage back from the venue.
 *
 * **And it does not need to: `/futures/data/*` costs 0 of the 2400** (IB-BUG-030 — docs + measured,
 * see `CALL_WEIGHT` in `futures-data.client.ts`). Those endpoints have their own per-IP limit of
 * 1000 requests / 5 min, which this tracker does not measure.
 *
 * Hence two inputs, and the reading prefers the truthful one:
 * - `recordHeader(n)` — authoritative, from any `/fapi/*` response that carries the header
 *   (gap repair, the funding fetch, the other collectors). Wins while it is fresh.
 * - `recordCall(weight)` — this app's own count, a trailing-minute sum of what it spent at the
 *   documented weights. Used when no header has arrived within the last minute.
 *
 * The estimate is a **lower bound on our own traffic only** — it cannot see another process
 * sharing the IP. That is exactly why the header wins whenever there is one.
 *
 * The header counts Binance's **calendar** minute (it resets at :00, seen 2026-11-04); the
 * estimate is a **trailing** 60 s. They agree away from a minute boundary, not across one.
 */
@Injectable()
export class BinanceWeightTracker {
  private calls: Array<{ at: number; weight: number }> = [];
  private header: { at: number; value: number } | null = null;
  /** IB-147: documented weight spent per caller since the process started (a counter: it only grows). */
  private readonly spent = new Map<WeightCaller, number>();

  /**
   * One request this app made, with the weight the venue documents for it. IB-147: booked to the caller whose work it
   * is (`withWeightCaller`), or to `caller` when the call site names one.
   */
  recordCall(weight: number, at = Date.now(), caller: WeightCaller = currentWeightCaller()): void {
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`weight must be a non-negative number, got ${weight}`);
    this.spent.set(caller, (this.spent.get(caller) ?? 0) + weight);
    // Pruned here, not only in used1m(): a process nobody reads (no scrape, no admin page open)
    // would otherwise keep every call it ever made. Until WD-011 the daily report's peak sampling
    // did this as a side effect, on every record.
    this.calls = this.calls.filter((call) => at - call.at < MINUTE_MS);
    this.calls.push({ at, weight });
  }

  /** The `X-MBX-USED-WEIGHT-1M` value from a response that carried one. */
  recordHeader(value: number, at = Date.now()): void {
    if (!Number.isFinite(value) || value < 0) return; // an absent or malformed header is not an error
    this.header = { at, value };
  }

  /** Reads a header value off a response, if it has one. Returns what it recorded, or null. */
  recordFromHeaders(headers: { get(name: string): string | null }, at = Date.now()): number | null {
    const raw = headers.get('x-mbx-used-weight-1m');
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    this.recordHeader(value, at);
    return value;
  }

  /** Weight used in the trailing minute: the venue's figure if fresh, else our own count. */
  used1m(now = Date.now()): number {
    if (this.header !== null && now - this.header.at < MINUTE_MS) return this.header.value;
    this.calls = this.calls.filter((call) => now - call.at < MINUTE_MS);
    return this.calls.reduce((sum, call) => sum + call.weight, 0);
  }

  /** IB-147: documented weight spent per caller since start — for `ib_binance_weight_spent_total{caller}`. */
  spentByCaller(): ReadonlyMap<WeightCaller, number> {
    return this.spent;
  }

  /** True when `used1m` is our own estimate rather than the venue's header. */
  isEstimate(now = Date.now()): boolean {
    return this.header === null || now - this.header.at >= MINUTE_MS;
  }
}
