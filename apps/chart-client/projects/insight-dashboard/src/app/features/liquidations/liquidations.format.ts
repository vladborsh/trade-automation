import type {
  WebLiquidationNormBasis, WebLiquidationSideStats, WebLiquidationWindowStats,
} from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-038 — the pure part of the liquidation surfaces (§12.1–§12.4).
 *
 * Every function here returns **numbers and string KEYS, never prose**: §11 puts each sentence in
 * the string tables, and a helper returning a sentence would be a literal in disguise.
 *
 * The rules worth stating, because they are the ones that keep a card from overclaiming:
 *
 * - **An absent ratio is never rendered as a number, a dash of calm, or a zero.** It renders as
 *   a short reason, because "we have no norm" is not evidence that nothing is happening.
 * - **The «× от нормы» basis names COVERAGE, not elapsed time** (Tech Lead, 2026-10-07): the ws
 *   liquidation collectors write no uptime rows (IB-BUG-010), so "за 9 дней" claims observation
 *   we cannot prove, while "9 of 226 windows" claims only what is in the table.
 * - **A missing venue is always said out loud**, on the card and on the table both, so Bybit and
 *   OKX are never passed off as the whole market.
 */

/** USD at a glance: `$1.2M`, `$847K`, `$0`. Compact because a card is read, not audited. */
export function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);
  if (n >= 1e9) return `${sign}$${trim(n / 1e9)}B`;
  if (n >= 1e6) return `${sign}$${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${sign}$${trim(n / 1e3)}K`;
  return `${sign}$${Math.round(n)}`;
}

function trim(n: number): string {
  // one decimal below 10 ($1.2M), none above ($847K) — more digits than that is false precision
  return n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n));
}

/** `×2.4`, or null when there is no ratio. Null is the caller's cue to show the reason instead. */
export function formatRatio(ratio: number | null): string | null {
  if (ratio === null) return null;
  return `×${ratio < 10 ? ratio.toFixed(1).replace(/\.0$/, '') : String(Math.round(ratio))}`;
}

/** §12.1's three steps. `none` for an absent ratio — explicitly not `calm`. */
export type Escalation = 'none' | 'calm' | 'elevated' | 'extreme';

export function escalation(ratio: number | null): Escalation {
  if (ratio === null) return 'none';
  if (ratio < 1.5) return 'calm';
  if (ratio < 3) return 'elevated';
  return 'extreme';
}

/** Which way the flow leans, as a key suffix. `quiet` when nothing happened at all. */
export function leaning(stats: WebLiquidationWindowStats): 'longs' | 'shorts' | 'quiet' {
  const { long, short } = stats;
  if (long.usd + short.usd === 0) return 'quiet';
  return long.usd >= short.usd ? 'longs' : 'shorts';
}

/** The share of the bar each side takes, 0–100. An empty window splits evenly rather than 0/0. */
export function sideShare(stats: WebLiquidationWindowStats): { long: number; short: number } {
  const total = stats.long.usd + stats.short.usd;
  if (total === 0) return { long: 50, short: 50 };
  const long = (stats.long.usd / total) * 100;
  return { long, short: 100 - long };
}

export interface BasisLine {
  key: StringKey;
  params: Record<string, string | number>;
}

/**
 * What the «× от нормы» figure is measured against, or why there is none.
 *
 * The basis is shown whether or not there is a ratio: a reader who sees a multiple needs the
 * sample it came from, and a reader who sees none needs to know which of the two reasons applies
 * — too little history is temporary, an all-but-empty tape is not.
 */
export function basisLine(basis: WebLiquidationNormBasis, window: string): BasisLine {
  if (basis.unavailable === 'insufficient_history') {
    return { key: 'liq.norm.noHistory', params: {} };
  }
  if (basis.unavailable === 'no_norm') {
    return {
      key: 'liq.norm.noNorm',
      params: { observed: basis.windowsObserved, total: basis.windowsInPeriod, window },
    };
  }
  return {
    key: 'liq.norm.basis',
    params: { observed: basis.windowsObserved, total: basis.windowsInPeriod, window },
  };
}

/**
 * Whether a side's figure may be shown as a multiple at all.
 *
 * Separate from `formatRatio` on purpose: a template that asks "is there a ratio" and a template
 * that asks "how do I print it" are two questions, and conflating them is how a `null` became
 * the string "null" on a page once before.
 */
export function hasRatio(side: WebLiquidationSideStats): boolean {
  return side.ratio !== null;
}
