import { z } from 'zod';
import type { PlaybookCondition, Setup, WebFeatureFrame, WebFeatureValue } from '@trade-automation/contracts';
import type { Playbook, PlaybookInput, PlaybookOutput } from './playbook.port';

/**
 * IB-018 — P3, post-cascade reversal on 15m (design §9.1). Starts in `shadow`.
 *
 * Pure, as the port requires: no IO, no clock, no randomness, so the stage-3 backtest runs this
 * exact function over historical frames rather than a second implementation that drifts.
 *
 * **On this tape P3 will rarely or never arm, and that is the correct output rather than a
 * defect.** `liq.*.z60m` needs 14 days of liquidation coverage, `atr.1d.14` needs an archive
 * backfill, and most percentile keys refuse. The ruling that came with this task is explicit: it
 * must not be "fixed" by loosening `armKeys`, lowering `minPeriods` or substituting a default for
 * a refusal — if P3 never arms, the per-close audit rows saying why are the deliverable.
 */

/** §9.1 and the task's `playbook_config` v1 thresholds. */
export const P3ParamsSchema = z.object({
  /** `liq.long.z60m ≥ this`. */
  liqZMin: z.number(),
  /**
   * `oi.d4h_pct ≤ this`, **per symbol**: −8 for BTC, −12 for ETH/SOL (§9.1).
   *
   * A map with **no default on purpose.** A symbol absent from it cannot arm, and reports a
   * condition naming the absence — inheriting another coin's threshold would silently apply BTC's
   * number to an altcoin whose ordinary 4-hour move is twice that.
   */
  oiDropPctBySymbol: z.record(z.string(), z.number()),
  /** `funding.predicted.binance ≤ this`. */
  predictedFundingMax: z.number(),
  /** The drawdown must be at least this many ATR(1h), as a price distance. */
  drawdownAtrMultiple: z.number(),
  /** Trigger alternative: close ≥ cascade low + this × ATR(1h). */
  triggerAtrMultiple: z.number(),
  /** Stop: cascade low − this × ATR(1h). */
  stopAtrMultiple: z.number(),
  /** T1 at this fraction of the cascade range. */
  t1RangeFraction: z.number(),
  /** `armed_ttl_bars` — 8 bars of 15m is two hours. */
  armedTtlBars: z.number().int().positive(),
});
export type P3Params = z.infer<typeof P3ParamsSchema>;

/**
 * Parses `playbook_config.params`, **with no defaults anywhere**.
 *
 * A threshold that defaults is a threshold nobody chose, and it would be indistinguishable in the
 * stored signal from one somebody did: every signal references its config version, and that
 * reference is only worth something if the version carries the whole configuration. A malformed
 * row throws rather than running P3 on half a configuration.
 */
