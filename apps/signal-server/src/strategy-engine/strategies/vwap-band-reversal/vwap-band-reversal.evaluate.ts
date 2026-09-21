import { Candle } from '@trade-automation/contracts';
import { computeAtr, computeFvg, computePreviousHourLH, computeRange, computeVwapBand } from '@trade-automation/indicators';

const SWEEP_BARS = 6;

export interface EvaluateParams {
  minVwapAtrRatio: number;
  maxVwapAtrRatio: number;
  maxIfvgToAtrRatio: number;
  targetRr: number;
  rangeBars: number;
  atrBars: number;
}

export type Bias = 'sell' | 'buy' | null;

/**
 * architecture/vwap-band-reversal-plugin.md §2.3 — the parity surface. Field names match the
 * Researcher's `engine.py` COMP layout so `vwap-band-reversal.parity.spec.ts` maps them 1:1.
 */
export interface Evaluation {
  n: number;
  err: boolean;

  rangeTop?: number;
  rangeBottom?: number;
  inDiscount: boolean;

  bullOcc: boolean;
  bearOcc: boolean;
  nBullIfvg: number;
  nBearIfvg: number;
  hasIfvg: boolean;
  ifvgLow?: number;
  ifvgHigh?: number;
  ifvgX?: number; // window index into mainWindow of the last iFVG box — not part of COMP, used for drawing
  ifvgAtrRatio?: number;

  atr?: number;

  prevFound: boolean;
  prevHigh?: number;
  prevLow?: number;
  prevWindowStart?: number; // openTime of the earliest bar in the previous-hour window — for drawing only

  nBias: number;
  vwap?: number;
  vwapTop?: number;
  vwapBottom?: number;

  hi6?: number;
  lo6?: number;

  bias: Bias;
  vwapAtrRatio?: number;
  ifvgGate: boolean;
  aboveHi: boolean;
  belowLo: boolean;

  sell: boolean;
  buy: boolean;

  entry?: number;
  stop?: number;
  target?: number;
  stopSize?: number;
  stopShrink?: 0.5 | 0.7 | 1;
}

/**
 * knowledge/vwap-band-reversal-ict.md, architecture/vwap-band-reversal-plugin.md §2.3-§2.4 —
 * pure function of the two candle windows and the clock: no I/O, no state. `mainWindow` (M) is
 * `bars.filter(now-12h <= openTime <= now)`; `biasWindow` (B) is
 * `bars.filter(utcMidnight(now)+1min <= openTime <= now)` — both computed by the caller
 * (`vwap-band-reversal.strategy.ts`), never here.
 */
