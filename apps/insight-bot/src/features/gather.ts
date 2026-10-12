import type { WebFrameBasis, WebFrameTimeframe } from '@trade-automation/contracts';
import type { DbHandle } from '../db/db.port';
import type { CvdBar, CvdInput, CvdWindows } from './calculators/cvd';
import type { FundingInput, Settlement } from './calculators/funding';
import type { LiqInput } from './calculators/liquidations';
import type { LsInput } from './calculators/long-short';
import type { OiInput, OiPoint } from './calculators/open-interest';
import type { PriceInput } from './calculators/price';
import type { StructureInput } from './calculators/structure';
import type { EmaInput } from './calculators/ema';
import type { AtrInput } from './calculators/volatility';
import type { AtrBar } from './math/wilder-atr';
import { type AbsenceEvidence, type WindowShortfall, expectedMinutes } from './input-completeness';
import * as inputs from './pg/feature-inputs.repo';
import { lookbackMs } from './required-windows';

/**
 * IB-015 — one close's worth of inputs, read from the database and shaped for the calculators.
 *
 * Impure by definition, and kept deliberately thin: it reads, it counts what it read, and it
 * hands both on. Every decision about what a shortfall MEANS lives in `input-completeness.ts`
 * and every decision about what a frame then says lives in `frame-assembly.ts`, both pure. The
 * rule this task turns on — nothing arms on an unhealed bucket — must be testable without a
 * database, so none of it is here.
 *
 * **Only `complete = true` buckets count as present.** §8.1 is explicit, and
 * `candles_agg.complete` exists precisely because a partial bucket is not a smaller bar. The
 * read returns incomplete buckets as well, and they are counted as absent rather than folded
 * into the window.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

const TF_MS: Readonly<Record<string, number>> = {
  '15m': 15 * MINUTE,
  '1h': HOUR,
  '4h': 4 * HOUR,
  '1d': 24 * HOUR,
};

/** The venues §8.2's funding keys assess. Identifiers — not translated. */
const FUNDING_VENUES = ['binance', 'bybit', 'okx'] as const;
const PRIMARY_VENUE = 'binance';

export interface Gathered {
  symbol: string;
  tf: WebFrameTimeframe;
  closeMs: number;
  price: PriceInput;
  volatility: AtrInput;
  ema: EmaInput;
  structure: StructureInput;
  cvd: CvdInput;
  funding: FundingInput;
  oi: OiInput;
  ls: LsInput;
  liq: LiqInput;
  /** Windows that came back short, one per input group. */
  shortfalls: WindowShortfall[];
  /** What explains a shortfall, where anything does. */
  evidenceByGroup: Record<string, AbsenceEvidence>;
  basis: WebFrameBasis;
}

/** A 15m agg row as the pivot maths wants it — the open carried through so a swing has a time. */
const toPivotBar = (b: { openTimeSec: number; high: number; low: number }) =>
  ({ time: b.openTimeSec * 1000, high: b.high, low: b.low });

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** Bars whose open lies in `[from, close)`, already filtered to complete buckets. */
function sliceFrom<T extends { openTimeSec: number }>(bars: readonly T[], fromMs: number): T[] {
  return bars.filter((b) => b.openTimeSec * 1000 >= fromMs);
}

/** The slot nearest at-or-before an instant, or null when none is within `toleranceMs`. */
function slotAt(slots: readonly OiPoint[], atMs: number, toleranceMs: number): OiPoint | null {
  let best: OiPoint | null = null;
  for (const slot of slots) {
    const ms = slot.timeSec * 1000;
    if (ms > atMs) break;
    best = slot;
  }
  if (best === null) return null;
  // A slot far from the reference is not the reference. Measuring a 24 h delta from a point 6 h
  // adrift produces an ordinary-looking percentage on a day with an outage, which is exactly the
  // confident-wrong-number case: refuse instead.
  return atMs - best.timeSec * 1000 <= toleranceMs ? best : null;
}

/**
 * Facts that are the same for every symbol in a pass, read once and handed in.
 *
 * `liquidationHistoryStartMs` is a `min()` over the whole `liquidations` table and measured
 * 1,757 ms warm — it does not get cheaper with repetition, because a full scan has nothing to
 * warm. It is dataset-wide by design (see the repo function: "when did collection start" is not
 * a per-symbol question), so asking it once per symbol was paying for one answer thirty times.
 */
export interface PassContext {
  liquidationHistoryStartMs: number | null;
}

