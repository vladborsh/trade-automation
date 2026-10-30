import type { IChartApi, LogicalRange, Time } from 'lightweight-charts';
import type { PaneData } from './pane-data';
import { windowBounds } from './panels.model';
import { chartTimes, shiftedView } from './time-axis-strip';

/**
 * How close to the last bar the view's right edge must be for the reader to count as "at the right
 * edge", in bars. The library's own right offset and a reader who scrolled the last bar to just
 * inside the edge both count; a bar and a half further back is a choice to look at history.
 */
export const RIGHT_EDGE_BARS = 1.5;

/**
 * The reader's view across a redraw, or null when the redraw should show the whole window (a
 * fresh load). Logical ranges, not times, for `shiftedView`'s reason: a view over empty space on
 * either side cannot be said in times.
 *
 * - **Earlier history joined on** (`extendsPrevious`): the view shifts right by the slots added
 *   before it, so the same bars stay on screen (`shiftedView`).
 * - **The live tail joined on** (`extendsLater`, IB-066): a reader at the right edge is FOLLOWING —
 *   the view moves right by the slots added after the old last bar, so the new bar comes into view
 *   and the zoom is kept. A reader who scrolled back keeps exactly what they were looking at.
 *
 * `before` and `after` are the chart's slot times (`chartTimes`) before and after the redraw.
 */
export function carriedView(
  data: Pick<PaneData, 'extendsPrevious' | 'extendsLater'>,
  view: LogicalRange | null,
  before: readonly number[],
  after: readonly number[],
): LogicalRange | null {
  if (!view || before.length === 0 || !(data.extendsPrevious || data.extendsLater)) return null;
  const kept = shiftedView(view, before[0], after);
  if (!data.extendsLater || !atRightEdge(view, before.length)) return kept;
  const last = before[before.length - 1];
  let added = 0;
  for (let i = after.length - 1; i >= 0 && after[i] > last; i--) added++;
  return { from: (kept.from + added) as LogicalRange['from'], to: (kept.to + added) as LogicalRange['to'] };
}

/** True when the view reaches the last of `slots` slots, within `RIGHT_EDGE_BARS`. */
export function atRightEdge(view: LogicalRange, slots: number): boolean {
  return view.to >= slots - 1 - RIGHT_EDGE_BARS;
}

/**
 * Puts the view on a freshly drawn `chart`: the carried one, else the whole window. `view` and
 * `before` are the previous chart's, read before it was torn down.
 */
export function showView(chart: IChartApi, data: PaneData, view: LogicalRange | null, before: readonly number[]): void {
  const carried = carriedView(data, view, before, chartTimes(chart));
  const bounds = windowBounds(data);
  if (carried) chart.timeScale().setVisibleLogicalRange(carried);
  else if (bounds) chart.timeScale().setVisibleRange({ from: bounds.from as Time, to: bounds.to as Time });
}
