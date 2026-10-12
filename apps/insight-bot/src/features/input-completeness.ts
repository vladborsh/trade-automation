import type { WebFeatureUnavailable } from '@trade-automation/contracts';

/**
 * IB-015 — is an input group reliably complete for this window, and if not, will it ever be?
 *
 * Two questions, not one, and conflating them is the defect this module exists to prevent.
 *
 * `candles_agg` answers the first with its own `complete` flag. `candles_1m` has none — §8.2
 * computes CVD straight from it — so a window's completeness there is a count: `hours × 60`
 * minutes expected. That check is what makes "a re-check may only turn not-computable into a
 * value" true by construction: without it CVD publishes a number at +15 s and a late 1m row
 * moves it at +60 s, which §8.1 calls the NORMAL case in degraded mode.
 *
 * **The second question is the Tech Lead's condition of 2026-10-12.** A minute can be missing
 * because nobody has collected it *yet*, or because **the venue never produced it** — a halt, a
 * maintenance window, or a timestamp before the symbol listed. The first heals; the second never
 * will. If they look the same, the key refuses for ever behind an unhealed-gap counter that
 * never drains, and an alarm that cannot be cleared stops being read.
 *
 * So a shortfall that is EVIDENCED resolves to `explained_absence` — permanent, expected, and
 * explicitly not counted as an unhealed gap.
 */

export interface WindowShortfall {
  /** The input group, e.g. `candles1m:perp` or `agg:15m`. */
  group: string;
  /**
   * The keys this shortfall actually affects — IB-047.
   *
   * A shortfall belongs to a (group, WINDOW) pair, not to a group. `px.close` needs one bar of
   * `agg:15m` and `px.ret_24h` needs ninety-six; judging both against ninety-six made the first
   * refuse whenever the second was short, and 422 of 477 `px.*` refusals were that artefact.
   */
  keys: readonly string[];
  expected: number;
  present: number;
  /** For the frame's `incompleteReason`: "candles_1m perp 12:00–16:00, 238 of 240". */
  detail: string;
}

export interface AbsenceEvidence {
  /**
   * Minutes inside the window already recorded as not collected — a `collector_gaps` row. The
   * data is gone and is counted ONCE, there; counting it again per frame would double-count a
   * known problem and keep an alarm lit that nobody can clear.
   */
  recordedGapMinutes: number;
  /**
   * Minutes the venue never produced: before the symbol's listing date, or inside a halt. These
   * are not a defect at all.
   */
  notTradedMinutes: number;
}

export const NO_EVIDENCE: AbsenceEvidence = { recordedGapMinutes: 0, notTradedMinutes: 0 };

/**
 * Why a shortfall refuses — and therefore whether anyone should chase it.
 *
 * `incomplete_input` is the only outcome that says "somebody can still fix this": it is the
 * unhealed-gap case, and it is the one that is counted once the heal window has closed.
 */
export function reasonForShortfall(
  shortfall: WindowShortfall,
  evidence: AbsenceEvidence = NO_EVIDENCE,
): WebFeatureUnavailable {
  const missing = shortfall.expected - shortfall.present;
  if (missing <= 0) throw new Error(`reasonForShortfall called for a complete window: ${shortfall.detail}`);

  const explained = evidence.recordedGapMinutes + evidence.notTradedMinutes;
  // Fully explained: every missing minute is accounted for by something that will not change.
  if (explained >= missing) return 'explained_absence';

  // Partly explained is still unexplained: some minutes are unaccounted for and a heal could
  // still deliver them. Rounding a partial explanation up to "explained" would hide exactly the
  // shortfall worth chasing.
  return 'incomplete_input';
}

/** The KEYS that are short, with the reason each refuses for (IB-047). */
export function assessWindows(
  shortfalls: readonly WindowShortfall[],
  evidenceByGroup: Readonly<Record<string, AbsenceEvidence>> = {},
): { incompleteKeys: Set<string>; explainedKeys: Set<string>; reasons: string[] } {
  const incompleteKeys = new Set<string>();
  const explainedKeys = new Set<string>();
  const reasons: string[] = [];

  for (const shortfall of shortfalls) {
    const reason = reasonForShortfall(shortfall, evidenceByGroup[shortfall.group] ?? NO_EVIDENCE);
    // Per KEY, not per group (IB-047). A key is blocked by a shortfall only when that shortfall's
    // window is one the key actually reads.
    const target = reason === 'explained_absence' ? explainedKeys : incompleteKeys;
    for (const key of shortfall.keys) target.add(key);
    reasons.push(reason === 'explained_absence' ? `${shortfall.detail} (absence evidenced)` : shortfall.detail);
  }
  return { incompleteKeys, explainedKeys, reasons };
}

/** Minutes a window of whole hours expects — the `candles_1m` completeness check. */
export function expectedMinutes(hours: number): number {
  return hours * 60;
}

/**
 * When the re-check window closes: nothing can change the answer after derive's heal pass stops
 * reaching back this far.
 *
 * **Imported, not copied.** Two thresholds that mean the same thing drift, and shortening the
 * heal lookback must move this with it — otherwise frames start being declared permanently
 * refused sooner than anything stopped trying to heal them.
 */
export { HEAL_LOOKBACK_MS } from '../derive/derive.service';
