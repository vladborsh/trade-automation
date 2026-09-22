import { signal } from '@angular/core';
import type { Order } from '@trade-automation/contracts';
import { modifyHint } from '../../features/chart/overlay/position-tool.geometry';
import type { PositionToolState } from '../../features/chart/overlay/position-tool.model';
import type { MutationInput } from './mutation-rules';

export interface Levels {
  sl: number;
  tp: number | null;
}

/**
 * T-033 — the stop/target a live order is drawn at while its handle is being dragged, and after
 * the drop until the server answers the `modify`: the drawing follows the pointer, then stays
 * where it was dropped, then shows the server's own values (or snaps back on a refusal).
 */
export class OrderLevelEdits {
  private readonly edits = signal<ReadonlyMap<string, Levels>>(new Map());

  /** The levels to draw for `order`: an edit in progress, else the order's own. */
  levelsOf(order: Pick<Order, 'id' | 'slCurrent' | 'tpCurrent'>): Levels {
    return this.edits().get(order.id) ?? { sl: order.slCurrent, tp: order.tpCurrent };
  }

  set(orderId: string, levels: Levels): void {
    this.edits.update((m) => new Map(m).set(orderId, levels));
  }

  clear(orderId: string): void {
    if (!this.edits().has(orderId)) return;
    this.edits.update((m) => {
      const next = new Map(m);
      next.delete(orderId);
      return next;
    });
  }

  clearAll(): void {
    this.edits.set(new Map());
  }
}

/**
 * What dropping a live order's stop or target handle does: `null` when neither level changed; a
 * hint when the server would refuse the move (replay-core's rule, the same one the PATCH applies);
 * otherwise the `modify` op to queue, carrying only the levels that changed.
 */
export function modifyFromDrop(
  order: Pick<Order, 'id' | 'slCurrent' | 'tpCurrent'>,
  tool: PositionToolState,
  lastClose: number,
  cursorMs: number,
): { input: MutationInput } | { hint: string } | null {
  const levels: { sl?: number; tp?: number } = {};
  if (tool.sl !== order.slCurrent) levels.sl = tool.sl;
  if (tool.tp !== null && tool.tp !== order.tpCurrent) levels.tp = tool.tp;
  if (levels.sl === undefined && levels.tp === undefined) return null;
  const hint = modifyHint(tool, levels, lastClose);
  if (hint) return { hint };
  return { input: { kind: 'modify', cursorMs, orderId: order.id, ...levels } };
}
