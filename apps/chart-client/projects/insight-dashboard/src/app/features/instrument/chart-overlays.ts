import type { IChartApi, Time } from 'lightweight-charts';
import type { CalendarMark } from './calendar-marks';
import { pinAfter, sameBadges } from './calendar-badge-key';
import { flagFor } from './calendar-flags';
import type { FocusView } from './focus-at';
import { FocusMarker } from './focus-marker';

/**
 * The HTML laid over the instrument chart that must follow the library's coordinates: IB-098's
 * focus marker and IB-099's calendar badges. One owner, so the chart component creates, re-places
 * and destroys them with one call each (and stays under the AGENTS.md ceiling).
 */

/** The badge's box: ≥ 24 px on a desktop, ≥ 40 px on a phone (IB-088's touch rule), its bottom on the price pane's bottom. */
export function badgeBox(x: number, paneHeight: number, containerWidth: number): { left: number; top: number; size: number } {
  const size = containerWidth > 0 && containerWidth < 768 ? 40 : 24;
  return { left: Math.round(x - size / 2), top: Math.round(paneHeight - size - 2), size };
}

export interface BadgePick {
  time: number;
  x: number;
}

/**
 * IB-099 item 1 — a round flag at the bottom of each economic-event line: the line is 1 px and
 * was hard to hit, the badge is the target. Click (tap) pins the existing tooltip, click again
 * unpins; on a desktop hovering shows it too.
 */
class CalendarBadges {
  private readonly layer: HTMLDivElement;
  private marks: readonly CalendarMark[] = [];
  private pinned: number | null = null;

  constructor(
    private readonly chart: IChartApi,
    private readonly container: HTMLElement,
    private readonly onPick: (pick: BadgePick | null) => void,
  ) {
    this.layer = container.ownerDocument.createElement('div');
    this.layer.className = 'calendar-badges';
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '4' });
    container.appendChild(this.layer);
  }

  /** IB-BUG-050: the buttons are built again only when the badges differ (`sameBadges`), never under a tap. */
  update(marks: readonly CalendarMark[]): void {
    const rebuild = !sameBadges(this.marks, marks);
    this.marks = marks;
    if (rebuild) {
      this.layer.replaceChildren(...marks.map((m) => this.badge(m)));
      const pin = pinAfter(this.pinned, marks);
      if (pin !== this.pinned) {
        this.pinned = pin;
        this.onPick(null); // its mark is gone: the tooltip goes with it, and hover works again
      }
    }
    this.place();
  }

  place(): void {
    const paneHeight = this.chart.panes()[0]?.getHeight() ?? 0;
    const width = this.container.clientWidth;
    this.marks.forEach((m, i) => {
      const el = this.layer.children[i] as HTMLElement | undefined;
      if (!el) return;
      const x = this.chart.timeScale().timeToCoordinate(m.time as Time);
      const box = x === null ? null : badgeBox(x, paneHeight, width);
      const visible = box !== null && x! >= 0 && x! <= width;
      el.style.display = visible ? 'block' : 'none';
      if (box) Object.assign(el.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.size}px`, height: `${box.size}px` });
    });
  }

  destroy(): void {
    this.layer.remove();
  }

  private badge(m: CalendarMark): HTMLButtonElement {
    const el = this.container.ownerDocument.createElement('button');
    el.type = 'button';
    el.className = 'calendar-badge';
    el.setAttribute('data-time', String(m.time));
    el.setAttribute('aria-label', m.events.map((e) => e.title).join(' · '));
    const country = m.events[0]?.country ?? '';
    const flag = flagFor(country);
    if (flag) el.innerHTML = flag; // our own constant SVG, not feed content
    else el.textContent = country;
    Object.assign(el.style, {
      position: 'absolute', padding: '0', border: '2px solid #d2a8ff', borderRadius: '50%', overflow: 'hidden',
      background: '#0d1117', color: '#c9d1d9', fontSize: '10px', cursor: 'pointer', pointerEvents: 'auto',
    });
    const at = () => ({ time: m.time, x: this.chart.timeScale().timeToCoordinate(m.time as Time) ?? 0 });
    el.addEventListener('mouseenter', () => { if (this.pinned === null) this.onPick(at()); });
    el.addEventListener('mouseleave', () => { if (this.pinned === null) this.onPick(null); });
    el.addEventListener('click', () => {
      this.pinned = this.pinned === m.time ? null : m.time;
      this.onPick(this.pinned === null ? null : at());
    });
    return el;
  }
}

export class ChartOverlays {
  private readonly marker: FocusMarker | null;
  private readonly badges: CalendarBadges;
  private readonly onRange = () => this.place();

  constructor(
    private readonly chart: IChartApi,
    container: HTMLElement,
    opts: { focus: FocusView | null; focusLabel: string; marks: readonly CalendarMark[]; onBadge: (pick: BadgePick | null) => void },
  ) {
    this.marker = opts.focus ? new FocusMarker(chart, container, opts.focus, opts.focusLabel) : null;
    this.badges = new CalendarBadges(chart, container, opts.onBadge);
    this.badges.update(opts.marks);
    chart.timeScale().subscribeVisibleTimeRangeChange(this.onRange);
  }

  /** New data on the same chart (the live tail, earlier history): the marks may have changed. */
  update(marks: readonly CalendarMark[]): void {
    this.badges.update(marks);
    this.marker?.place();
  }

  place(): void {
    this.marker?.place();
    this.badges.place();
  }

  destroy(): void {
    this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this.onRange);
    this.marker?.destroy();
    this.badges.destroy();
  }
}
