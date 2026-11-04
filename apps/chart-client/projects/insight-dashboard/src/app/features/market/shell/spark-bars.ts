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

export function sparkGeometry(spark: WebInsightSpark): SparkGeometry {
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
