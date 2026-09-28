/**
 * IB-012 — the per-file timestamp unit of a data.binance.vision CSV (§5).
 *
 * Binance switched spot kline timestamps from milliseconds to **microseconds** in files from
 * 2025-01 onward. The unit is a property of the FILE, not of the symbol or the date range, so it
 * is detected per file and every value in that file must agree: a mixed file means the layout
 * changed again and guessing would silently shift a month of bars.
 *
 * Lifted from `research/hedged-carry/fetch_data.py` (`detect_unit`), which states the rule: an
 * open time in [2017-01-01, 2030-01-01) is 13 digits in ms and 16 in µs.
 */

export type TimeUnit = 'ms' | 'us';

export class TimeUnitError extends Error {}

/** Detects the unit by digit count, or throws — never falls back to a guess. */
export function detectTimeUnit(values: readonly string[]): TimeUnit {
  const lengths = new Set<number>();
  for (const raw of values) {
    const digits = raw.trim();
    if (digits.length === 0) continue;
    if (!/^\d+$/.test(digits)) throw new TimeUnitError(`not an integer timestamp: ${JSON.stringify(raw)}`);
    lengths.add(digits.length);
  }
  if (lengths.size === 0) throw new TimeUnitError('empty timestamp column');
  if (lengths.size !== 1) throw new TimeUnitError(`mixed timestamp digit counts in one file: ${[...lengths].sort().join(',')}`);
  const n = [...lengths][0];
  if (n === 13) return 'ms';
  if (n === 16) return 'us';
  throw new TimeUnitError(`undeterminable timestamp unit: ${n}-digit values`);
}

/** The value as epoch milliseconds, given the file's detected unit. */
export function toEpochMs(value: string, unit: TimeUnit): number {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new TimeUnitError(`not a number: ${JSON.stringify(value)}`);
  return unit === 'us' ? Math.floor(n / 1000) : n;
}