export async function loadPassContext(db: DbHandle): Promise<PassContext> {
  return { liquidationHistoryStartMs: await inputs.liquidationHistoryStartMs(db) };
}

export async function gather(
  db: DbHandle,
  symbol: string,
  tf: WebFrameTimeframe,
  closeMs: number,
  context: PassContext,
): Promise<Gathered> {
  // One read of the symbols row instead of four (IB-BUG-011's mapping lives inside it).
  const identity = await inputs.symbolIdentity(db, symbol);
  const perpSpellings = identity.perpSpellings;
  const binanceOnly = identity.binancePerp;
  const spotSpellings = identity.binanceSpot === null ? [] : [identity.binanceSpot];
  const listedMs = identity.listedPerpMs;

  const shortfalls: WindowShortfall[] = [];
  const evidenceByGroup: Record<string, AbsenceEvidence> = {};

  /** Minutes inside a window that the venue never produced, because the perp had not listed. */
  const notTradedMinutes = (fromMs: number): number =>
    listedMs === null || listedMs <= fromMs ? 0 : Math.ceil((Math.min(listedMs, closeMs) - fromMs) / MINUTE);

  // ---- aggregated bars, one read per timeframe -------------------------------------------
  //
  // The four timeframes are read CONCURRENTLY, and so is everything below that does not depend
  // on something above it. The pass has a 30-second budget between a close and its frame (§8.1)
  // and measured 1.9 s per symbol when every read waited for the one before it — about 57 s for
  // a signal set of thirty, which is not a slow query anywhere, just twenty round trips in a
  // row, thirty times.
  const aggByTf: Record<string, Awaited<ReturnType<typeof inputs.aggBars>>> = {};
  const aggResults = await Promise.all((['15m', '1h', '4h', '1d'] as const).map(async (barTf) => {
    const group = `agg:${barTf}`;
    // The window ends at the last boundary of THIS timeframe at or before the frame's close,
    // not at the close itself.
    //
    // A 15m frame at 02:00 sits inside the 4 h bucket that opened at 00:00 and the 1 d bucket
    // that opened at midnight. Both are still being folded, so both are `complete = false`, and
    // ending the window at the close counted them as shortfalls — which made `atr.4h.14` and
    // `atr.1d.14` refuse with `incomplete_input` on EVERY 15m frame. Found by reading the first
    // frames this actually wrote rather than by a test: the refusal was indistinguishable from
    // the real thing it is meant to catch.
    const until = Math.floor(closeMs / TF_MS[barTf]) * TF_MS[barTf];
    const from = until - lookbackMs(group);
    const [all, firstBucket] = await Promise.all([
      inputs.aggBars(db, {
        venue: PRIMARY_VENUE, market: 'perp', symbols: binanceOnly, tf: barTf, fromMs: from, toMsExclusive: until,
      }),
      inputs.firstAggBucketMs(db, {
        venue: PRIMARY_VENUE, market: 'perp', symbols: binanceOnly, tf: barTf, fromMs: from,
      }),
    ]);
    const complete = all.filter((b) => b.complete);

    // Expected is clamped to the history that could exist: buckets before the first row this
    // symbol has are not missing, they were never collected.
    //
    // Without the clamp, IB-016's `ema.1d.200` widened agg:1d to 200 days against a table
    // holding ten, and the whole GROUP reported a 190-bucket shortfall — which would have
    // blocked `atr.1d.14` with `incomplete_input` too, and parked a permanent entry in the
    // unhealed-gap counter for every symbol. A shortfall has to be something somebody can fix.
    const effectiveFrom = firstBucket === null ? until : Math.max(from, firstBucket);
    const expected = Math.max(0, Math.round((until - effectiveFrom) / TF_MS[barTf]));
    if (complete.length < expected) {
      const partial = all.length - complete.length;
      shortfalls.push({
        group,
        expected,
        present: complete.length,
        detail:
          `candles_agg ${barTf} ${iso(effectiveFrom)}–${iso(until)}, ${complete.length} of ${expected}` +
          (partial > 0 ? ` (${partial} incomplete)` : ''),
      });
      evidenceByGroup[group] = {
        recordedGapMinutes: await inputs.recordedGapMinutes(db, {
          stream: `${PRIMARY_VENUE}:kline_1m`, symbols: binanceOnly, fromMs: from, toMsExclusive: until,
        }) / (TF_MS[barTf] / MINUTE),
        notTradedMinutes: notTradedMinutes(from) / (TF_MS[barTf] / MINUTE),
      };
    }
    return [barTf, complete] as const;
  }));
  for (const [barTf, complete] of aggResults) aggByTf[barTf] = complete;

  // ---- 1m bars, per market ----------------------------------------------------------------
  const cvdWindows = async (market: 'perp' | 'spot', spellings: readonly string[]): Promise<CvdWindows | null> => {
    const group = `candles1m:${market}`;
    if (spellings.length === 0) return null; // no such listing: a refusal, not a short window
    const from = closeMs - lookbackMs(group);
    const bars = await inputs.minuteBars(db, {
      venue: PRIMARY_VENUE, market, symbols: spellings, fromMs: from, toMsExclusive: closeMs,
    });
    const expected = expectedMinutes(lookbackMs(group) / HOUR);
    if (bars.length < expected) {
      shortfalls.push({
        group, expected, present: bars.length,
        detail: `candles_1m ${market} ${iso(from)}–${iso(closeMs)}, ${bars.length} of ${expected}`,
      });
      evidenceByGroup[group] = {
        recordedGapMinutes: await inputs.recordedGapMinutes(db, {
          stream: `${PRIMARY_VENUE}:kline_1m`, symbols: spellings, fromMs: from, toMsExclusive: closeMs,
        }),
        notTradedMinutes: notTradedMinutes(from),
      };
    }
    const toBars = (fromMs: number, toMs: number): CvdBar[] =>
      bars.filter((b) => b.openTimeSec * 1000 >= fromMs && b.openTimeSec * 1000 < toMs)
        .map((b) => ({ volume: b.volume, takerBuyVolume: b.takerBuyVolume }));
    return {
      last4h: toBars(closeMs - 4 * HOUR, closeMs),
      last24h: toBars(closeMs - 24 * HOUR, closeMs),
      previous4h: toBars(closeMs - 8 * HOUR, closeMs - 4 * HOUR),
    };
  };

  const [perpCvd, spotCvd] = await Promise.all([
    cvdWindows('perp', binanceOnly),
    cvdWindows('spot', spotSpellings),
  ]);

  // ---- the rest: independent of each other, so read together ---------------------------------
  const oiFrom = closeMs - lookbackMs('oi');
  const liqFrom = closeMs - lookbackMs('liq');
  const OI_TOLERANCE_MS = 15 * MINUTE; // three 5-minute slots: a gap wider than that is a gap

  const historyStart = context.liquidationHistoryStartMs;
  const [slots, settlementRows, predictedBinance, lsRows, hourly, minute15] =
    await Promise.all([
      inputs.oiSlots(db, { venue: PRIMARY_VENUE, symbols: binanceOnly, fromMs: oiFrom, toMsExclusive: closeMs + 1 }),
      inputs.recentSettlements(db, { symbols: perpSpellings, beforeMs: closeMs, limitPerVenue: 90 }),
      inputs.predictedFundingAt(db, {
        venue: PRIMARY_VENUE, symbols: binanceOnly, atMs: closeMs, withinMs: 10 * MINUTE,
      }),
      inputs.longShortSeries(db, {
        venue: PRIMARY_VENUE, symbols: binanceOnly, fromMs: closeMs - lookbackMs('ls'), toMsExclusive: closeMs,
      }),
      inputs.liquidationBuckets(db, {
        symbols: perpSpellings, fromMs: liqFrom, toMsExclusive: closeMs, widthSec: 3600,
      }),
      inputs.liquidationBuckets(db, {
        symbols: perpSpellings, fromMs: closeMs - HOUR, toMsExclusive: closeMs, widthSec: 900,
      }),
    ]);
  const settled: Partial<Record<(typeof FUNDING_VENUES)[number], Settlement[]>> = {};
  for (const venue of FUNDING_VENUES) {
    const rows = settlementRows.filter((r) => r.venue === venue);
    if (rows.length > 0) settled[venue] = rows.map((r) => ({ timeSec: r.timeSec, rate: r.rate }));
  }

  const lsSeries: LsInput['series'] = {};
  for (const row of lsRows) {
    const kind = row.kind as keyof LsInput['series'];
    const series = (lsSeries[kind] ??= []) as number[];
    series.push(row.ratio);
  }

  const sideSum = (rows: readonly { side: string; usd: number }[], side: string) =>
    rows.filter((r) => r.side === side).reduce((total, r) => total + r.usd, 0);
  const hourlyHistory = (side: string): number[] => {
    // One entry per COLLECTED hour of the lookback, including the quiet ones.
    //
    // Two different absences, and conflating them is IB-BUG-010's vocabulary error applied to a
    // z-score. Inside the collected span a missing bucket is a real zero — no liquidation
    // happened — and dropping it would leave a sample of busy hours only, against which every
    // busy hour looks normal. BEFORE collection started there is no hour to describe, and
    // padding it with zero is inventing a calm market that nobody observed.
    //
    // The padding version produced `liq.long.z60m = 3.9` on a frame whose `liq.long.60m` said
    // `no_data`: ~340 fabricated zeros dragged the mean to nearly nothing, so any real hour
    // scored several sigma. A confident number manufactured entirely out of absence.
    const from = historyStart === null ? closeMs : Math.max(liqFrom, historyStart);
    const byBucket = new Map<number, number>();
    for (const row of hourly) if (row.side === side) byBucket.set(row.bucketSec, row.usd);
    const out: number[] = [];
    for (let at = from; at < closeMs - HOUR; at += HOUR) out.push(byBucket.get(Math.floor(at / 1000)) ?? 0);
    return out;
  };

  const last15 = minute15.filter((r) => r.bucketSec * 1000 >= closeMs - 15 * MINUTE);
  const last60 = minute15;

  const bars15m = aggByTf['15m'];
  const closeOf = (atMs: number): number | null => {
    const bar = [...bars15m].reverse().find((b) => b.openTimeSec * 1000 <= atMs);
    return bar ? bar.close : null;
  };
  const lastClose = bars15m.length > 0 ? bars15m[bars15m.length - 1].close : null;
  const highs24h = sliceFrom(bars15m, closeMs - 24 * HOUR).map((b) => b.high);

  const atrBars = (barTf: '1h' | '4h' | '1d'): AtrBar[] =>
    aggByTf[barTf].map((b) => ({ high: b.high, low: b.low, close: b.close }));

  return {
    symbol,
    tf,
    closeMs,
    price: {
      close: lastClose,
      close24hAgo: closeOf(closeMs - 24 * HOUR),
      close4hAgo: closeOf(closeMs - 4 * HOUR),
      high24h: highs24h.length > 0 ? Math.max(...highs24h) : null,
    },
    volatility: { bars: { '1h': atrBars('1h'), '4h': atrBars('4h'), '1d': atrBars('1d') } },
    ema: {
      closes4h: aggByTf['4h'].map((b) => b.close),
      closes1d: aggByTf['1d'].map((b) => b.close),
    },
    structure: {
      bars12h: sliceFrom(bars15m, closeMs - 12 * HOUR).map(toPivotBar),
      bars24h: sliceFrom(bars15m, closeMs - 24 * HOUR).map(toPivotBar),
      closes24h: sliceFrom(bars15m, closeMs - 24 * HOUR).map((b) => b.close),
      atr1h: null, // filled by compute: it is the output of atr.1h.14, not an input read
    },
    cvd: { perp: perpCvd ?? { last4h: [], last24h: [], previous4h: [] }, spot: spotCvd },
    funding: {
      settled,
      predictedBinance,
    },
    oi: {
      now: slotAt(slots, closeMs, OI_TOLERANCE_MS),
      ago24h: slotAt(slots, closeMs - 24 * HOUR, OI_TOLERANCE_MS),
      ago4h: slotAt(slots, closeMs - 4 * HOUR, OI_TOLERANCE_MS),
      sevenDays: slots,
    },
    ls: { series: lsSeries },
    liq: {
      sums: {
        long: { m15: sideSum(last15, 'long'), m60: sideSum(last60, 'long') },
        short: { m15: sideSum(last15, 'short'), m60: sideSum(last60, 'short') },
      },
      history: { long: hourlyHistory('long'), short: hourlyHistory('short') },
      // 14 days of collection, measured from when the table starts rather than from this
      // symbol's own rows: a coin that simply did not liquidate has history, not a shortage.
      hasAnyHistory: historyStart !== null && closeMs - historyStart >= 14 * 24 * HOUR,
    },
    // Sorted because the reads above run concurrently and finish in whatever order the
    // database returns them. `assembleFrame` sorts the reason strings too, but a Gathered that
    // differs run to run is a fixture nobody can pin and a spec that flakes for no reason.
    shortfalls: [...shortfalls].sort((a, b) => a.group.localeCompare(b.group)),
    evidenceByGroup,
    basis: {
      venues: [...FUNDING_VENUES],
      coverage: 'not_recorded',
      coveredHours: null,
    },
  };
}
