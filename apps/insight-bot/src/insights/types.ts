import type {
  WebFlowsResponse, WebInsightBasis, WebOiDivergenceAlert, WebInsightBlock, WebInsightSource, WebInsightStatement, WebLiquidationLargeEvent, WebMarketPeriod, WebPositioningRow,
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
    /**
     * IB-107: the period's bars of the overview's mirrored chart, oldest first — the same call the
     * port already makes. R1's chart (IB-119) draws them.
     */
    bars: { time: number; long: number; short: number }[];
  } | null;
  positioning: WebPositioningRow[] | null;
  /**
   * IB-135: coin → funding settlement interval (h), from the positioning baselines' settled times. R5
   * normalises each rate to 8 h with it. A coin that is absent counts as 8 h, and so does everything
   * when the whole part is null. That can only make a coin look smaller (`funding-extreme.ts`).
   */
  fundingIntervalH: Map<string, number> | null;
  /**
   * IB-113 (OI divergence design V16): the newest on-time OI divergence alert of the last 24 h on a
   * listed coin, from the journal (our DB, no venue). Null: none. Its chart (IB-119) reads its own window.
   */
  oiDivergence: { alert: WebOiDivergenceAlert } | null;
  breadth: {
    upShare: number; altGapPct: number; upShareSample: number[]; altGapSample: number[]; days: number; coins: number;
    /** IB-119: when the hour "now" stands for ended (s): R7's chart stamps its hourly points back from it. */
    lastHourEnd: number;
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
  /** IB-BUG-028: where it reads from — named on the block line when none of the block's rules could look. */
  sources: readonly WebInsightSource[];
  /** A statement (any rarity — the engine gates), a refusal, or null (ran, found nothing to say). */
  run(s: InsightSnapshot): WebInsightStatement | Refusal | null;
}

export const isRefusal = (x: WebInsightStatement | Refusal | null): x is Refusal => x !== null && 'refused' in x;
