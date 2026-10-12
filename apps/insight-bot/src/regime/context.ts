import type { WebFeatureFrame, WebFeatureValue } from '@trade-automation/contracts';
import {
  crowdedSideAxis, eventWindowAxis, leverageAxis, trendAxis, volAxis,
  type PercentileRank, type RegimeAxisValue, type RegimeCalendarEvent, type RegimeCrowdedSide,
  type RegimeEventWindow, type RegimeLeverage, type RegimeTrend, type RegimeVol,
} from './axes';
import { REGIME_VERSION, regimeSpecFingerprint } from './regime-spec';

/**
 * IB-016 — one frame's regime context: the axes, plus **what produced them** (design §8.3, D9).
 *
 * The provenance is not decoration (Tech Lead ruling, 2026-10-12). These rows are stored and
 * compared across time, and three things can change underneath such a comparison: the feature
 * spec (`frameVersion`), the particular frame revision an axis read (`frameRevision` — IB-015
 * frames are append-only and amend), and the axes' own constants (`regimeVersion` +
 * `specFingerprint`). A row that cannot say which of those produced it is a number without a
 * basis, and comparing two of them is the mistake `assertSingleRevisionPerClose` exists to stop
 * one level down.
 *
 * So: an axis row records them all, and a consumer comparing rows across a change has the means
 * to refuse rather than to average two different definitions together.
 */
export interface RegimeContext {
  symbol: string;
  /** The frame's bar close, epoch seconds — a context is stamped by its bar, never by wall clock. */
  closeTime: number;
  tf: string;

  trend: RegimeAxisValue<RegimeTrend>;
  vol: RegimeAxisValue<RegimeVol>;
  leverage: RegimeAxisValue<RegimeLeverage>;
  /** Which side is crowded — the other half of §8.3's leverage sentence, as its own fact. */
  crowdedSide: RegimeAxisValue<RegimeCrowdedSide>;
  eventWindow: RegimeAxisValue<RegimeEventWindow>;

  /** The feature spec the frame was written under. */
  frameVersion: number;
  /** Which revision of that frame these axes read (frames amend; revisions are append-only). */
  frameRevision: number;
  /**
   * Whether the frame these axes read was computed **live** at its close or **backfilled** later
   * (IB-015, 2026-10-12).
   *
   * It is on the row for the same reason the frame carries it: derive heals buckets after the
   * fact, so a backfilled frame is systematically better informed than the live frame for the
   * same close. A regime context inherits that difference completely — an axis computed from a
   * healed frame can say `HIGH` where the live frame could only have said
   * `insufficient_history` — so a context row that did not record its mode would let IB-017's
   * arming reconstruction and IB-023's outcome tracking learn from information that did not exist
   * at the close. That is lookahead, and it is invisible: the numbers all look reasonable.
   */
  computedMode: WebFeatureFrame['computedMode'];
  /** The axes' own definition version, and a fingerprint of their constants. */
  regimeVersion: number;
  specFingerprint: string;
}

/** Everything one context row is computed from. All feature inputs arrive as the frame holds them. */
export interface RegimeContextInput {
  symbol: string;
  closeTime: number;
  tf: string;
  frameVersion: number;
  frameRevision: number;
  computedMode: WebFeatureFrame['computedMode'];

  /** `ema.4h.50` now, and as it stood `slopeBars` frames back (null when that frame is missing). */
  emaFastNow: WebFeatureValue;
  emaFastThen: WebFeatureValue | null;
  /** `ema.1d.200` now. */
  emaSlow: WebFeatureValue;
  /** The frame's close. */
  price: WebFeatureValue;

