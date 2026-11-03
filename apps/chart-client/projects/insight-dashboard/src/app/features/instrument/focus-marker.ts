import type { IChartApi, Time } from 'lightweight-charts';
import { barAtOrBefore, type FocusView } from './focus-at';
import { chartTimes } from './time-axis-strip';

/**
 * IB-098 — opens a fresh chart on the linked moment and marks it: a dashed vertical line across
 * every pane with a label at the bottom (the top row is the price legend). HTML over the chart (like the legends), placed from the
 * library's own coordinate for the bar, and re-placed on every scroll, zoom and resize — the
 * library has no cross-pane vertical line. Not a component: it owns one element and a
 * subscription, and dies with the chart.
 */
export class FocusMarker {
  private readonly line: HTMLDivElement;
  private readonly onRange = () => this.place();

  constructor(
    private readonly chart: IChartApi,
    private readonly container: HTMLElement,
    private readonly view: FocusView,
    label: string,
  ) {
    this.line = container.ownerDocument.createElement('div');
    this.line.className = 'focus-marker';
    this.line.setAttribute('data-at', String(view.atSec));
    // inline: the element is made here, outside Angular's scoped styles (palette: AGENTS.md amber)
    Object.assign(this.line.style, {
      position: 'absolute', top: '0', bottom: '0', width: '0', zIndex: '3', pointerEvents: 'none',
      borderLeft: '1px dashed #d29922',
    });
    const tag = container.ownerDocument.createElement('span');
    tag.textContent = label;
    Object.assign(tag.style, {
      position: 'absolute', bottom: '4px', left: '4px', whiteSpace: 'nowrap', fontSize: '12px',
      color: '#0d1117', background: '#d29922', padding: '1px 4px',
    });
    this.line.appendChild(tag);
    container.appendChild(this.line);
    chart.timeScale().subscribeVisibleTimeRangeChange(this.onRange);
    this.place();
  }

  /** The first view: the moment's range instead of the whole window. */
  static open(chart: IChartApi, view: FocusView): void {
    chart.timeScale().setVisibleRange({ from: view.from as Time, to: view.to as Time });
  }

  /** At the drawn bar at or before the moment; hidden while that bar is scrolled off screen. */
  place(): void {
    const bar = barAtOrBefore(chartTimes(this.chart), this.view.atSec);
    const x = bar === null ? null : this.chart.timeScale().timeToCoordinate(bar as Time);
    // the container's width, not timeScale().width(): this chart's own time axis is hidden (the
    // sticky strip draws it), and a hidden axis reports width 0 — the marker never showed live
    const width = this.container.clientWidth;
    const visible = x !== null && x >= 0 && x <= width;
    this.line.style.display = visible ? 'block' : 'none';
    if (visible) this.line.style.left = `${Math.round(x)}px`;
  }

  destroy(): void {
    this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this.onRange);
    this.line.remove();
  }
}
