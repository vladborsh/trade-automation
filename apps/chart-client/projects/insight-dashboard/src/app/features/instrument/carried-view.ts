import type { IChartApi } from 'lightweight-charts';
import type { PaneData } from './pane-data';
import { chartTimes } from './time-axis-strip';

/**
 * IB-066 — the reader's view across data that extends what is on screen (the live tail every 5 s,
 * an earlier window after scrolling left).
 *
 * Such data is drawn on the SAME chart (`redrawPanels`), so the zoom is never touched: only the
 * scroll is decided here, as the library's right offset — how many bars the right edge of the
 * plot sits past the last bar (negative when scrolled back). Not a logical range: a range means
 * something only with the plot's width, and restoring one onto a freshly created chart (which has
 * no price scale yet) zoomed in by ~7 % per redraw — a day's 1m view became hours in a minute, the
 * first live run of IB-066. An offset in bars is the same at any width.
 */

/**
 * How far back from the last bar the view's right edge may be for the reader to count as "at the
 * right edge", in bars: the last bar just inside the edge still counts; a bar and a half further
 * back is a choice to look at history.
 */
export const RIGHT_EDGE_BARS = 1.5;

export function atRightEdge(rightOffset: number): boolean {
  return rightOffset >= -RIGHT_EDGE_BARS;
}

/**
 * The right offset to keep after the redraw.
 * - **Earlier history** (`extendsPrevious`) arrives on the left: the offset from the last bar is
 *   unchanged, so the same bars stay on screen.
 * - **The live tail** (`extendsLater`): a reader at the right edge is FOLLOWING — the same offset
 *   from the newest bar brings each new bar into view.
 * - **IB-067's future whitespace changes none of this.** The library counts `scrollPosition` from
 *   the last bar WITH DATA, and `series.data()` (so `chartTimes`) leaves whitespace out: checked in
 *   the browser on 15m with 162 future slots — 672 data items, the last a real candle, and
 *   `scrollPosition()` 162 with the whole window and the future on screen. So "the right edge" is
 *   already the last real candle, and a candle taking a whitespace slot is one slot added after it. A reader who scrolled back keeps exactly
 *   what they were looking at: the offset moves back by the slots added after the old last one.
 *
 * `before` and `after` are the chart's slot times (`chartTimes`) before and after the redraw.
 */
export function carriedOffset(
  data: Pick<PaneData, 'extendsLater'>,
  rightOffset: number,
  before: readonly number[],
  after: readonly number[],
): number {
  if (!data.extendsLater || atRightEdge(rightOffset) || before.length === 0) return rightOffset;
  const last = before[before.length - 1];
  let added = 0;
  for (let i = after.length - 1; i >= 0 && after[i] > last; i--) added++;
  return rightOffset - added;
}

/** Runs `redraw` on `chart` and puts the scroll where `carriedOffset` says. */
export function keepView(chart: IChartApi, data: PaneData, redraw: () => void): void {
  const before = chartTimes(chart);
  const offset = chart.timeScale().scrollPosition();
  redraw();
  chart.timeScale().scrollToPosition(carriedOffset(data, offset, before, chartTimes(chart)), false);
}
