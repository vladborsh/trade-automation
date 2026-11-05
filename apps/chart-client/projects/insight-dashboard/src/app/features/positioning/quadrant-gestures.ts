/**
 * IB-137 (market round 3 §2) — the quadrant's gestures, as a plain class over one element so the
 * component keeps only its handlers. Coordinates handed out are in the element's own pixels.
 *
 * - **Wheel** zooms about the pointer, and only while the pointer is over the element. The page
 *   scroll is taken only when the view actually changed: at «весь» a wheel-down scrolls the page.
 * - **Mouse drag** pans, while `pannable()`.
 * - **Two fingers** pinch-zoom about their midpoint, always (CSS `touch-action: pan-y` leaves the
 *   pinch to us and the vertical swipe to the page).
 * - **One finger** pans only while `pannable()` — the component then sets `touch-action: none`.
 *   Otherwise the touch is not touched, and the page scrolls past the chart.
 * - A press that moved more than DRAG_SLOP px swallows the click that follows, so a drag that ends
 *   on a dot does not open it.
 */
export interface QuadrantGestureHandlers {
  /** Zoom by `factor` (< 1 in) about (px, py); false when the view did not change. */
  zoomAt(factor: number, px: number, py: number): boolean;
  panBy(dxPx: number, dyPx: number): void;
  pannable(): boolean;
}

export const DRAG_SLOP = 4;
/** Wheel: a 100 px notch zooms by e^0.15 ≈ 1.16. */
export const WHEEL_RATE = 0.0015;

export class QuadrantGestures {
  private last: { x: number; y: number } | null = null;
  private moved = 0;
  private pinch: { dist: number } | null = null;
  private readonly off: Array<() => void> = [];

  constructor(private readonly el: HTMLElement, private readonly h: QuadrantGestureHandlers) {
    this.on(el, 'wheel', (e) => this.wheel(e as WheelEvent));
    this.on(el, 'pointerdown', (e) => this.down(e as PointerEvent));
    this.on(el, 'touchstart', (e) => this.touch(e as TouchEvent));
    this.on(el, 'touchmove', (e) => this.touch(e as TouchEvent));
    this.on(el, 'touchend', (e) => this.touch(e as TouchEvent));
    this.on(el, 'touchcancel', (e) => this.touch(e as TouchEvent));
    // capture: stopped here, the click never reaches the dot under the pointer
    this.on(el, 'click', (e) => {
      if (this.moved > DRAG_SLOP) {
        e.stopPropagation();
        e.preventDefault();
      }
      this.moved = 0;
    }, true);
  }

  destroy(): void {
    for (const f of this.off.splice(0)) f();
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
    target.addEventListener(type, fn, { passive: false, capture });
    this.off.push(() => target.removeEventListener(type, fn, { capture }));
  }

  private local(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private wheel(e: WheelEvent): void {
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (dy === 0) return;
    const p = this.local(e.clientX, e.clientY);
    if (this.h.zoomAt(Math.exp(dy * WHEEL_RATE), p.x, p.y)) e.preventDefault();
  }

  private down(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    this.moved = 0;
    this.last = { x: e.clientX, y: e.clientY };
    const doc = this.el.ownerDocument;
    const move = (m: Event) => {
      const pm = m as PointerEvent;
      if (!this.last) return;
      const dx = pm.clientX - this.last.x;
      const dy = pm.clientY - this.last.y;
      this.last = { x: pm.clientX, y: pm.clientY };
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.h.pannable()) {
        pm.preventDefault();
        this.h.panBy(dx, dy);
      }
    };
    const up = () => {
      this.last = null;
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      // a press that did not pan is a click, whatever the hand did
      if (!this.h.pannable()) this.moved = 0;
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  private touch(e: TouchEvent): void {
    const t = e.touches;
    if (e.type === 'touchstart' && t.length === 1) this.moved = 0;
    if (t.length >= 2) {
      const a = this.local(t[0].clientX, t[0].clientY);
      const b = this.local(t[1].clientX, t[1].clientY);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (e.cancelable) e.preventDefault();
      if (this.pinch && dist > 0) this.h.zoomAt(this.pinch.dist / dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = { dist };
      this.last = null;
      this.moved = DRAG_SLOP + 1;
      return;
    }
    this.pinch = null;
    if (t.length === 0) {
      this.last = null;
      return;
    }
    const p = { x: t[0].clientX, y: t[0].clientY };
    if (e.type === 'touchmove' && this.last && this.h.pannable()) {
      if (e.cancelable) e.preventDefault();
      this.moved += Math.abs(p.x - this.last.x) + Math.abs(p.y - this.last.y);
      this.h.panBy(p.x - this.last.x, p.y - this.last.y);
    }
    this.last = p;
  }
}
