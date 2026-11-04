import type { WebInsightSpark } from '@trade-automation/contracts';

/**
 * IB-107 (§7.3) — the card's mini-chart geometry, pure: one bar per value, as percentages of the
 * box, measured from a zero line. An all-positive series stands on the bottom edge; a signed one
 * (R7's alt gap, R10's premium) hangs from a zero line placed by its own range, so a negative value
 * reads as below zero rather than as a short bar. The highlighted bar is drawn at full strength.
 */
export interface SparkBar {
  /** Distance from the top of the box, %. */
  top: number;
  /** Bar height, %. */
  height: number;
  lit: boolean;
}

export interface SparkGeometry {
  bars: SparkBar[];
  /** The zero line from the top, %, when the series crosses zero; null when it stands on the bottom. */
  zero: number | null;
}

/**
 * How a series is scaled. `zero`: amounts and signed values (liquidation USD, funding, the premium) —
 * a bar's height is its size, from zero. `range`: LEVELS (open interest, an L/S ratio, DVOL, total
 * stablecoin supply) — drawn from zero they are a row of equal bars (a 0.3 % move on $296B), so the
 * bars span the series' own range above a visible floor; the shape is the information, not the size.
 */
export type SparkScale = 'zero' | 'range';

/** In `range` scale, the lowest value's bar: low, but visibly a bar. */
export const RANGE_FLOOR_PCT = 20;

export function sparkGeometry(spark: WebInsightSpark, scale: SparkScale = 'zero'): SparkGeometry {
  if (scale === 'range' && spark.values.every((v) => v > 0)) {
    const lo = Math.min(...spark.values);
    const hi = Math.max(...spark.values);
    return {
      bars: spark.values.map((v, i) => {
        const height = hi === lo ? 100 : RANGE_FLOOR_PCT + ((v - lo) / (hi - lo)) * (100 - RANGE_FLOOR_PCT);
        return { top: 100 - height, height, lit: spark.highlight === i };
      }),
      zero: null,
    };
  }
  const max = Math.max(0, ...spark.values);
  const min = Math.min(0, ...spark.values);
  const range = max - min;
  const zero = range === 0 ? 100 : (max / range) * 100;
  return {
    bars: spark.values.map((v, i) => {
      const height = range === 0 ? 0 : (Math.abs(v) / range) * 100;
      return { top: v >= 0 ? zero - height : zero, height, lit: spark.highlight === i };
    }),
    zero: min < 0 ? zero : null,
  };
}
