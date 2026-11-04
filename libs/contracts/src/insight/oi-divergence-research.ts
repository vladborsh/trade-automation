import { z } from 'zod';

/**
 * IB-115 — the OI divergence research journal (architecture/oi-divergence-design-2026-11-04.md §8,
 * V23–V29): the vocabulary migration 027's tables, the alert loop and the path measurer share.
 *
 * **No wire shape here, on purpose.** No page and no text reads these tables, and nothing computes a
 * hit rate from them (§6, V29): until "worked" and its baseline are decided, the rows are read with SQL.
 * A schema for a response would be the first step towards a page nobody has approved.
 */

/** V24: the windows a price path is measured over, from `t0`. */
export const OI_RESEARCH_WINDOWS = ['4h', '24h', '72h'] as const;
export const OiResearchWindowSchema = z.enum(OI_RESEARCH_WINDOWS);
export type OiResearchWindow = z.infer<typeof OiResearchWindowSchema>;
export const OI_RESEARCH_WINDOW_SEC: Record<OiResearchWindow, number> = { '4h': 14_400, '24h': 86_400, '72h': 259_200 };

/** V24: what a path row measures — a journal row, a control, or a near-miss. */
export const OI_RESEARCH_SUBJECTS = ['alert', 'control', 'near_miss'] as const;
export const OiResearchSubjectSchema = z.enum(OI_RESEARCH_SUBJECTS);
export type OiResearchSubject = z.infer<typeof OiResearchSubjectSchema>;

/** V25: every confirmed price pivot that produced no alert, and hash-chosen bar closes. */
export const OI_CONTROL_KINDS = ['pivot', 'random'] as const;
export const OiControlKindSchema = z.enum(OI_CONTROL_KINDS);
export type OiControlKind = z.infer<typeof OiControlKindSchema>;
/** V25: random controls per coin, TF and UTC day. */
export const OI_RANDOM_CONTROLS_PER_DAY = 2;

/** V24: the favourable thresholds, in ATR14 of the subject's TF: `fav_05_at`, `fav_1_at`, `fav_2_at`. */
export const OI_FAV_ATR_MULTS = [0.5, 1, 2] as const;

/**
 * V26: the one condition a near-miss failed, and the unit its `miss` is counted in.
 * - `price_delta` / `oi_delta`: the shortfall ÷ the threshold (δp, δoi), in [0, 1);
 * - `price_line`: the wick's excess beyond the tolerance, in ATR14; `oi_line`: in |ΔOI| medians;
 * - `k`: bars beyond k to the nearest OI pivot; `w`: bars beyond W from A to B.
 */
export const OI_NEAR_MISS_RULES = ['price_delta', 'oi_delta', 'price_line', 'oi_line', 'k', 'w'] as const;
export const OiNearMissRuleSchema = z.enum(OI_NEAR_MISS_RULES);
export type OiNearMissRule = z.infer<typeof OiNearMissRuleSchema>;
export const OI_NEAR_MISS_UNITS = ['threshold', 'atr14', 'oi_median', 'bars'] as const;
export type OiNearMissUnit = (typeof OI_NEAR_MISS_UNITS)[number];
export const OI_NEAR_MISS_UNIT: Record<OiNearMissRule, OiNearMissUnit> = {
  price_delta: 'threshold', oi_delta: 'threshold', price_line: 'atr14', oi_line: 'oi_median', k: 'bars', w: 'bars',
};

/**
 * V27: the build in every journal, control and near-miss row — the image's commit, 12 characters.
 * A slot without `BUILD_SHA` writes `dev`; the journal rows from before migration 027 read `pre-027`.
 */
export const OI_BUILD_DEV = 'dev';
export const OI_BUILD_PRE_027 = 'pre-027';
export const OiBuildSchema = z.string().regex(/^([0-9a-f]{12}|dev|pre-027)$/);
