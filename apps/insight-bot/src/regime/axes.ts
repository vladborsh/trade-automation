import type { WebFeatureUnavailable, WebFeatureValue } from '@trade-automation/contracts';
import { REGIME_SPEC } from './regime-spec';

/**
 * IB-016 — the regime axes (design §8.3, D9), pure.
 *
 * ================== THE RULE THAT RUNS THROUGH ALL OF THEM ==================
 *
 * **An axis computed from a refused key refuses, carrying that key's reason.** It never falls back
 * to the middle band. `RANGE`, `NORMAL` and `NEUTRAL` are measurements — "I looked, and the market
 * is between the bands" — and using one of them for "I could not look" puts a shrug and a finding
 * behind the same word. Everything downstream then treats an unmeasured market as an ordinary one.
 * IB-015's `WebFeatureValue` makes that unrepresentable one level down; this keeps it
 * unrepresentable one level up.
 *
 * The vocabulary is IB-015's `WebFeatureUnavailable` rather than a regime-specific set: a reader
 * who has learned what `insufficient_history` means on a key should not have to learn a second
 * word for the same fact on an axis.
 *
 * **Every input is a frame key.** Regime computes nothing from bars (Tech Lead ruling): the frame
 * is where computed inputs live, and a second path reading `candles_agg` would re-implement the
 * completeness and refusal logic IB-015 owns.
 */

export type RegimeTrend = 'UP' | 'DOWN' | 'RANGE';
export type RegimeVol = 'LOW' | 'NORMAL' | 'HIGH';
export type RegimeLeverage = 'LEVERED' | 'NEUTRAL' | 'DELEVERED';
export type RegimeCrowdedSide = 'LONGS' | 'SHORTS' | 'BALANCED';
export type RegimeEventWindow = 'CLEAR' | 'EVENT_RISK';

/** A measurement or a stated refusal — the same discriminated shape as `WebFeatureValue`. */
export type RegimeAxisValue<T> = { ok: true; value: T } | { ok: false; why: WebFeatureUnavailable };

const ok = <T>(value: T): RegimeAxisValue<T> => ({ ok: true, value });
const refuse = <T>(why: WebFeatureUnavailable): RegimeAxisValue<T> => ({ ok: false, why });

/**
 * The percentile definition is **injected, not restated**.
 *
 * IB-015 owns it (`features/math/rolling.ts#percentileOf`: rank-based, ties counted at-or-below,
 * `null` under `minPeriods`). A second copy here would put two definitions of the word
 * "percentile" in one repository — BUG-024's third ATR, before it happens — and they would agree
 * right up until someone fixed one of them.
 */
export type PercentileRank = (sample: readonly number[], value: number, minPeriods: number) => number | null;

/** A refusal passes straight through; a value is handed on as a number. */
function numberOf(value: WebFeatureValue): { ok: true; n: number } | { ok: false; why: WebFeatureUnavailable } {
  if (!value.ok) return { ok: false, why: value.why };
  if (typeof value.value !== 'number') {
    // A key declared `number` in the registry arriving as something else is a contract violation,
    // not a market condition — and no amount of waiting changes it.
    return { ok: false, why: 'not_applicable' };
  }
  return { ok: true, n: value.value };
}

/**
 * `trend` — UP / DOWN / RANGE.
 *
 * §8.3: the EMA50 slope on 4h, and price against the EMA200 on 1d. Both must agree; anything else
 * is RANGE, which is a finding ("the two disagree") rather than a default.
 *
 * All three inputs are frame keys: `ema.4h.50` now and at the frame `slopeBars` back, `ema.1d.200`
 * now, and the close. **`ema.1d.200` needs `length + warmupBars` daily bars** — the registry's
 * figure, not one restated here, because IB-052 moved it from 200 to 300 and the formula survives
 * that while a number does not. Until that many daily bars exist the axis refuses with the key's
 * own `insufficient_history`, which is the archive backfill's prerequisite rather than a wait.
 *
 * The refusal is the axis working: a trend label computed from a shorter EMA would be a different
 * statement wearing this one's name.
 */
export function trendAxis(input: {
  /** `ema.4h.50` at this frame. */
  fastNow: WebFeatureValue;
  /** `ema.4h.50` as it was `slopeBars` frames ago, from the stored frame of that bar. */
  fastThen: WebFeatureValue | null;
  /** `ema.1d.200` at this frame. */
  slow: WebFeatureValue;
  /** The frame's close. */
  price: WebFeatureValue;
}): RegimeAxisValue<RegimeTrend> {
  const { slopeMinimum } = REGIME_SPEC.trend.params;
  // A frame that far back may simply not exist yet — which is short history, not a broken input.
  if (input.fastThen === null) return refuse('insufficient_history');

  const now = numberOf(input.fastNow);
  if (!now.ok) return refuse(now.why);
  const then = numberOf(input.fastThen);
  if (!then.ok) return refuse(then.why);
  const slow = numberOf(input.slow);
  if (!slow.ok) return refuse(slow.why);
  const price = numberOf(input.price);
  if (!price.ok) return refuse(price.why);

  const slope = now.n - then.n;
  const above = price.n > slow.n;
  // The sign decides; `slopeMinimum` is 0 because §8.3 states no magnitude. If the measured flip
  // rate ever justifies a deadband it changes in the registry, not here.
  if (slope > slopeMinimum && above) return ok<RegimeTrend>('UP');
  if (slope < -slopeMinimum && !above) return ok<RegimeTrend>('DOWN');
  return ok<RegimeTrend>('RANGE');
}