export function evaluate(
  mainWindow: readonly Candle[],
  biasWindow: readonly Candle[],
  now: number,
  params: EvaluateParams,
): Evaluation {
  const n = mainWindow.length;
  const nBias = biasWindow.length;

  // The VWAP band depends only on the bias window, so it is computed (and exposed) whenever B
  // is non-empty, independent of the main-window error state below — architecture note §2.6:
  // "indicator points are emitted on every closed bar where B is non-empty".
  const vwapBand = nBias > 0 ? computeVwapBand(biasWindow) : { nBias: 0 };

  // Researcher D-18 / §2.3: the bot crashes with an empty bias window (`VWAP([])` reads
  // `candles[0].openTime` of an empty array) or an empty main window (`range([], 200)` reads
  // `candles[-1].close`), and the unguarded 6-bar sweep loop indexes out of range when
  // `n < 6`. Any of these is "no mechanical trigger, no signal on that bar" — but the VWAP
  // band above is still exposed for the indicator.
  if (nBias === 0 || n < SWEEP_BARS) {
    return {
      n,
      err: true,
      inDiscount: false,
      bullOcc: false,
      bearOcc: false,
      nBullIfvg: 0,
      nBearIfvg: 0,
      hasIfvg: false,
      prevFound: false,
      nBias: vwapBand.nBias,
      vwap: vwapBand.vwap,
      vwapTop: vwapBand.vwapTop,
      vwapBottom: vwapBand.vwapBottom,
      bias: null,
      ifvgGate: false,
      aboveHi: false,
      belowLo: false,
      sell: false,
      buy: false,
    };
  }

  const range = computeRange(mainWindow, params.rangeBars);
  const fvg = computeFvg(mainWindow);
  const atr = computeAtr(mainWindow, params.atrBars);
  const prevHour = computePreviousHourLH(mainWindow, now);

  const lastOpen = mainWindow[n - 1].open;
  const bias: Bias =
    vwapBand.vwapTop !== undefined && lastOpen > vwapBand.vwapTop
      ? 'sell'
      : vwapBand.vwapBottom !== undefined && lastOpen < vwapBand.vwapBottom
        ? 'buy'
        : null;

  const vwapAtrRatio =
    vwapBand.vwapTop !== undefined && vwapBand.vwapBottom !== undefined && atr !== undefined
      ? (vwapBand.vwapTop - vwapBand.vwapBottom) / atr
      : undefined;

  const ifvgAtrRatio =
    atr !== undefined && fvg.ifvgHigh !== undefined && fvg.ifvgLow !== undefined
      ? atr / Math.abs(fvg.ifvgHigh - fvg.ifvgLow)
      : undefined;

  // §2.4: "rejects SMALL gaps; Infinity < 8 is false" — division by a zero-width gap yields
  // Infinity (or NaN if atr is also 0), both correctly failing the `<` comparison.
  const ifvgGate = fvg.hasIfvg && ifvgAtrRatio !== undefined && ifvgAtrRatio < params.maxIfvgToAtrRatio;

  const sweepBars = mainWindow.slice(n - SWEEP_BARS, n);
  const hi6 = Math.max(...sweepBars.map((b) => b.high));
  const lo6 = Math.min(...sweepBars.map((b) => b.low));

  const aboveHi = prevHour.prevFound && prevHour.prevHigh !== undefined && hi6 > prevHour.prevHigh;
  const belowLo = prevHour.prevFound && prevHour.prevLow !== undefined && lo6 < prevHour.prevLow;

  const common =
    vwapAtrRatio !== undefined &&
    vwapAtrRatio >= params.minVwapAtrRatio &&
    vwapAtrRatio <= params.maxVwapAtrRatio &&
    ifvgGate;

  const sell = common && fvg.bearOcc && !range.inDiscount && bias === 'sell' && aboveHi;
  const buy = common && fvg.bullOcc && range.inDiscount && bias === 'buy' && belowLo;

  const evaluation: Evaluation = {
    n,
    err: false,
    rangeTop: range.rangeTop,
    rangeBottom: range.rangeBottom,
    inDiscount: range.inDiscount,
    bullOcc: fvg.bullOcc,
    bearOcc: fvg.bearOcc,
    nBullIfvg: fvg.nBullIfvg,
    nBearIfvg: fvg.nBearIfvg,
    hasIfvg: fvg.hasIfvg,
    ifvgLow: fvg.ifvgLow,
    ifvgHigh: fvg.ifvgHigh,
    ifvgX: fvg.ifvgX,
    ifvgAtrRatio,
    atr,
    prevFound: prevHour.prevFound,
    prevHigh: prevHour.prevHigh,
    prevLow: prevHour.prevLow,
    prevWindowStart: prevHour.firstBarTime,
    nBias: vwapBand.nBias,
    vwap: vwapBand.vwap,
    vwapTop: vwapBand.vwapTop,
    vwapBottom: vwapBand.vwapBottom,
    hi6,
    lo6,
    bias,
    vwapAtrRatio,
    ifvgGate,
    aboveHi,
    belowLo,
    sell,
    buy,
  };

  if (!sell && !buy) return evaluation;

  // §2.4: entry/stop/target are only computed when a mechanical trigger fired. With n < 201
  // rangeTop/rangeBottom are undefined (the anchor), so the sell/buy trigger is still reported
  // true in the parity vector but no stop/target is computed — the caller must then emit no
  // Signal (the bot's `putOrder` "stop and target truthy" gate).
  const entry = mainWindow[n - 1].close;
  const anchor = sell ? range.rangeTop : range.rangeBottom;
  if (anchor === undefined || range.rangeTop === undefined || range.rangeBottom === undefined) {
    return { ...evaluation, entry };
  }

  const stopSize = Math.abs(anchor - entry);
  const rangeSize = Math.abs(range.rangeTop - range.rangeBottom);
  const ratio = stopSize === 0 ? Infinity : rangeSize / stopSize;
  const stopShrink: 0.5 | 0.7 | 1 = ratio < 2.5 ? 0.5 : ratio < 3 ? 0.7 : 1;
  const shrunkStopSize = stopSize * stopShrink;
  const stop = sell ? entry + shrunkStopSize : entry - shrunkStopSize;
  const lossWindow = sell ? stop - entry : entry - stop;
  const target = sell ? entry - params.targetRr * lossWindow : entry + params.targetRr * lossWindow;

  return { ...evaluation, entry, stop, target, stopSize: shrunkStopSize, stopShrink };
}
