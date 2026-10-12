/**
 * IB-027 — the move after a story, per tagged symbol (§10, `news_reactions`).
 *
 * Pure: the window arithmetic, the refusal rules and the confound count. The SQL that fetches
 * prices and coverage lives beside it; everything judgemental is here, with a spec.
 *
 * This table feeds the AI-1 calibration, so it is the point where a wrong number stops being local:
 * an attribution error becomes a correlation and a correlation becomes a feature. Every rule below
 * exists because of a specific way that happens.
 */

export const HORIZONS = ['15m', '1h', '4h'] as const;
export type Horizon = (typeof HORIZONS)[number];

export const HORIZON_MS: Record<Horizon, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

/**
 * Which instant the window starts from.
 *
 * `published` is the publisher's own claim and `first_seen` is when we fetched it. The default is
 * **`first_seen`**, because a window anchored on a self-reported timestamp can contain price action
 * from before the news was knowable — measuring what caused the publication rather than what the
 * publication caused. That is lookahead with a respectable timestamp on it.
 */
export type Anchor = 'published' | 'first_seen';

export type RefusalReason =
  | 'stale_at_ingest'
  | 'window_not_closed'
  | 'window_not_covered'
  | 'no_price_at_anchor'
  | 'no_price_at_horizon'
  | 'no_venue_spelling';

/**
 * How far the publisher's date may precede our first sight before a reaction is refused.
 *
 * **Seven days, and it is a judgement — stated, with the measurements that bracket it.** Measured
 * on the live pass of 2026-10-12:
 *
 *   news outlets (cointelegraph, coindesk, theblock, decrypt)   0.4 – 1.2 days
 *   exchange announcement feeds (bybit, okx)                    3.5 – 4.6 days
 *   dormant catalogs (binance API Updates, Crypto Airdrop)      109 – 388 days
 *
 * Seven days sits above the slowest legitimate lag observed, with margin, and roughly two orders of
 * magnitude below the dormant items. The gap is wide enough that the exact figure inside it barely
 * matters, which is the reason to pick a round one and say so rather than tune it.
 *
 * Why refuse at all: `binance-announcements` returns the newest ~20 items PER CATALOG, so dormant
 * catalogs keep delivering year-old announcements that are genuinely new *to us*. First-seen
 * anchoring would then measure today's price against a 2022 announcement and record it as a
 * reaction — a confidently wrong correlation, which is the one thing this table must not
 * manufacture. The article is still stored and still clustered; only the reaction refuses.
 */
export const STALE_AT_INGEST_SEC = 7 * 24 * 60 * 60;

export interface ReactionInput {
  horizon: Horizon;
  publishedAt: Date;
  firstSeenAt: Date;
  anchor?: Anchor;
  /** Close at or immediately before the anchor instant, in the venue's own series. */
  priceAtAnchor: number | null;
  /** Close at or immediately before anchor + horizon. */
  priceAtHorizon: number | null;
  /**
   * Whether `anchor + horizon` has actually elapsed.
   *
   * A window that has not closed does not fail — it **understates the magnitude and looks like a
   * real small reaction**, which is the incomplete-bucket defect in another costume. So an open
   * window refuses and is recomputed once it closes, rather than measured early and revised:
   * refusal beats a computed value, and the stored row cannot then be read as a closed window.
   */
  windowClosed: boolean;
  /**
   * Whether the whole window is inside collected time **for the venue and market this reaction is
   * measured on**. From IB-BUG-010's coverage: a gap produces a confidently wrong magnitude and is
   * invisible in the output unless the output says so.
   *
   * Per venue deliberately — a window covered on Bybit but not on OKX must not pass for an OKX
   * reaction. Global coverage over per-venue data is the «все биржи» error at one remove: true
   * about something, just not about the thing it is attached to.
   */
  windowCovered: boolean;
  /** The venue spelling actually resolved; null when the symbol has none for this venue. */
  symbolSpelling: string | null;
  /** Other tagged stories for this symbol whose anchor falls inside this window. */
  othersInWindow: number;
}

export interface Reaction {
  horizon: Horizon;
  anchor: Anchor;
  anchorAt: Date;
  /** How far the publisher's claim and our first sight are apart. Suspect when large. */
  anchorSkewSec: number;
  returnPct: number | null;
  refused: RefusalReason | null;
  othersInWindow: number;
  /** The {count, of} denominator: this story plus the others sharing its window. */
  ofWindowItems: number;
}

/** Seconds between the publisher's claim and our first sight. Negative means we saw it first. */
export function anchorSkewSec(publishedAt: Date, firstSeenAt: Date): number {
  return Math.round((firstSeenAt.getTime() - publishedAt.getTime()) / 1000);
}

/**
 * One reaction, or a stated refusal.
 *
 * **Never both and never neither**: a null return always carries a reason, and a reason never
 * accompanies a number. A refusal and a real zero are different claims — "the market did not move"
 * and "we cannot say" — and anything averaging them together would be measuring its own ignorance.
 * The schema enforces the same pairing with a CHECK constraint, so neither layer can drift alone.
 */
export function computeReaction(input: ReactionInput): Reaction {
  const anchor = input.anchor ?? 'first_seen';
  const anchorAt = anchor === 'published' ? input.publishedAt : input.firstSeenAt;
  const base = {
    horizon: input.horizon,
    anchor,
    anchorAt,
    anchorSkewSec: anchorSkewSec(input.publishedAt, input.firstSeenAt),
    othersInWindow: input.othersInWindow,
    ofWindowItems: input.othersInWindow + 1,
  };

  const refuse = (refused: RefusalReason): Reaction => ({ ...base, returnPct: null, refused });

  // order matters only for which reason is reported; the most fundamental absence wins, so a
  // missing spelling is not reported as a missing price
  // Before anything else: a story we first saw a week after it was published cannot have its
  // 15m–4h reaction measured, whatever else is true. Reporting a missing price or an open window
  // here would send a reader looking for a collection fault instead of an age problem.
  if (base.anchorSkewSec > STALE_AT_INGEST_SEC) return refuse('stale_at_ingest');
  if (input.symbolSpelling === null) return refuse('no_venue_spelling');
  // before coverage and before prices: an open window has no horizon price yet, and reporting that
  // as `no_price_at_horizon` would send someone looking for a collection fault that is not there
  if (!input.windowClosed) return refuse('window_not_closed');
  if (!input.windowCovered) return refuse('window_not_covered');
  if (input.priceAtAnchor === null || input.priceAtAnchor === 0) return refuse('no_price_at_anchor');
  if (input.priceAtHorizon === null) return refuse('no_price_at_horizon');

  return {
    ...base,
    returnPct: ((input.priceAtHorizon - input.priceAtAnchor) / input.priceAtAnchor) * 100,
    refused: null,
  };
}

/** The window a reaction measures over, for the coverage check and the confound count. */
export function reactionWindow(anchorAt: Date, horizon: Horizon): { from: Date; to: Date } {
  return { from: anchorAt, to: new Date(anchorAt.getTime() + HORIZON_MS[horizon]) };
}
