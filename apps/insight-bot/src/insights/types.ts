import type {
  WebFlowsResponse, WebInsightBasis, WebInsightBlock, WebInsightStatement, WebLiquidationLargeEvent, WebMarketPeriod, WebPositioningRow,
} from '@trade-automation/contracts';

/**
 * IB-086 (market-page design D1) — the insight engine's types. Pure: a rule is a function of a
 * snapshot, so the same rules can feed the page now and Telegram alerts later (this module is
 * deliberately outside `web/`).
 */

/** Everything the rules read, already fetched. A missing part is null, never an empty stand-in. */
export interface InsightSnapshot {
  period: WebMarketPeriod;
  nowMs: number;
  liquidations: {
    long: { usd: number; sample: number[] };
    short: { usd: number; sample: number[] };
    /** Days behind the period sample (0 for 7d, D14). */
    days: number;
    hourly: number[];
    hourlyDays: number;
    venues: string[];
    fromMs: number | null;
    /** Per crypto coin: the period's USD and its own sample. */
    coins: Map<string, { usd: number; sample: number[]; days: number }>;
    /** The block's large events, with their series (IB-084). */
    large: WebLiquidationLargeEvent[];
  } | null;
  positioning: WebPositioningRow[] | null;
  breadth: {
    upShare: number; altGapPct: number; upShareSample: number[]; altGapSample: number[]; days: number; coins: number;
  } | null;
  /** Fear & Greed now (0–100), for R7's wording. */
  fng: number | null;
  /** IB-091: «Деривативы и потоки» (DVOL, stablecoins, Coinbase premium) for R8–R10. */
  flows: WebFlowsResponse | null;
}

/** A rule that could not judge: its basis is too thin, or its data is absent. */
export interface Refusal {
  /** `insufficient_minutes` (D18): R10's premium had fewer valid minutes than it needs to call a sign. */
  refused: 'insufficient_history' | 'insufficient_minutes' | 'no_data';
  basis: WebInsightBasis | null;
}

export interface Rule {
  id: WebInsightStatement['ruleId'];
  block: WebInsightBlock;
  /** A statement (any rarity — the engine gates), a refusal, or null (ran, found nothing to say). */
  run(s: InsightSnapshot): WebInsightStatement | Refusal | null;
}

export const isRefusal = (x: WebInsightStatement | Refusal | null): x is Refusal => x !== null && 'refused' in x;
