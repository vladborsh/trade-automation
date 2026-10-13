/**
 * IB-056 — the aggregate-coverage block's pure half: `WebAggCoverage[]` in, table rows out.
 *
 * Beside the component with its own spec, per AGENTS.md: anything that can be a pure function does
 * not live in a component.
 *
 * The block answers one question — **is a shortfall a pass we have not run, or data we do not
 * have?** Everywhere else in the system both read as `insufficient_history`, and they call for
 * opposite responses.
 */
import type { WebAggCoverage } from '@trade-automation/contracts';

/**
 * `derivable` leads because it is the only column anyone acts on; `unfetchable` is visible but
 * never an alarm, because no action clears it. Same reasoning as the frame block's `explainedOnly`.
 */
export type AggState = 'derivable' | 'unfetchable' | 'ok';

export interface AggView extends WebAggCoverage {
  /** `ETHUSDT perp` — the series, spelled with its market, never collapsed to the symbol. */
  seriesLabel: string;
  /** ISO minute of the oldest derivable bucket, or `—`. */
  oldestDerivableLabel: string;
  state: AggState;
}

const RANK: Readonly<Record<AggState, number>> = { derivable: 0, unfetchable: 1, ok: 2 };

function state(row: WebAggCoverage): AggState {
  if (row.derivable > 0) return 'derivable';
  if (row.unfetchable > 0) return 'unfetchable';
  return 'ok';
}

export function toAggViews(rows: readonly WebAggCoverage[]): AggView[] {
  return rows
    .map((row) => ({
      ...row,
      seriesLabel: `${row.symbol} ${row.market}`,
      oldestDerivableLabel:
        row.oldestDerivable === null
          ? '—'
          : new Date(row.oldestDerivable).toISOString().slice(0, 16).replace('T', ' '),
      state: state(row),
    }))
    .sort(
      (a, b) =>
        RANK[a.state] - RANK[b.state] ||
        b.derivable - a.derivable ||
        a.symbol.localeCompare(b.symbol) ||
        a.market.localeCompare(b.market) ||
        a.tf.localeCompare(b.tf),
    );
}

/**
 * How many rows the page shows. Every series × timeframe is 240 rows on the current universe, and
 * a 240-row table is not read — it is scrolled past, which makes it latent in the same way a CLI
 * nobody runs is latent. The rows worth a reader's attention are the ones with something to act
 * on; the CLI prints the rest.
 */
export const AGG_ROW_LIMIT = 20;

/** The actionable rows, worst first, capped. `ok` rows are omitted: there is nothing to do. */
export function visibleAggRows(views: readonly AggView[], limit: number = AGG_ROW_LIMIT): AggView[] {
  return views.filter((v) => v.state !== 'ok').slice(0, limit);
}

/** How many rows the table is not showing, so the page can say so rather than imply it has them all. */
export function hiddenAggCount(views: readonly AggView[], limit: number = AGG_ROW_LIMIT): number {
  return views.length - visibleAggRows(views, limit).length;
}

export interface AggTotals {
  series: number;
  derivable: number;
  unfetchable: number;
  /** How many `(symbol, market, tf)` series carry a derivable gap — the breadth beside the depth. */
  seriesWithGap: number;
  /** ms UTC of the oldest derivable bucket anywhere, or null. */
  oldestDerivable: number | null;
}

export function aggTotals(rows: readonly WebAggCoverage[]): AggTotals {
  return rows.reduce<AggTotals>(
    (acc, row) => ({
      series: acc.series + 1,
      derivable: acc.derivable + row.derivable,
      unfetchable: acc.unfetchable + row.unfetchable,
      seriesWithGap: acc.seriesWithGap + (row.derivable > 0 ? 1 : 0),
      oldestDerivable:
        row.oldestDerivable === null
          ? acc.oldestDerivable
          : acc.oldestDerivable === null
            ? row.oldestDerivable
            : Math.min(acc.oldestDerivable, row.oldestDerivable),
    }),
    { series: 0, derivable: 0, unfetchable: 0, seriesWithGap: 0, oldestDerivable: null },
  );
}

/**
 * The worst series per timeframe, which is what the summary row shows instead of a mean.
 *
 * A mean over these series is actively misleading: on 2026-10-12 the mean held 1d bars was 16.7
 * while BTCUSDT held 71, and a reader who saw 16.7 would mis-size the work for the only symbol
 * being tested. The floor names the series that refuses first.
 */
export function heldFloorByTf(rows: readonly WebAggCoverage[]): Array<{ tf: string; heldFloor: number; heldMax: number }> {
  const byTf = new Map<string, { heldFloor: number; heldMax: number }>();
  for (const row of rows) {
    const seen = byTf.get(row.tf);
    if (seen) {
      seen.heldFloor = Math.min(seen.heldFloor, row.held);
      seen.heldMax = Math.max(seen.heldMax, row.held);
    } else {
      byTf.set(row.tf, { heldFloor: row.held, heldMax: row.held });
    }
  }
  return [...byTf.entries()]
    .map(([tf, v]) => ({ tf, ...v }))
    .sort((a, b) => a.tf.localeCompare(b.tf));
}
