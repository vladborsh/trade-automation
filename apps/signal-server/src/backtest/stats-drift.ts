import { SessionAggregates } from '@trade-automation/contracts';
import { money, rMultiple } from './pg/numeric';

type Field = Exclude<keyof SessionAggregates, 'statsComputedAt'>;

/**
 * Each compared column and the rounding of its database scale (§3): money `numeric(20,8)`,
 * R multiples and the profit factor `numeric(12,6)`, counts exact.
 */
const FIELDS: ReadonlyArray<readonly [Field, (v: number) => number]> = [
  ['tradesCount', (v) => v],
  ['winsCount', (v) => v],
  ['lossesCount', (v) => v],
  ['pnlCcy', money],
  ['pnlR', rMultiple],
  ['profitFactor', rMultiple],
  ['maxDrawdownCcy', money],
  ['maxDrawdownR', rMultiple],
  ['avgWinCcy', money],
  ['avgWinR', rMultiple],
  ['avgLossCcy', money],
  ['avgLossR', rMultiple],
];

/**
 * architecture/backtest-app-system-design.md decision 38, T-018 ruling — the fields where the
 * stored aggregate columns disagree with the recomputed ones (`toSessionAggregates(computeStats(…))`).
 * Both sides are rounded to the column's scale before comparing, so float noise below the
 * database's precision is not drift; null against a number (e.g. profit factor null vs 0) is.
 * `statsComputedAt` is not compared. An empty result means no drift.
 */
export function aggregateDrift(computed: SessionAggregates, stored: SessionAggregates): Field[] {
  return FIELDS.filter(([field, round]) => {
    const a = computed[field];
    const b = stored[field];
    if (a === null || b === null) return a !== b;
    return round(a) !== round(b);
  }).map(([field]) => field);
}
