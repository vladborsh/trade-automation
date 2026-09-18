/**
 * architecture/chart-layouts.md §11.3 sync rule 3 — "resizes are not gestures".
 *
 * When a sibling column collapses or restores, every remaining chart changes width and
 * lightweight-charts' `autoSize` makes each fire a logical-range change: N panels proposing N
 * slightly different ranges at once, which is exactly the origin-takeover pattern the
 * `ChartSyncService` circuit breaker trips on. This tracker says whether the container is
 * mid-resize (range changes then must not propose) and calls `onSettled` once it is not.
 *
 * "Settled" = two animation frames after the last size change: lightweight-charts repaints from
 * its own ResizeObserver callback and may emit a follow-up range change on its next frame, so one
 * frame is not always enough. The first observation is the mount-time size, not a resize.
 */
export class ResizeSettleTracker {
  private lastSize: { width: number; height: number } | null = null;
  private generation = 0;
  private _resizing = false;

  constructor(
    private readonly onSettled: () => void,
    private readonly nextFrame: (cb: () => void) => void = (cb) => requestAnimationFrame(cb),
  ) {}

  get resizing(): boolean {
    return this._resizing;
  }

  /** Feed one size observation (a ResizeObserver entry's content rect). */
  observe(width: number, height: number): void {
    const prev = this.lastSize;
    this.lastSize = { width, height };
    if (!prev || (prev.width === width && prev.height === height)) {
      return;
    }
    this._resizing = true;
    const gen = ++this.generation;
    this.nextFrame(() =>
      this.nextFrame(() => {
        if (gen !== this.generation) {
          return; // a later resize restarted the wait
        }
        this._resizing = false;
        this.onSettled();
      }),
    );
  }

  /** Stops any pending settle callback (component destroyed). */
  dispose(): void {
    this.generation++;
    this._resizing = false;
  }
}

/**
 * Wires a `ResizeObserver` on `el` into `tracker`. Must be installed BEFORE `createChart()`:
 * ResizeObserver callbacks run in observer-creation order, so this one marks the resize before
 * lightweight-charts' own `autoSize` observer repaints and fires its range change. Returns the
 * disconnect function; a no-op where ResizeObserver does not exist (jsdom).
 */
export function observeResize(el: Element, tracker: ResizeSettleTracker): () => void {
  if (typeof ResizeObserver === 'undefined') {
    return () => undefined;
  }
  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) {
      tracker.observe(entry.contentRect.width, entry.contentRect.height);
    }
  });
  observer.observe(el);
  return () => observer.disconnect();
}
