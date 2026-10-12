import type { FrameFeatureValue } from './feature-value';
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

  /** `ema.4h.50` now, and as it stood `slopeBars` frames back (null when that frame is missing). */
  emaFastNow: FrameFeatureValue;
  emaFastThen: FrameFeatureValue | null;
  /** `ema.1d.200` now. */
  emaSlow: FrameFeatureValue;
  /** The frame's close. */
  price: FrameFeatureValue;

  /** `atr.4h.14` now, and its trailing values over the lookback. */
  atr: FrameFeatureValue;
  atrHistory: readonly number[];

  /** `oi.binance.now` now, and its trailing values over the lookback. */
  oi: FrameFeatureValue;
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
    regimeVersion: REGIME_VERSION,
    specFingerprint: regimeSpecFingerprint(),
  };
}

/**
 * Two context rows may only be compared when they were produced by the same definitions.
 *
 * Throws rather than returning a flag, for IB-015's reason: a caller that wanted to know would
 * have checked first, and a flag is something a caller can ignore while still getting a plausible
 * answer out the other side.
 */
export function assertComparableContexts(rows: readonly RegimeContext[]): void {
  if (rows.length === 0) return;
  const [first] = rows;
  for (const row of rows) {
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
