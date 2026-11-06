import type { EconomicEvent } from '@trade-automation/contracts';
import type { IChartApi } from 'lightweight-charts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarMark } from './calendar-marks';
import { ChartOverlays, badgeBox, type BadgePick } from './chart-overlays';

/** IB-099 item 1 — the badge is a real target: ≥ 24 px on a desktop, ≥ 40 px on a phone. */
describe('badgeBox', () => {
  it('desktop: 24 px, centred on the line, its bottom on the price pane\'s bottom', () => {
    expect(badgeBox(300, 400, 1100)).toEqual({ left: 288, top: 374, size: 24 });
  });
  it('a phone-width chart: 40 px', () => {
    expect(badgeBox(100, 300, 358)).toEqual({ left: 80, top: 258, size: 40 });
  });
  it('a container not laid out yet (width 0) gets the desktop size, not a zero-size target', () => {
    expect(badgeBox(0, 100, 0).size).toBe(24);
  });
});

function ev(over: Partial<EconomicEvent>): EconomicEvent {
  return {
    id: 'ff:1:2026-10-28', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
    country: 'USD', impact: 'high', scheduledAt: 1_793_190_600_000, scheduledDay: '2026-10-28',
    forecast: '0.3%', previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'scheduled',
    firstSeenAt: 0, lastSeenAt: 0, revision: 1, ...over,
  };
}

/**
 * IB-BUG-050 — the overlays on a real (unit) DOM over a stub chart whose x follows a scroll offset,
 * so a re-place is visible. The unit DOM does not turn a press and a release into a click (the
 * browser does: the e2e «IB-BUG-050» proves the tap); here the cause is pinned — whether the button
 * under the press is still the button in the layer after a live-tail update.
 */
describe('ChartOverlays — the calendar badges across updates', () => {
  let container: HTMLElement;
  let scroll: number;
  let picks: Array<BadgePick | null>;
  let overlays: ChartOverlays;
  const chart = {
    panes: () => [{ getHeight: () => 400 }],
    timeScale: () => ({
      timeToCoordinate: (t: number) => t - scroll,
      subscribeVisibleTimeRangeChange: () => undefined,
      unsubscribeVisibleTimeRangeChange: () => undefined,
    }),
  } as unknown as IChartApi;
  const marks = (): CalendarMark[] => [{ time: 300, events: [ev({})] }, { time: 600, events: [ev({ id: 'b', title: 'NFP' })] }];
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('.calendar-badge')];

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1100 });
    document.body.appendChild(container);
    scroll = 0;
    picks = [];
    overlays = new ChartOverlays(chart, container, { focus: null, focusLabel: '', marks: marks(), onBadge: (p) => picks.push(p) });
  });
  afterEach(() => { overlays.destroy(); container.remove(); });

  it('an answer with the same marks keeps the very buttons (a press on one is released on it) and still re-places them', () => {
    const before = buttons();
    scroll = 100;
    overlays.update(marks()); // equal, not identical: a fresh answer
    expect(buttons()).toHaveLength(2);
    expect(buttons().every((b, i) => b === before[i])).toBe(true);
    expect(before.every((b) => b.isConnected)).toBe(true);
    expect(buttons()[0].style.left).toBe(`${300 - 100 - 12}px`);
  });

  it('a pin survives same-mark answers, and the next click on the same button unpins', () => {
    buttons()[1].click();
    expect(picks.at(-1)).toEqual({ time: 600, x: 600 });
    overlays.update(marks());
    overlays.update(marks());
    buttons()[1].click();
    expect(picks.at(-1)).toBeNull();
  });

  it('changed marks rebuild the buttons; the pin follows its bar while it has a mark', () => {
    buttons()[1].click();
    const before = buttons();
    overlays.update([...marks(), { time: 900, events: [ev({ id: 'c', title: 'GDP' })] }]);
    expect(buttons()).toHaveLength(3);
    expect(buttons()[0]).not.toBe(before[0]);
    expect(picks.at(-1)).toEqual({ time: 600, x: 600 }); // nothing re-emitted: still pinned
    buttons()[1].click(); // the new button on the pinned bar unpins it
    expect(picks.at(-1)).toBeNull();
  });

  it('when the pinned bar loses its mark the pin is dropped (tooltip closed) and hover works again', () => {
    buttons()[1].click();
    overlays.update([marks()[0]]);
    expect(picks.at(-1)).toBeNull();
    buttons()[0].dispatchEvent(new MouseEvent('mouseenter'));
    expect(picks.at(-1)).toEqual({ time: 300, x: 300 });
  });
});
