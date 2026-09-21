/**
 * architecture/backtest-app-system-design.md §12.9 — values are float64 in both runtimes and
 * `numeric(p, s)` in the database; the server rounds once, here at the repository boundary, before
 * writing. Money and prices are `numeric(20,8)`, R multiples `numeric(12,6)`, percentages
 * `numeric(8,4)` (§3).
 */
function roundTo(scale: number) {
  return <T extends number | null>(value: T): T => (value === null ? value : (Number(value.toFixed(scale)) as T));
}

export const money = roundTo(8);
export const rMultiple = roundTo(6);
export const percent = roundTo(4);
