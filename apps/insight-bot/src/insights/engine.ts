import {
  WEB_INSIGHT_BLOCKS, type WebInsightBlock, type WebInsightBlockLine, type WebInsightStatement, type WebInsightsResponse,
} from '@trade-automation/contracts';
import { INSIGHTS_TOP_N, RARITY_SHOW } from './thresholds';
import { isRefusal, type InsightSnapshot, type Refusal, type Rule } from './types';

/**
 * IB-086 (D1, D2, D15) — run every rule, keep what passes (rarity ≥ 0.90; a rule has already
 * refused a thin basis), rank by rarity then |magnitude|, return the top 5; and one line per block:
 * its best passing statement, else a neutral line with the reason —
 * `insufficient_history` when every rule of the block refused for history (the box's first week for
 * liquidations), `no_rules` for a block with no rule yet, else `nothing_unusual`.
 */
export function runInsights(rules: readonly Rule[], s: InsightSnapshot): Omit<WebInsightsResponse, 'asOf'> {
  const results = rules.map((rule) => ({ rule, out: safe(rule, s) }));
  const passing = results
    .map((x) => x.out)
    .filter((o): o is WebInsightStatement => o !== null && !isRefusal(o) && o.rarity >= RARITY_SHOW)
    .sort(rank);

  const blocks: WebInsightBlockLine[] = WEB_INSIGHT_BLOCKS.map((block) => {
    const best = passing.find((st) => st.block === block);
    if (best) return { block, statement: best, neutral: null };
    const own = results.filter((x) => x.rule.block === block);
    if (own.length === 0) return { block, statement: null, neutral: { key: 'insight.neutral', reason: 'no_rules', basis: null } };
    const refusals = own.map((x) => x.out).filter((o): o is Refusal => isRefusal(o));
    const allHistory = refusals.length === own.length && refusals.some((r) => r.refused === 'insufficient_history');
    const ran = own.map((x) => x.out).find((o): o is WebInsightStatement => o !== null && !isRefusal(o));
    return {
      block,
      statement: null,
      neutral: {
        key: 'insight.neutral',
        reason: allHistory ? 'insufficient_history' : 'nothing_unusual',
        basis: ran?.basis ?? refusals.find((r) => r.basis !== null)?.basis ?? null,
      },
    };
  });
  return { period: s.period, top: passing.slice(0, INSIGHTS_TOP_N), blocks };
}

/** Rarity first, then the size of the thing — the D2 order. */
export function rank(a: WebInsightStatement, b: WebInsightStatement): number {
  return b.rarity - a.rarity || Math.abs(b.magnitude) - Math.abs(a.magnitude);
}

/** A rule that throws is a bug in one rule, not a page outage: it counts as having said nothing. */
function safe(rule: Rule, s: InsightSnapshot): WebInsightStatement | Refusal | null {
  try {
    return rule.run(s);
  } catch {
    return null;
  }
}

export type { WebInsightBlock };
