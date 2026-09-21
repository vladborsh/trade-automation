import { Candle } from '@trade-automation/contracts';
import { KeyedSet } from './keyed-set';
import { IndicatorSeries } from './series';

interface Box {
  low: number;
  high: number;
  x: number;
}

/**
 * An iFVG list of the lifted `computeFvg`: its members in the order the lifted code appended them
 * (only the last one is ever read), plus a KeyedSet on the edge that prunes them.
 */
class InverseList {
  readonly set: KeyedSet;
  private readonly prev: Int32Array;
  private readonly next: Int32Array;
  private tail = -1;

  constructor(pruneKeys: ArrayLike<number>) {
    this.set = new KeyedSet(pruneKeys);
    this.prev = new Int32Array(pruneKeys.length).fill(-1);
    this.next = new Int32Array(pruneKeys.length).fill(-1);
  }

  append(id: number): void {
    this.set.insert(id);
    this.prev[id] = this.tail;
    if (this.tail >= 0) this.next[this.tail] = id;
    this.tail = id;
  }

  prune(lo: number, hi: number): void {
    for (const id of this.set.takeBetween(lo, hi)) {
      const p = this.prev[id];
      const nx = this.next[id];
      if (p >= 0) this.next[p] = nx;
      if (nx >= 0) this.prev[nx] = p;
      else this.tail = p;
    }
  }

  /** The id the lifted list would hold last, or -1 when empty. */
  last(): number {
    return this.tail;
  }
}

/**
 * T-034 — the series form of the lifted `computeFvg` (fvg.ts, unchanged): the value at bar i is the
 * last inverse FVG (`ifvgHigh` / `ifvgLow`) of `computeFvg(bars[0..i])`, or no point when
 * `hasIfvg` is false. Every lifted rule is kept: detection from bar 3 against bar i − 2, inversion
 * through the proximal edge, iFVG pruning, and the Researcher D-03 asymmetry of `lastIfvg`. With
 * D-03, an empty bullish-iFVG list means no point, whatever the bearish one holds.
 *
 * **How a set of boxes maps to a line series:** the lifted function reports one box, the latest
 * iFVG, and that is what the plug-in's gate reads. So the series is that box's top and bottom per
 * bar: two lines that step whenever the latest iFVG changes. Drawing every live box as a rectangle
 * would need a box style that `IndicatorSeriesSpec` does not have (a contract proposal, not done
 * here). The plug-in runs this on its 12 h main window rather than the whole history, so an iFVG
 * older than 12 h can differ from what the plug-in sees.
 *
 * O(n log n): detection does not depend on state, so every box is known before the scan, and the
 * four lists live in KeyedSets. Each inversion or prune removes exactly the live boxes whose edge
 * lies strictly between the bar's open and close. The lifted loop filters every live box on every
 * bar. Output series: `high`, `low`.
 */
export function ifvgSeries(bars: readonly Candle[]): IndicatorSeries<'high' | 'low'> {
  const high: IndicatorSeries['high'] = [];
  const low: IndicatorSeries['low'] = [];

  // Every box, in detection (x) order, as `detect` in fvg.ts: bullish if close > open[i−2] and
  // low > high[i−2]; bearish if close < open[i−2] and high < low[i−2].
  const bull: Box[] = [];
  const bear: Box[] = [];
  const bullAt = new Int32Array(bars.length).fill(-1);
  const bearAt = new Int32Array(bars.length).fill(-1);
  for (let i = 3; i < bars.length; i++) {
    const current = bars[i];
    const prev = bars[i - 2];
    if (current.close > prev.open && current.low > prev.high) bullAt[i] = bull.push({ low: prev.high, high: current.low, x: i }) - 1;
    if (current.close < prev.open && current.high < prev.low) bearAt[i] = bear.push({ low: current.high, high: prev.low, x: i }) - 1;
  }

  // Live FVGs: a bullish one inverts when open > low > close; a bearish one when open < high < close.
  const bullFvg = new KeyedSet(bull.map((b) => b.low));
  const bearFvg = new KeyedSet(bear.map((b) => b.high));
  // bullishIFvg holds inverted bearish boxes, pruned when open > low > close; bearishIFvg holds
  // inverted bullish boxes, pruned when open < high < close.
  const bullishIFvg = new InverseList(bear.map((b) => b.low));
  const bearishIFvg = new InverseList(bull.map((b) => b.high));

  for (let i = 3; i < bars.length; i++) {
    if (bullAt[i] >= 0) bullFvg.insert(bullAt[i]);
    if (bearAt[i] >= 0) bearFvg.insert(bearAt[i]);
    const { open, close } = bars[i];

    for (const id of bullFvg.takeBetween(close, open)) bearishIFvg.append(id);
    for (const id of bearFvg.takeBetween(open, close)) bullishIFvg.append(id);
    bullishIFvg.prune(close, open);
    bearishIFvg.prune(open, close);

    const box = lastIfvg(bullishIFvg.last(), bearishIFvg.last(), bear, bull);
    if (!box) continue;
    high.push({ time: bars[i].openTime, value: box.high });
    low.push({ time: bars[i].openTime, value: box.low });
  }
  return { high, low };
}

/** fvg.ts `lastIfvg`, Researcher D-03 included: no bullish iFVG → none; ties go to the bearish one. */
function lastIfvg(bullishId: number, bearishId: number, bear: readonly Box[], bull: readonly Box[]): Box | undefined {
  if (bullishId < 0) return undefined;
  const bullish = bear[bullishId];
  if (bearishId < 0) return bullish;
  const bearish = bull[bearishId];
  return bullish.x > bearish.x ? bullish : bearish;
}