export function parseP3Params(params: Record<string, unknown>): P3Params {
  const parsed = P3ParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(`P3 params are not usable: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

const TF_MS = 15 * 60_000;

/** A key's number, or null when it refuses — the caller never sees a refusal as a value. */
function num(frame: WebFeatureFrame, key: string): number | null {
  const value: WebFeatureValue | undefined = frame.keys[key];
  if (value === undefined || !value.ok || typeof value.value !== 'number') return null;
  return value.value;
}

const condition = (key: string, value: number | string | null, threshold: number | string, pass: boolean): PlaybookCondition =>
  ({ key, value, threshold, pass });

/**
 * The 24-hour high, reconstructed from the stored percentage key.
 *
 * `px.drawdown_from_24h_high` is `((close − high24h) / high24h) × 100`, so
 * `high24h = close / (1 + pct/100)`. Returns null at `pct ≤ −100`, which is not a deep drawdown
 * but an impossible one (a non-positive high), and inventing a level from it would put a target
 * and a stop on a number the market never printed.
 */
export function high24hFrom(close: number, drawdownPct: number): number | null {
  const p = drawdownPct / 100;
  if (p <= -1) return null;
  return close / (1 + p);
}

/**
 * Is the drawdown at least `multiple` ATRs?
 *
 * **Compared as PRICE DISTANCES** (Tech Lead ruling, 2026-10-12), which is what dissolves the
 * units problem in §9.1's wording. The design writes
 * `px.drawdown_from_24h_high ≥ 2.5 × atr.1h.14 / price`, which is backwards twice over: the stored
 * key is NEGATIVE below the high, so taken literally the condition is satisfied only at or above
 * the 24-hour high and never by a cascade; and it compares a quantity normalised by `high24h`
 * against one normalised by `close`.
 *
 * Both sides are price distances, so the normalisation is unnecessary rather than debatable:
 *
 * ```
 * high24h − close  ≥  multiple × atr
 * ```
 *
 * Dividing both sides by `close` gives the "both over close" form, which is the same statement —
 * that equivalence is why it is the right one rather than merely a choice. Recorded because the
 * correct form **arms slightly more often** than the design's literal pairing (by about the
 * drawdown fraction), and the reason for it is dimensional and must not be reinterpreted later as
 * a bias toward arming.
 */
export function drawdownIsAtLeastAtrs(close: number, drawdownPct: number, atr: number, multiple: number): boolean | null {
  const high = high24hFrom(close, drawdownPct);
  if (high === null) return null;
  return high - close >= multiple * atr;
}

/** Every arm condition, evaluated and reported — passed or not, because the table is the message. */
export function p3ArmConditions(input: {
  symbol: string;
  frame: WebFeatureFrame;
  params: P3Params;
}): { conditions: PlaybookCondition[]; pass: boolean } {
  const { frame, params } = input;
  const conditions: PlaybookCondition[] = [];

  const liqZ = num(frame, 'liq.long.z60m');
  conditions.push(condition('liq.long.z60m', liqZ, params.liqZMin, liqZ !== null && liqZ >= params.liqZMin));

  const oi = num(frame, 'oi.d4h_pct');
  const oiThreshold = params.oiDropPctBySymbol[input.symbol];
  if (oiThreshold === undefined) {
    // No fallback: BTC's −8 % applied to an altcoin whose ordinary 4-hour move is twice that would
    // arm on noise. The condition names the absence so the audit row says which symbol is
    // unconfigured rather than leaving a silent non-arm.
    conditions.push(condition('oi.d4h_pct', oi, `no threshold configured for ${input.symbol}`, false));
  } else {
    conditions.push(condition('oi.d4h_pct', oi, oiThreshold, oi !== null && oi <= oiThreshold));
  }

  const funding = num(frame, 'funding.predicted.binance');
  conditions.push(condition(
    'funding.predicted.binance', funding, params.predictedFundingMax,
    funding !== null && funding <= params.predictedFundingMax,
  ));

  const close = num(frame, 'px.close');
  const drawdown = num(frame, 'px.drawdown_from_24h_high');
  const atr1h = num(frame, 'atr.1h.14');
  const deep = close !== null && drawdown !== null && atr1h !== null
    ? drawdownIsAtLeastAtrs(close, drawdown, atr1h, params.drawdownAtrMultiple)
    : null;
  conditions.push(condition(
    'px.drawdown_from_24h_high', drawdown, `${params.drawdownAtrMultiple}x atr.1h.14 as a price distance`,
    deep === true,
  ));

  return { conditions, pass: conditions.every((c) => c.pass) };
}

/**
 * The setup P3 holds once armed, with every level fixed at the arming bar.
 *
 * Levels come from the **cascade bar** — the bar this frame is stamped by — so they are facts
 * about one bar rather than a moving window: trigger at its midpoint or at its low plus
 * `triggerAtrMultiple` ATR (whichever a close reaches first is the trigger), stop below its low,
 * T1 half-way up its range.
 *
 * **T2 is the 24-hour high** (ruled 2026-10-12): a setup that arms at "2.5 ATR below the 24-hour
 * high" and targets that same high is one coherent statement, where the bar's own open would make
 * the target a function of where a bar boundary happened to fall. The ruling was made on reasoning
 * with no data, deliberately and on the record — **IB-023 must report how often T2 is reached
 * against T1**, and if T2 proves to be decoration this is revisited with that number rather than
 * with another argument.
 */
export function p3Setup(input: {
  armId: string;
  closeTime: number;
  frame: WebFeatureFrame;
  params: P3Params;
}): Setup | null {
  const { frame, params } = input;
  const high = num(frame, 'px.high');
  const low = num(frame, 'px.low');
  const close = num(frame, 'px.close');
  const atr1h = num(frame, 'atr.1h.14');
  const drawdown = num(frame, 'px.drawdown_from_24h_high');
  if (high === null || low === null || close === null || atr1h === null || drawdown === null) return null;

  const midpoint = (high + low) / 2;
  const fromLow = low + params.triggerAtrMultiple * atr1h;
  // Whichever level a close reaches first is the trigger, so the level held is the LOWER of the
  // two: §9.1 says "above the midpoint, OR low + 0.5 ATR", and a setup that stored the higher one
  // would wait past its own trigger.
  const triggerLevel = Math.min(midpoint, fromLow);
  const t2 = high24hFrom(close, drawdown);
  if (t2 === null) return null;

  return {
    armId: input.armId,
    direction: 'long',
    trigger: { type: 'close_above', level: triggerLevel, tf: '15m' },
    stop: low - params.stopAtrMultiple * atr1h,
    targets: [low + params.t1RangeFraction * (high - low), t2],
    invalidation: [
      // §9.1's two rules, machine-readable so the tracker evaluates them without parsing text.
      { key: 'px.low', op: '<', value: low },
      { key: 'oi.d4h_pct', op: '>', value: 0 },
    ],
    rr: null,
    expiresAt: Math.floor(input.closeTime / 1000) + params.armedTtlBars * (TF_MS / 1000),
  };
}

/**
 * §9.1's invalidations, evaluated while a setup is held.
 *
 * - **a new low after trigger** — the cascade low was not the low;
 * - **`oi.d4h_pct` rising while price falls** — positions being rebuilt into weakness, which is
 *   the opposite of the exhaustion P3 is fading.
 *
 * Returns null when a key it needs refuses. The caller must NOT read that as "not invalidated":
 * `oi.d4h_pct` is in `triggerKeys` precisely so the runner reports `blind_while_armed` instead of
 * a quiet `false`.
 */
export function p3Invalidated(input: {
  frame: WebFeatureFrame;
  setup: Setup;
  prev: 'ARMED' | 'TRIGGERED';
}): boolean | null {
  const close = num(input.frame, 'px.close');
  const low = num(input.frame, 'px.low');
  const oi = num(input.frame, 'oi.d4h_pct');
  if (close === null || oi === null) return null;

  const cascadeLow = input.setup.stop; // the stop sits below the cascade low by a fixed ATR fraction
  if (input.prev === 'TRIGGERED' && low !== null && low < cascadeLow) return true;
  // "OI rising while price falls": a 4-hour OI change above zero with price below the trigger.
  if (oi > 0 && close < input.setup.trigger.level) return true;
  return false;
}

/**
 * P3's key requirements (§8.4's split, which this task is the first real exercise of).
 *
 * `armKeys` includes `px.high` and `px.low`: a refusal there means "cannot arm", which is ordinary
 * and is the state of every symbol until those keys exist. `triggerKeys` carries `px.close` **and
 * `oi.d4h_pct`** — the trigger itself needs only the close, but the invalidation rule needs OI, and
 * `evaluate()` can only answer `invalidated: boolean`, so a refusal there while ARMED must surface
 * as `blind_while_armed` rather than as a quiet `false`.
 */
export const P3_KEYS = {
  armKeys: [
    'liq.long.z60m', 'oi.d4h_pct', 'funding.predicted.binance',
    'px.drawdown_from_24h_high', 'atr.1h.14', 'px.close', 'px.high', 'px.low',
  ],
  triggerKeys: ['px.close', 'oi.d4h_pct'],
} as const;

export const p3: Playbook = {
  id: 'P3',
  tf: '15m',
  keys: { armKeys: [...P3_KEYS.armKeys], triggerKeys: [...P3_KEYS.triggerKeys] },

  evaluate(input: PlaybookInput): PlaybookOutput {
    const params = parseP3Params(input.params);

    if (input.prev === 'ARMED' || input.prev === 'TRIGGERED') {
      const setup = input.setup;
      if (setup === null) return { wantsArm: false, triggered: false, invalidated: false, conditions: [] };

      const close = num(input.frame, 'px.close');
      const invalidated = p3Invalidated({ frame: input.frame, setup, prev: input.prev });
      const triggered = input.prev === 'ARMED' && close !== null && close >= setup.trigger.level;

      return {
        wantsArm: false,
        triggered,
        // A null here cannot be reported as "not invalidated". The runner sees the OI refusal
        // through triggerKeys and raises blind_while_armed; returning false would hide it.
        invalidated: invalidated === true,
        conditions: [
          condition('px.close', close, setup.trigger.level, triggered),
          condition('invalidation', invalidated === null ? null : String(invalidated), 'none matched', invalidated === false),
        ],
      };
    }

    const { conditions, pass } = p3ArmConditions({ symbol: input.symbol, frame: input.frame, params });
    const setup = pass ? p3Setup({ armId: `${input.symbol}:${input.closeTime}`, closeTime: input.closeTime, frame: input.frame, params }) : null;

    return {
      wantsArm: pass && setup !== null,
      triggered: false,
      invalidated: false,
      setup: setup ?? undefined,
      conditions,
    };
  },
};
