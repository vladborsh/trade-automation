/**
 * IB-016 — the regime axes' meaning-defining constants (design §8.3, D9).
 *
 * Same discipline as IB-015's `WEB_FEATURE_SPEC`, and for the same reason: every number that
 * decides what an axis *says* lives here with the sentence it implements, and the calculators
 * read it rather than restating it. These particular numbers decide whether a playbook may arm.
 *
 * **Fingerprinted** (Tech Lead ruling, 2026-10-12). The percentile definition is injected rather
 * than restated — one definition, owned by IB-015 — but an injected function hides its parameters
 * from any check, so the parameters that remain here must not hide too: `regimeSpecFingerprint`
 * is asserted against a committed literal, and changing a band, a lookback or a window fails the
 * build until `REGIME_VERSION` is bumped. A stored axis that cannot say which constants produced
 * it is a number without a basis, which is the thing this whole system is built not to store.
 *
 * Where §8.3 is silent the entry says so, and names who decided — a reader must be able to tell a
 * design decision from a developer's default.
 */

/** Bumped on a change of MEANING: a band edge, a window, a lookback, an axis's definition. */
export const REGIME_VERSION = 1;

export const REGIME_SPEC = {
  trend: {
    def: 'UP when the EMA50-on-4h slope over the lookback is positive AND price is above the EMA200 on 1d; DOWN when both point down; RANGE otherwise',
    params: {
      /**
       * The frame keys this axis reads. **Regime computes no EMAs of its own** (Tech Lead ruling):
       * the frame is where computed inputs live, and a second path reading `candles_agg` would
       * re-implement the completeness and refusal logic IB-015 already owns.
       *
       * `ema.1d.200` needs **`length + warmupBars` daily bars** — read the figure from
       * `WEB_FEATURE_SPEC['ema.1d.200'].params`, never from here. It was 200 when this was
       * written and IB-052 made it 300 by adding the warm-up a recursive indicator needs to be
       * reproducible; a number restated in prose is a number that drifts, and this comment had
       * already drifted once. Until enough daily bars exist the axis refuses, which is a
       * prerequisite of the Binance archive backfill rather than a wait — how many are held today
       * is a query, not a comment.
       */
      fastKey: 'ema.4h.50',
      slowKey: 'ema.1d.200',
      /**
       * How far back the slope is measured, in frames. **Not in §8.3** (dev-1, ruled "take yours"
       * 2026-10-12): six 4h bars is 24 hours, the horizon the rest of the frame already treats as
       * recent (`oi.d24h_pct`, `px.ret_24h`).
       */
      slopeBars: 6,
      /**
       * The magnitude a slope must exceed. **Zero — the sign decides** (dev-1, ruled "take
       * yours"): a threshold would be a number invented here.
       *
       * The Tech Lead's condition on that ruling: a sign with no deadband flips in a flat market,
       * and an axis that oscillates is its own defect — so the daily flip rate is **measured on
       * the tape and reported**, and any future deadband comes from that measurement (most likely
       * relative to ATR, which the frame already carries) rather than from a guess.
       */
      slopeMinimum: 0,
    },
  },

  vol: {
    def: 'LOW below the low band, HIGH above the high band, NORMAL between them, on the ATR(14) 4h percentile over the lookback',
    params: {
      /** §8.3: "ATR(14) 4h percentile over 90 days". */
      sourceKey: 'atr.4h.14',
      lookbackDays: 90,
      /**
       * §8.3: "< 30 / 30–80 / > 80". The boundaries are NORMAL — the design writes the middle
       * band closed on both sides.
       */
      lowBand: 0.3,
      highBand: 0.8,
      /**
       * The sample below which a percentile is not the number §8.3 means. 45 is IB-015's own
       * figure for its percentile keys, so the repository has one convention rather than two.
       */
      minPeriods: 45,
    },
  },

  leverage: {
    /**
     * **Directionless** (Tech Lead ruling, 2026-10-12, deciding against dev-1's proposal).
     *
     * High open interest is leverage in the system whichever way the crowd leans: a crowded short
     * book cascades upward exactly as a crowded long book cascades down, and P3 is a post-cascade
     * reversal playbook that cares about both. Folding the funding sign into this label would have
     * labelled levered shorts `NEUTRAL` and hidden them — so the sign is its own field below. Two
     * facts, two fields.
     */
    def: 'LEVERED at or above the high band of the OI percentile over the lookback, DELEVERED at or below the low band, NEUTRAL between them',
    params: {
      /** §8.3: "oi.binance.now percentile over 90 days". */
      sourceKey: 'oi.binance.now',
      lookbackDays: 90,
      /** The same pair as `vol`, so the repository holds one notion of "historically high". */
      lowBand: 0.3,
      highBand: 0.8,
      minPeriods: 45,
    },
  },

  crowdedSide: {
    /** The other half of §8.3's leverage sentence, kept as its own fact rather than a modifier. */
    def: 'LONGS when the mean settled funding over the window is positive, SHORTS when negative, BALANCED when exactly zero',
    params: {
      /** §8.3: "the 3-day mean funding sign". */
      meanDays: 3,
      /**
       * At least this many settled rates before a mean sign is claimed: one print is not a
       * three-day mean, and a sign taken from one would flip on a single venue's noise.
       */
      minSettlements: 3,
    },
  },

  eventWindow: {
    def: 'EVENT_RISK inside the window either side of a high-impact event in the stated currency; CLEAR only when the calendar is known to be loaded',
    params: {
      /** §8.3/§9.4: "±60 min of a high-impact USD calendar event". */
      windowMinutes: 60,
      impact: 'high',
      currency: 'USD',
    },
  },
} as const;

export type RegimeAxisName = keyof typeof REGIME_SPEC;

/**
 * A stable fingerprint of every axis's definition and constants.
 *
 * Deliberately the same construction as `featureSpecFingerprint` — one way of answering "did the
 * meaning change?" in this repository, not two. FNV-1a, 32-bit: this is compared against a
 * committed literal, not used as a security property.
 */
export interface RegimeSpecEntry {
  def: string;
  params: Readonly<Record<string, string | number>>;
}

export function regimeSpecFingerprint(
  spec: Readonly<Record<string, RegimeSpecEntry>> = REGIME_SPEC as never,
): string {
  const canonical = Object.keys(spec)
    .sort()
    .map((axis) => {
      const entry = spec[axis];
      const params = Object.keys(entry.params)
        .sort()
        .map((name) => `${name}=${String(entry.params[name])}`)
        .join(',');
      return [axis, entry.def, params].join('\u0000');
    })
    .join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** A numeric parameter, or a throw — a missing constant is a spec error, never a default. */
export function regimeParamNumber(axis: RegimeAxisName, name: string): number {
  const params = REGIME_SPEC[axis].params as Readonly<Record<string, string | number>>;
  const value = params[name];
  if (typeof value !== 'number') throw new Error(`regime axis ${axis} has no numeric param "${name}"`);
  return value;
}