  /**
   * `atr.4h.14` now, and its trailing values over the lookback.
   *
   * **The histories come from STORED FRAMES, not from the raw tables** (Tech Lead ruling,
   * 2026-10-12). An axis reading `candles_agg` directly could disagree with the frame it is
   * attached to: two numbers about the same instant, computed under different completeness
   * decisions, with nothing to say which is right. Reading frames makes the axis measure exactly
   * what the frame measured, at the same revision, under the same rules.
   *
   * The cost — no stored frames means no history — is removed by the frame pass gaining a history
   * mode (`--from --to`, as IB-014's derive has), so past closes are backfilled into frames and
   * these histories exist immediately *and* consistently. That is dev-2's, on IB-015.
   */
  atr: WebFeatureValue;
  atrHistory: readonly number[];

  /** `oi.binance.now` now, and its trailing values over the lookback — stored frames, as above. */
  oi: WebFeatureValue;
  oiHistory: readonly number[];

  /** Settled funding rates inside the window, across the venues that reported. */
  fundingRates: readonly number[];

  /** Calendar rows near the close, and whether the calendar is known to be loaded at all. */
  events: readonly RegimeCalendarEvent[];
  calendarLoaded: boolean;
}

/**
 * Assembles one row. Pure: every input is given, nothing is fetched, and the percentile definition
 * is the one IB-015 owns, passed in.
 *
 * There is **no `complete` flag and no overall "regime known" boolean**. Each axis carries its own
 * answer or its own refusal, exactly as each feature key does, because a single flag over four
 * independent measurements is a thing a consumer can forget to read — and the one that forgets is
 * the one deciding whether to arm.
 */
export function regimeContext(input: RegimeContextInput, percentileRank: PercentileRank): RegimeContext {
  return {
    symbol: input.symbol,
    closeTime: input.closeTime,
    tf: input.tf,

    trend: trendAxis({
      fastNow: input.emaFastNow,
      fastThen: input.emaFastThen,
      slow: input.emaSlow,
      price: input.price,
    }),
    vol: volAxis(input.atr, input.atrHistory, percentileRank),
    leverage: leverageAxis(input.oi, input.oiHistory, percentileRank),
    crowdedSide: crowdedSideAxis(input.fundingRates),
    eventWindow: eventWindowAxis(input.closeTime, input.events, input.calendarLoaded),

    frameVersion: input.frameVersion,
    frameRevision: input.frameRevision,
    computedMode: input.computedMode,
    regimeVersion: REGIME_VERSION,
    specFingerprint: regimeSpecFingerprint(),
  };
}

/**
 * Two context rows may only be compared when they were produced by the same definitions **and in
 * the same computed mode**.
 *
 * Throws rather than returning a flag, for IB-015's reason: a caller that wanted to know would
 * have checked first, and a flag is something a caller can ignore while still getting a plausible
 * answer out the other side.
 *
 * The mode check mirrors `assertSingleComputedMode` one layer up, and it is not redundant with it:
 * a caller can take a correctly single-mode set of frames and still assemble context rows from two
 * different runs. Mixing them is lookahead in the same way, by the same mechanism, and it is worth
 * refusing at both levels because this is the level a playbook's gate reads.
 */
export function assertComparableContexts(rows: readonly RegimeContext[]): void {
  if (rows.length === 0) return;
  const [first] = rows;
  for (const row of rows) {
    if (row.computedMode !== first.computedMode) {
      throw new Error(
        'regime contexts mix live and backfilled frames: a backfilled frame is systematically ' +
          'better informed than the live frame for the same close, because derive healed its ' +
          'buckets in between. Build the set from liveRevisions() for anything reconstructing ' +
          'what was knowable at a close, or work with backfilled context deliberately and alone.',
      );
    }
    if (
      row.frameVersion !== first.frameVersion ||
      row.regimeVersion !== first.regimeVersion ||
      row.specFingerprint !== first.specFingerprint
    ) {
      throw new Error(
        'regime contexts from different definitions cannot be compared: ' +
          `${first.symbol}@${first.closeTime} is frame v${first.frameVersion}/regime v${first.regimeVersion}` +
          `/${first.specFingerprint}, ${row.symbol}@${row.closeTime} is frame v${row.frameVersion}` +
          `/regime v${row.regimeVersion}/${row.specFingerprint}`,
      );
    }
  }
}
