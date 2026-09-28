/**
 * IB-012 — do the archive's bars and the collectors' bars agree? (§5's acceptance check.)
 *
 * Why this is a *comparison tool* and not a query: `candles_1m`'s conflict key is
 * `(venue, market, symbol, open_time)` and does **not** include `source` (D12). That is the
 * right choice — one bar per minute, whoever wrote it — but it means a minute cannot hold a live
 * row and an archive row at the same time: importing a day the collectors already covered
 * replaces their rows. So the agreement has to be checked in memory, before writing, which is
 * what this does.
 */

export interface ComparableBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarDifference {
  openTime: number;
  field: keyof Omit<ComparableBar, 'openTime'>;
  left: number;
  right: number;
}

export interface CandleComparison {
  /** Minutes present in both sets. */
  compared: number;
  onlyLeft: number[];
  onlyRight: number[];
  differences: BarDifference[];
  agree: boolean;
}

const FIELDS: ReadonlyArray<keyof Omit<ComparableBar, 'openTime'>> = ['open', 'high', 'low', 'close', 'volume'];

/**
 * Compares two sets of bars minute by minute.
 *
 * `tolerance` is relative, and defaults to 0: the archive and the API are the same venue's own
 * numbers, so they should match exactly, and a tolerance that hides a real divergence would
 * defeat the check. It exists for volume, where a venue occasionally restates the last digit.
 */
export function compareCandles(
  left: readonly ComparableBar[],
  right: readonly ComparableBar[],
  tolerance = 0,
): CandleComparison {
  const leftBy = new Map(left.map((b) => [b.openTime, b]));
  const rightBy = new Map(right.map((b) => [b.openTime, b]));

  const differences: BarDifference[] = [];
  let compared = 0;

  for (const [openTime, a] of leftBy) {
    const b = rightBy.get(openTime);
    if (!b) continue;
    compared++;
    for (const field of FIELDS) {
      const x = a[field];
      const y = b[field];
      const scale = Math.max(Math.abs(x), Math.abs(y), 1);
      if (Math.abs(x - y) > tolerance * scale) differences.push({ openTime, field, left: x, right: y });
    }
  }

  const onlyLeft = [...leftBy.keys()].filter((t) => !rightBy.has(t)).sort((a, b) => a - b);
  const onlyRight = [...rightBy.keys()].filter((t) => !leftBy.has(t)).sort((a, b) => a - b);

  return {
    compared,
    onlyLeft,
    onlyRight,
    differences,
    agree: differences.length === 0 && onlyLeft.length === 0 && onlyRight.length === 0,
  };
}

/** A one-paragraph verdict for the run log and the coverage report. */
export function renderComparison(label: string, result: CandleComparison): string {
  if (result.agree) return `${label}: ${result.compared} bars compared, every OHLCV field identical.`;
  const sample = result.differences.slice(0, 3)
    .map((d) => `${new Date(d.openTime).toISOString()} ${d.field} ${d.left} vs ${d.right}`)
    .join('; ');
  return [
    `${label}: ${result.compared} bars compared, ${result.differences.length} field difference(s)`,
    result.onlyLeft.length > 0 ? `, ${result.onlyLeft.length} only in the first set` : '',
    result.onlyRight.length > 0 ? `, ${result.onlyRight.length} only in the second` : '',
    sample ? `. First: ${sample}` : '',
  ].join('');
}