/**
 * `vol` — LOW / NORMAL / HIGH from the `atr.4h.14` percentile over 90 days.
 *
 * `atr` arrives as the frame holds it, refusal included: when ATR could not be computed,
 * volatility is not NORMAL, it is unknown.
 */
export function volAxis(
  atr: WebFeatureValue,
  history: readonly number[],
  percentileRank: PercentileRank,
): RegimeAxisValue<RegimeVol> {
  const { lowBand, highBand, minPeriods } = REGIME_SPEC.vol.params;
  const current = numberOf(atr);
  if (!current.ok) return refuse(current.why);

  const pct = percentileRank(history, current.n, minPeriods);
  if (pct === null) return refuse('insufficient_history');
  // §8.3 writes the middle band closed on both sides: "< 30 / 30–80 / > 80".
  if (pct < lowBand) return ok<RegimeVol>('LOW');
  if (pct > highBand) return ok<RegimeVol>('HIGH');
  return ok<RegimeVol>('NORMAL');
}

/**
 * `leverage` — LEVERED / NEUTRAL / DELEVERED from the OI percentile **alone**.
 *
 * Directionless by ruling (2026-10-12). High open interest is leverage in the system whichever way
 * the crowd leans: a crowded short book cascades upward exactly as a crowded long book cascades
 * down, and P3 is a post-cascade reversal playbook that cares about both. Which side is crowded is
 * `crowdedSideAxis` — two facts, two fields, because a label whose meaning depends on an unstated
 * combination is how «все биржи» and `0 из 0` happened.
 */
export function leverageAxis(
  oi: WebFeatureValue,
  oiHistory: readonly number[],
  percentileRank: PercentileRank,
): RegimeAxisValue<RegimeLeverage> {
  const { lowBand, highBand, minPeriods } = REGIME_SPEC.leverage.params;
  const current = numberOf(oi);
  if (!current.ok) return refuse(current.why);

  const pct = percentileRank(oiHistory, current.n, minPeriods);
  if (pct === null) return refuse('insufficient_history');
  if (pct >= highBand) return ok<RegimeLeverage>('LEVERED');
  if (pct <= lowBand) return ok<RegimeLeverage>('DELEVERED');
  return ok<RegimeLeverage>('NEUTRAL');
}

/**
 * `crowded_side` — LONGS / SHORTS / BALANCED from the sign of the mean settled funding.
 *
 * `rates` are the settled rates inside the window, across the venues that reported. Fewer than
 * `minSettlements` is not a three-day mean and refuses rather than claiming a sign.
 *
 * `BALANCED` is for a mean of exactly zero, which is a measurement — not the bucket for "we could
 * not tell", which is a refusal.
 */
export function crowdedSideAxis(rates: readonly number[]): RegimeAxisValue<RegimeCrowdedSide> {
  const { minSettlements } = REGIME_SPEC.crowdedSide.params;
  if (rates.length < minSettlements) return refuse('insufficient_history');

  const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  if (!Number.isFinite(mean)) return refuse('no_data');
  if (mean > 0) return ok<RegimeCrowdedSide>('LONGS');
  if (mean < 0) return ok<RegimeCrowdedSide>('SHORTS');
  return ok<RegimeCrowdedSide>('BALANCED');
}

/** One calendar row, reduced to what the axis reads. */
export interface RegimeCalendarEvent {
  /** Epoch seconds, UTC. */
  timeSec: number;
  impact: string | null;
  currency: string | null;
}

/**
 * `event_window` — CLEAR / EVENT_RISK, inside ±60 min of a high-impact USD event (§9.4).
 *
 * **`calendarLoaded` is not a convenience flag, it is the honesty of this axis.** An empty event
 * list is what a quiet hour looks like *and* what a calendar collector that has never run looks
 * like. Reporting CLEAR for the second would tell the gate the coast is clear on the strength of
 * data we do not have — and this axis feeds a veto, so the one direction it must never fail is
 * silently permissive.
 *
 * **Ruling (Tech Lead, 2026-10-12), binding on whoever wires this:** `calendarLoaded` means
 * **coverage of the window being asked about** — "is there calendar data spanning this frame's
 * ±60 minutes?" — and NEVER "the table has rows". Measured the day it was written: `calendar_events`
 * held 174 rows on `insight_dev1` whose newest event was nine days old, because the collector was
 * switched off during the pause rather than broken. A `rows exist` check would have found those 174
 * rows and reported CLEAR on every frame for nine days. A stale table has rows and no coverage, and
 * those are the two facts IB-BUG-010 separated for collectors: `not_recorded` is not `no_events`.
 *
 * The gate's side of this is ruled and belongs to IB-017: a refusal fails **closed**, under its
 * own reason `calendar_unknown` and counted separately — never as `EVENT_RISK`, so "we are blind"
 * can never masquerade as "there is an event".
 */
export function eventWindowAxis(
  nowSec: number,
  events: readonly RegimeCalendarEvent[],
  calendarLoaded: boolean,
): RegimeAxisValue<RegimeEventWindow> {
  const { windowMinutes, impact, currency } = REGIME_SPEC.eventWindow.params;
  if (!calendarLoaded) return refuse('no_data');

  const windowSec = windowMinutes * 60;
  const inside = events.some(
    (event) =>
      (event.impact ?? '').toLowerCase() === impact &&
      (event.currency ?? '').toUpperCase() === currency &&
      Math.abs(event.timeSec - nowSec) <= windowSec,
  );
  return ok<RegimeEventWindow>(inside ? 'EVENT_RISK' : 'CLEAR');
}
