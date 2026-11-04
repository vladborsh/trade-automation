/**
 * IB-BUG-021 — ties a `BlockScheduler` to the tab's visibility, starting from the CURRENT state.
 *
 * The scheduler assumes visible until told otherwise, and both pages used to tell it only on
 * `visibilitychange`. A page LOADED hidden (Cmd+click, a background tab) never gets that event,
 * so it polled at full cadence while nobody could see it — 9 requests in 180 s on the box
 * (IB-093). Call this BEFORE `start()`: the initial state is applied first, so a hidden page
 * fires nothing until it is shown, and then fires every block once (the scheduler's rule).
 * The instrument page's live tail already reads the initial state (`live-tail.ts`).
 * Returns the detach function for `DestroyRef`.
 */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export function bindVisibility(doc: VisibilitySource, scheduler: { setVisible(visible: boolean): void }): () => void {
  const apply = () => scheduler.setVisible(doc.visibilityState !== 'hidden');
  apply();
  doc.addEventListener('visibilitychange', apply);
  return () => doc.removeEventListener('visibilitychange', apply);
}
