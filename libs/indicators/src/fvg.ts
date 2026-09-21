import { Candle } from '@trade-automation/contracts';

export interface FvgBox {
  low: number;
  high: number;
  x: number; // window index into the `bars` array passed to computeFvg — not a timestamp
}

export interface FvgResult {
  bullOcc: boolean; // bullishIfvgOccurs: a bearish FVG was inverted by the last bar
  bearOcc: boolean; // bearishIfvgOccurs: a bullish FVG was inverted by the last bar
  nBullIfvg: number;
  nBearIfvg: number;
  hasIfvg: boolean;
  ifvgLow?: number;
  ifvgHigh?: number;
  ifvgX?: number;
}

function detect(i: number, current: Candle, prev: Candle): { bullish: FvgBox | null; bearish: FvgBox | null } {
  let bullish: FvgBox | null = null;
  let bearish: FvgBox | null = null;

  if (current.close > prev.open && current.low > prev.high) {
    bullish = { low: prev.high, high: current.low, x: i };
  }
  if (current.close < prev.open && current.high < prev.low) {
    bearish = { low: current.high, high: prev.low, x: i };
  }
  return { bullish, bearish };
}

function filterFvgArrays(open: number, close: number, bullish: FvgBox[], bearish: FvgBox[]) {
  const newBullish: FvgBox[] = [];
  const newBearish: FvgBox[] = [];
  const newInverseBearish: FvgBox[] = []; // a bullish FVG got inverted -> a bearish signal
  const newInverseBullish: FvgBox[] = []; // a bearish FVG got inverted -> a bullish signal
  let bullishInverted = false; // isLastCandleDiscardBullishFvg
  let bearishInverted = false; // isLastCandleDiscardBearishFvg

  for (const box of bullish) {
    if (!(open > box.low && close < box.low)) {
      newBullish.push(box);
    } else {
      bullishInverted = true;
      newInverseBearish.push(box);
    }
  }
  for (const box of bearish) {
    if (!(open < box.high && close > box.high)) {
      newBearish.push(box);
    } else {
      bearishInverted = true;
      newInverseBullish.push(box);
    }
  }

  return { newBullish, newBearish, newInverseBearish, newInverseBullish, bullishInverted, bearishInverted };
}

function filterInverseFvgArrays(open: number, close: number, bullishInverse: FvgBox[], bearishInverse: FvgBox[]) {
  const newInverseBullish = bullishInverse.filter((box) => !(open > box.low && close < box.low));
  const newInverseBearish = bearishInverse.filter((box) => !(open < box.high && close > box.high));
  return { newInverseBullish, newInverseBearish };
}

/** Researcher D-03: bug-faithful — see the module doc for why this is asymmetric on purpose. */
function lastIfvg(bullish: FvgBox[], bearish: FvgBox[]): FvgBox | undefined {
  if (bullish.length === 0) {
    // bullishIFvgArray.length - 1 === -1, so this indexes bearish[-1], which is always
    // undefined in JS regardless of the bearish list's contents. Do not "fix" this to
    // `bearish[bearish.length - 1]` — it changes the mechanic's behaviour and breaks parity.
    return bearish[bullish.length - 1];
  }
  if (bearish.length === 0) {
    return bullish[bullish.length - 1];
  }
  return bullish[bullish.length - 1].x > bearish[bearish.length - 1].x
    ? bullish[bullish.length - 1]
    : bearish[bearish.length - 1];
}

/**
 * knowledge/vwap-band-reversal-ict.md §3 (cmc-bot-main's calculateFVG + fvg-element.ts) — run
 * directly on the main window `bars` (the plugin's M), matching `smart-money-ict.md` §1's
 * 3-candle FVG detection with inversion through the gap's *proximal* edge. `x` is the bot's
 * window index, not a timestamp; the caller converts to `openTime` when drawing.
 *
 * Researcher D-03: `lastIfvg`'s asymmetry (bullish list empty -> undefined, regardless of the
 * bearish list; bearish list empty -> the last bullish entry; both non-empty -> larger `x`,
 * tie -> bearish) is intentional and pinned by a unit test — it is how the bot actually
 * behaves, not a bug to fix here.
 */
export function computeFvg(bars: readonly Candle[]): FvgResult {
  let bullishFvg: FvgBox[] = [];
  let bearishFvg: FvgBox[] = [];
  let bullishIFvg: FvgBox[] = [];
  let bearishIFvg: FvgBox[] = [];
  let bullOcc = false;
  let bearOcc = false;

  for (let i = 0; i < bars.length; i++) {
    if (i <= 2) continue;

    const { bullish, bearish } = detect(i, bars[i], bars[i - 2]);
    if (bullish) bullishFvg.push(bullish);
    if (bearish) bearishFvg.push(bearish);

    const { open, close } = bars[i];
    const processed = filterFvgArrays(open, close, bullishFvg, bearishFvg);
    bullishFvg = processed.newBullish;
    bearishFvg = processed.newBearish;
    bullishIFvg = [...bullishIFvg, ...processed.newInverseBullish];
    bearishIFvg = [...bearishIFvg, ...processed.newInverseBearish];

    const pruned = filterInverseFvgArrays(open, close, bullishIFvg, bearishIFvg);
    bullishIFvg = pruned.newInverseBullish;
    bearishIFvg = pruned.newInverseBearish;

    if (i === bars.length - 1) {
      bullOcc = processed.bearishInverted;
      bearOcc = processed.bullishInverted;
    }
  }

  const last = lastIfvg(bullishIFvg, bearishIFvg);
  return {
    bullOcc,
    bearOcc,
    nBullIfvg: bullishIFvg.length,
    nBearIfvg: bearishIFvg.length,
    hasIfvg: last !== undefined,
    ifvgLow: last?.low,
    ifvgHigh: last?.high,
    ifvgX: last?.x,
  };
}
