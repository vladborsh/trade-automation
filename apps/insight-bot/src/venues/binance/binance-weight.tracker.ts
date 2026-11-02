import { Injectable } from '@nestjs/common';

const MINUTE_MS = 60_000;

/**
 * architecture/insight-bot-system-design.md §4.5, D15 — what the app has spent of Binance's
 * 2400 weight/min, for `/health`'s `budget.binanceWeightUsed1m` and the
 * `ib_binance_weight_used_1m` gauge (§6.1).
 *
 * **`/futures/data/*` returns NO `X-MBX-USED-WEIGHT-1M` header; `/fapi/*` does.**
 * Measured 2026-09-28 per AGENTS.md's repetition rule: **5 requests to each endpoint on two
 * occasions, 21:11 and 21:16 UTC — the header was absent 0/5 and 0/5 on `/futures/data/`
 * `openInterestHist`, and present 5/5 and 5/5 on `/fapi/v1/openInterest`.** So this poller,
 * which calls nothing but `/futures/data/*`, cannot read its own usage back from the venue.
 *
 * Hence two inputs, and the reading prefers the truthful one:
 * - `recordHeader(n)` — authoritative, from any `/fapi/*` response that carries the header
 *   (gap repair, the funding fetch, the other collectors). Wins while it is fresh.
 * - `recordCall(weight)` — this app's own count, a trailing-minute sum of what it spent. Used
 *   when no header has arrived within the last minute, which for a poller-only process is
 *   always.
 *
 * The estimate is a **lower bound on our own traffic only** — it cannot see another process
 * sharing the IP. That is exactly why the header wins whenever there is one.
 */
@Injectable()
export class BinanceWeightTracker {
  private calls: Array<{ at: number; weight: number }> = [];
  private header: { at: number; value: number } | null = null;
  private peak = 0;

  /** One request this app made, with the weight the venue documents for it. */
  recordCall(weight: number, at = Date.now()): void {
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`weight must be a non-negative number, got ${weight}`);
    this.calls.push({ at, weight });
    this.observePeak(at);
  }

  /** The `X-MBX-USED-WEIGHT-1M` value from a response that carried one. */
  recordHeader(value: number, at = Date.now()): void {
    if (!Number.isFinite(value) || value < 0) return; // an absent or malformed header is not an error
    this.header = { at, value };
    this.observePeak(at);
  }

  /**
   * IB-011: the highest `used1m` seen since the last reset — the daily gap report's
   * "Binance weight high-water mark" (§6.2). Sampled where the value can change (on every record),
   * not on a timer, so a spike between samples cannot hide.
   */
  peak1m(): number {
    return this.peak;
  }

  /** The daily report calls this after it has read the peak, so each day reports its own. */
  resetPeak(): void {
    this.peak = 0;
  }

  private observePeak(at: number): void {
    const used = this.used1m(at);
    if (used > this.peak) this.peak = used;
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

  /** True when `used1m` is our own estimate rather than the venue's header. */
  isEstimate(now = Date.now()): boolean {
    return this.header === null || now - this.header.at >= MINUTE_MS;
  }
}
