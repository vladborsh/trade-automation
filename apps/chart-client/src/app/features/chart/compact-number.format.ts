const SUFFIXES: readonly [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/**
 * architecture/chart-layouts.md §11.2 — the metric panel's price-scale formatter: a USD notional
 * of 8 334 000 000 reads `8.334B`. Four significant digits, not three: OI moves a fraction of a
 * percent per hour, and at three digits neighbouring axis ticks would print the same label.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  const abs = Math.abs(value);
  for (const [scale, suffix] of SUFFIXES) {
    // A value that rounds up to 1000 of the next-smaller suffix (999 950 → "1000K") takes this one.
    if (abs >= scale * 0.99995) {
      return `${(value / scale).toPrecision(4)}${suffix}`;
    }
  }
  return value.toPrecision(4);
}
