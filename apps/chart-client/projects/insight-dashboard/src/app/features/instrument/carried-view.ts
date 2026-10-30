import type { IChartApi, Time } from 'lightweight-charts';
import type { PaneData } from './pane-data';
import { windowBounds } from './panels.model';
import { chartTimes } from './time-axis-strip';

/**
 * The reader's view as the library itself holds it: pixels per bar, and how many bars the right
 * edge of the plot sits past the last bar (`scrollPosition`; negative when scrolled back).
 *
 * Not a logical range. IB-066 found that restoring a logical range onto a freshly created chart
 * zooms in by the price scale's width on every redraw: the library turns the range into a bar
 * spacing over a plot that does not yet have its price scale, then keeps the spacing and the right
 * edge when the scale appears, so the range loses ~7 % from the left. Every 5 s, that was a day's
 * view shrinking to hours in a minute. Bar spacing and the right offset do not depend on the width.
 */
export interface ChartView {
  barSpacing: number;
  rightOffset: number;
}

/**
 * How far back from the last bar the view's right edge may be for the reader to count as "at the
 * right edge", in bars: the last bar just inside the edge still counts; a bar and a half further
 * back is a choice to look at history.
 */
export const RIGHT_EDGE_BARS = 1.5;

/**
 * The reader's view across a redraw, or null when the redraw should show the whole window (a
 * fresh load).
 *
 * - **Earlier history joined on** (`extendsPrevious`): bars arrive on the left, so the same right
 *   offset keeps the same bars on screen, and a reader who dragged into the empty space past the
 *   oldest bar sees the new bars fill it.
 * - **The live tail joined on** (`extendsLater`, IB-066): a reader at the right edge is FOLLOWING —
 *   the same offset from the last bar brings each new bar into view at the same zoom. A reader who
 *   scrolled back keeps exactly what they were looking at: the offset moves back by the slots
 *   added after the old last one.
 *
 * `before` and `after` are the chart's slot times (`chartTimes`) before and after the redraw.
 */
export function carriedView(
  data: Pick<PaneData, 'extendsPrevious' | 'extendsLater'>,
  view: ChartView | null,
  before: readonly number[],
  after: readonly number[],
): ChartView | null {
  if (!view || before.length === 0 || !(data.extendsPrevious || data.extendsLater)) return null;
  if (!data.extendsLater || atRightEdge(view)) return view;
  const last = before[before.length - 1];
  let added = 0;
  for (let i = after.length - 1; i >= 0 && after[i] > last; i--) added++;
  return { ...view, rightOffset: view.rightOffset - added };
}

export function atRightEdge(view: ChartView): boolean {
  return view.rightOffset >= -RIGHT_EDGE_BARS;
}

/** The view of a drawn chart; null before it has a range. */
export function readView(chart: IChartApi): ChartView | null {
  const scale = chart.timeScale();
  const range = scale.getVisibleLogicalRange();
  if (!range || range.to <= range.from || scale.width() <= 0) return null;
  return { barSpacing: scale.width() / (range.to - range.from), rightOffset: scale.scrollPosition() };
}

/**
 * Puts the view on a freshly drawn `chart`: the carried one, else the whole window. `view` and
 * `before` are the previous chart's, read before it was torn down.
 */
export function showView(chart: IChartApi, data: PaneData, view: ChartView | null, before: readonly number[]): void {
  const carried = carriedView(data, view, before, chartTimes(chart));
  const bounds = windowBounds(data);
  if (carried) {
    chart.timeScale().applyOptions({ barSpacing: carried.barSpacing });
    chart.timeScale().scrollToPosition(carried.rightOffset, false);
  } else if (bounds) chart.timeScale().setVisibleRange({ from: bounds.from as Time, to: bounds.to as Time });
}
