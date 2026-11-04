import type { WritableSignal } from '@angular/core';
import { DEFAULT_PANE_HEIGHTS, resizePane, savePaneHeights, type KeyValueStore, type PaneHeights, type PaneKey } from './pane-heights';

/**
 * The instrument chart's pane resizing (2026-10-24 redesign): dragging a pane's lower edge changes
 * that pane alone and moves the ones below; the heights are the reader's and survive a reload.
 * Moved out of `instrument-chart.component.ts` unchanged (IB-110: the component was at its 250-line
 * ceiling) — the pointer handlers and «reset heights», over the component's own `heights` signal.
 */
export class PaneDrag {
  /** The pane being dragged, with where the drag started. */
  private drag: { key: PaneKey; startY: number; startHeight: number } | null = null;

  constructor(private readonly heights: WritableSignal<PaneHeights>, private readonly store: KeyValueStore | null) {}

  /** Back to the default heights, and remembered as such. */
  reset(): void {
    this.heights.set({ ...DEFAULT_PANE_HEIGHTS });
    savePaneHeights(this.store, this.heights());
  }

  start(event: PointerEvent, key: PaneKey): void {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.drag = { key, startY: event.clientY, startHeight: this.heights()[key] };
  }

  move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.heights.set(resizePane(this.heights(), drag.key, drag.startHeight, event.clientY - drag.startY));
  }

  end(): void {
    if (!this.drag) return;
    this.drag = null;
    savePaneHeights(this.store, this.heights());
  }
}
