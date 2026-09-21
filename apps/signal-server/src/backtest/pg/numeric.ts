/**
 * architecture/backtest-app-system-design.md §12.9 — values are float64 in both runtimes and
 * `numeric(p, s)` in the database; the server rounds once, here at the repository boundary, before
 * writing. Money and prices are `numeric(20,8)`, R multiples and the profit factor `numeric(20,6)`
 * (widened from (12,6) by migration 002, BUG-002/003), percentages `numeric(8,4)` (§3).
 *
 * Known limit: `balance` and `pnl_ccy` are `numeric(20,8)` (< 1e12). Compounding past that from a
 * < 1e12 starting balance is not reachable in a realistic session; if it ever happens the closing
 * transaction fails (pg 22003 → 500) and rolls back whole, leaving the session readable
 * (advance.integration spec "a close that overflows its column rolls back").
 */
function roundTo(scale: number) {
  return <T extends number | null>(value: T): T => (value === null ? value : (Number(value.toFixed(scale)) as T));
}

export const money = roundTo(8);
export const rMultiple = roundTo(6);
export const percent = roundTo(4);
