import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_SLOP, QuadrantGestures, type QuadrantGestureHandlers } from './quadrant-gestures';

/**
 * IB-137 — the gestures on synthetic events (the unit DOM has neither TouchEvent nor PointerEvent,
 * so the fields the class reads are set by hand). The real pinch/swipe runs in the e2e.
 */
function ev(type: string, fields: Record<string, unknown>): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
  return e;
}
const touches = (...pts: Array<[number, number]>) => pts.map(([clientX, clientY]) => ({ clientX, clientY }));

describe('QuadrantGestures', () => {
  let el: HTMLElement;
  let h: QuadrantGestureHandlers & { zooms: Array<[number, number, number]>; pans: Array<[number, number]>; canPan: boolean };
  let g: QuadrantGestures;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 400, height: 300 } as DOMRect);
    h = {
      zooms: [], pans: [], canPan: false,
      zoomAt(f, x, y) { this.zooms.push([f, x, y]); return true; },
      panBy(dx, dy) { this.pans.push([dx, dy]); },
      pannable() { return this.canPan; },
    };
    g = new QuadrantGestures(el, h);
  });
  afterEach(() => {
    g.destroy();
    el.remove();
  });

  it('wheel: zooms about the pointer in the element\'s own pixels, in on a wheel-up, and takes the scroll only when the view changed', () => {
    const up = ev('wheel', { deltaY: -100, deltaMode: 0, clientX: 150, clientY: 80 });
    el.dispatchEvent(up);
    expect(h.zooms[0][0]).toBeLessThan(1);
    expect(h.zooms[0].slice(1)).toEqual([50, 30]);
    expect(up.defaultPrevented).toBe(true);
    h.zoomAt = () => false; // at «весь»: nothing to zoom out to — the page scrolls
    const down = ev('wheel', { deltaY: 100, deltaMode: 0, clientX: 150, clientY: 80 });
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  it('one finger, not zoomed: no pan and no preventDefault — the page scrolls past the chart', () => {
    el.dispatchEvent(ev('touchstart', { touches: touches([200, 200]) }));
    const move = ev('touchmove', { touches: touches([200, 120]) });
    el.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
    expect(h.pans).toEqual([]);
  });

  it('one finger, zoomed: pans by the finger\'s movement and keeps the page still', () => {
    h.canPan = true;
    el.dispatchEvent(ev('touchstart', { touches: touches([200, 200]) }));
    const move = ev('touchmove', { touches: touches([190, 230]) });
    el.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    expect(h.pans).toEqual([[-10, 30]]);
  });

  it('two fingers: pinch zooms about their midpoint, by the ratio of distances — zoomed or not', () => {
    el.dispatchEvent(ev('touchstart', { touches: touches([200, 150], [300, 150]) })); // 100 px apart
    const move = ev('touchmove', { touches: touches([150, 150], [350, 150]) }); // 200 px apart: zoom in ×2
    el.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    expect(h.zooms).toEqual([[0.5, 150, 100]]);
  });

  it('a drag swallows the click that ends it (a pan never opens the dot under the pointer); a still press clicks', () => {
    h.canPan = true;
    const target = document.createElement('span');
    el.appendChild(target);
    const clicked = vi.fn();
    target.addEventListener('click', clicked);
    el.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 }));
    document.dispatchEvent(ev('pointermove', { clientX: 200 + DRAG_SLOP + 5, clientY: 200 }));
    document.dispatchEvent(ev('pointerup', {}));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.pans).toEqual([[DRAG_SLOP + 5, 0]]);
    expect(clicked).not.toHaveBeenCalled();
    el.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 }));
    document.dispatchEvent(ev('pointerup', {}));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('a mouse drag on an unzoomed chart pans nothing and still lets the click through', () => {
    const clicked = vi.fn();
    el.addEventListener('click', clicked);
    el.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 }));
    document.dispatchEvent(ev('pointermove', { clientX: 260, clientY: 200 }));
    document.dispatchEvent(ev('pointerup', {}));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.pans).toEqual([]);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('destroy removes every listener', () => {
    g.destroy();
    el.dispatchEvent(ev('wheel', { deltaY: -100, deltaMode: 0, clientX: 150, clientY: 80 }));
    expect(h.zooms).toEqual([]);
  });
});
