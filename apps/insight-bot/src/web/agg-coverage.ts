/**
 * IB-056 — the pure half of the aggregate-coverage block: rows in, contract out.
 *
 * Beside the controller, mirroring `collector-coverage.ts`, so the arithmetic is testable without
 * a database and the controller stays a wiring layer.
 */
import type { WebAggCoverage } from '@trade-automation/contracts';
import type { AggCoverageRow } from '../db/pg/agg-coverage-reads';

/**
 * Worst first: the series with the largest derivable backlog leads, because that is the only
 * column anyone acts on. Ties break on `(symbol, market, tf)` so the order is stable between
 * requests — a table that reshuffles under a reader hides changes rather than showing them.
 */
export function aggCoverage(rows: readonly AggCoverageRow[]): WebAggCoverage[] {
  return rows
    .map((r) => ({
      symbol: r.symbol,
      market: r.market,
      tf: r.tf,
      held: r.held,
      derivable: r.derivable,
      unfetchable: r.unfetchable,
      oldestDerivable: r.oldestDerivableMs,
    }))
    .sort(
      (a, b) =>
        b.derivable - a.derivable ||
        a.symbol.localeCompare(b.symbol) ||
        a.market.localeCompare(b.market) ||
        a.tf.localeCompare(b.tf),
    );
}

/** The per-timeframe summary. `heldFloor` and `heldMax`, deliberately without a mean — see below. */
export interface AggTotals {
  tf: string;
  series: number;
  derivable: number;
  unfetchable: number;
  /**
   * The *worst* series' held count, not the average.
   *
   * On 2026-10-12 the mean held 1d bars across 60 series was 16.7 while BTCUSDT perp held 71, and
   * the mean was the figure that mis-sized a task for the one symbol under test. A mean over a
   * population whose members differ 5:1 describes none of them; the floor names the series that
   * will refuse first, which is the thing a reader needs.
   */
  heldFloor: number;
  /** Beside the floor, so the spread is visible rather than inferred. */
  heldMax: number;
}

export function aggTotals(rows: readonly WebAggCoverage[]): AggTotals[] {
  const byTf = new Map<string, WebAggCoverage[]>();
  for (const row of rows) {
    const bucket = byTf.get(row.tf);
    if (bucket) bucket.push(row);
    else byTf.set(row.tf, [row]);
  }

  return [...byTf.entries()]
    .map(([tf, group]) => ({
      tf,
      series: group.length,
      derivable: group.reduce((sum, r) => sum + r.derivable, 0),
      unfetchable: group.reduce((sum, r) => sum + r.unfetchable, 0),
      heldFloor: group.reduce((min, r) => Math.min(min, r.held), Number.POSITIVE_INFINITY),
      heldMax: group.reduce((max, r) => Math.max(max, r.held), 0),
    }))
    .map((t) => ({ ...t, heldFloor: Number.isFinite(t.heldFloor) ? t.heldFloor : 0 }))
    .sort((a, b) => b.derivable - a.derivable || a.tf.localeCompare(b.tf));
}
