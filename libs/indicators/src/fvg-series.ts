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
  /** T-057: the bar each member inverted (joined the list) and was pruned at; -1 until then. */
  readonly invertedAt: Int32Array;
  readonly prunedAt: Int32Array;

  constructor(pruneKeys: ArrayLike<number>) {
    this.set = new KeyedSet(pruneKeys);
    this.prev = new Int32Array(pruneKeys.length).fill(-1);
    this.next = new Int32Array(pruneKeys.length).fill(-1);
    this.invertedAt = new Int32Array(pruneKeys.length).fill(-1);
    this.prunedAt = new Int32Array(pruneKeys.length).fill(-1);
  }

  append(id: number, bar: number): void {
    this.set.insert(id);
    this.invertedAt[id] = bar;
    this.prev[id] = this.tail;
    if (this.tail >= 0) this.next[this.tail] = id;
    this.tail = id;
  }

  prune(lo: number, hi: number, bar: number): void {
    for (const id of this.set.takeBetween(lo, hi)) {
      this.prunedAt[id] = bar;
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
 * bar: two lines that step whenever the latest iFVG changes. Every box as a rectangle is
 * `ifvgBoxes` below (T-057), which the catalogue's `fvg` entry draws. The plug-in runs this on its 12 h main window rather than the whole history, so an iFVG
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
  scanIfvg(bars, (i, bullishIFvg, bearishIFvg, bear, bull) => {
    const box = lastIfvg(bullishIFvg.last(), bearishIFvg.last(), bear, bull);
    if (!box) return;
    high.push({ time: bars[i].openTime, value: box.high });
    low.push({ time: bars[i].openTime, value: box.low });
  });
  return { high, low };
}

/** T-057: one inverse FVG over its life, for drawing as a box. */
export interface IfvgBox {
  /** `openTime` of the gap's first bar (i − 2) — where the box starts on the chart. */
  from: number;
  /** `openTime` of the bar that pruned it, or of the last bar while it is still live. */
  to: number;
  top: number;
  bottom: number;
  /** `bullish`: an inverted bearish gap (now support); `bearish`: an inverted bullish gap (resistance). */
  side: 'bullish' | 'bearish';
  /** Not pruned by the last bar. */
  live: boolean;
}

/**
 * T-057 — every inverse FVG of `bars`, not only the latest: each gap that inverted, from its first
 * bar to the bar that pruned it (or the last bar if it is still live), with its edges. Same scan and
 * rules as `ifvgSeries` (detection, inversion through the proximal edge, pruning); D-03 is about
 * which box is *latest* and does not apply here. Ordered by inversion bar, then side.
 */
export function ifvgBoxes(bars: readonly Candle[]): IfvgBox[] {
  const out: Array<IfvgBox & { at: number }> = [];
  scanIfvg(bars, (i, bullishIFvg, bearishIFvg, bear, bull) => {
    if (i !== bars.length - 1) return;
    const last = bars[i].openTime;
    const collect = (list: InverseList, boxes: readonly Box[], side: IfvgBox['side']) => {
      boxes.forEach((b, id) => {
        const at = list.invertedAt[id];
        if (at < 0) return;
        const pruned = list.prunedAt[id];
        out.push({ at, from: bars[b.x - 2].openTime, to: pruned >= 0 ? bars[pruned].openTime : last, top: b.high, bottom: b.low, side, live: pruned < 0 });
      });
    };
    collect(bullishIFvg, bear, 'bullish');
    collect(bearishIFvg, bull, 'bearish');
  });
  return out.sort((a, b) => a.at - b.at || (a.side < b.side ? -1 : 1)).map(({ at: _at, ...box }) => box);
}

type OnBar = (i: number, bullishIFvg: InverseList, bearishIFvg: InverseList, bear: readonly Box[], bull: readonly Box[]) => void;

/** The shared scan of the lifted `computeFvg`, calling `onBar` after each bar from 3 on. */
function scanIfvg(bars: readonly Candle[], onBar: OnBar): void {
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

    for (const id of bullFvg.takeBetween(close, open)) bearishIFvg.append(id, i);
    for (const id of bearFvg.takeBetween(open, close)) bullishIFvg.append(id, i);
    bullishIFvg.prune(close, open, i);
    bearishIFvg.prune(open, close, i);

    onBar(i, bullishIFvg, bearishIFvg, bear, bull);
  }
}

/** fvg.ts `lastIfvg`, Researcher D-03 included: no bullish iFVG → none; ties go to the bearish one. */
function lastIfvg(bullishId: number, bearishId: number, bear: readonly Box[], bull: readonly Box[]): Box | undefined {
  if (bullishId < 0) return undefined;
  const bullish = bear[bullishId];
  if (bearishId < 0) return bullish;
  const bearish = bull[bearishId];
  return bullish.x > bearish.x ? bullish : bearish;
}
