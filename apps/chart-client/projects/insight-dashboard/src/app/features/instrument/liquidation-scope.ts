import type { StringKey } from '../../i18n/keys';

/**
 * IB-039 — what the liquidation surfaces are coloured by and what they are allowed to claim.
 *
 * Lifted out of `liquidation-histogram.renderer.ts`, which IB-039 deleted along with the
 * liquidations panel it drew (§12.5 replaces that column with markers on the price chart). The
 * two things worth keeping from it were the colour rule and the label rule, and neither needs a
 * chart.
 */

/** The dark-terminal palette (AGENTS.md), not a near-duplicate of it. */
export const LIQUIDATION_COLORS = {
  /**
   * Longs liquidated — price fell, so this is the DOWN colour. The colour follows what the
   * market did, not the noun: a reader scanning for red is scanning for falling (IB-031).
   */
  long: '#ef5350',
  /** Shorts liquidated — price rose. */
  short: '#26a69a',
} as const;

export type Translate = (key: StringKey, params?: Record<string, string | number>) => string;

/**
 * The label over a liquidation surface: which venues it is built from, and the Binance caveat.
 *
 * **Driven by `venuesPresent` — the venues the DATA came from — never by the filter the page
 * sent.** That is the Tech Lead's requirement on IB-039 and the direct lesson of IB-BUG-011,
 * where a pane queried one venue's rows and labelled them «все биржи»: the parameter said all,
 * the data was one, and the label believed the parameter.
 *
 * An empty list is its own case. "No venues contributed" is «нет данных», not «все биржи» — the
 * old helper could not express that, because a filter always has a value even when the result
 * does not.
 *
 * **`total24h` exists because the summary card is below the fold** and the Tech Lead ruled
 * (2026-10-12) that the row keeps its full height — shrinking the five panels to rescue a card
 * would degrade the layout the user actually asked for to fix one they never mentioned. So this
 * line, which IS above the fold, carries the window's total and says the detail is below: a
 * reader then knows the number exists and roughly how big it is, and scrolls on purpose rather
 * than by luck.
 */
export function liquidationScopeLabel(
  t: Translate,
  venuesPresent: readonly string[],
  undercounted: boolean,
  total24h?: string | null,
): string {
  if (venuesPresent.length === 0) return t('instrument.liq.noVenues');
  // venue names are codes: English in both languages, per §11
  const venues = [...venuesPresent].sort().join(', ');
  const key: StringKey = undercounted
    ? 'instrument.liq.scopeUndercounted'
    : 'instrument.liq.scope';
  const scope = t(key, { venues });
  // Composed from two COMPLETE clauses joined by a separator, not assembled from fragments:
  // each half reads on its own in both tables, which is the only kind of concatenation §11
  // tolerates (the same shape as `panelHeading`).
  return total24h ? `${scope} · ${t('instrument.liq.total24h', { total: total24h })}` : scope;
}
