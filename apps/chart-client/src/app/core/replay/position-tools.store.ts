import { type Signal, computed, signal } from '@angular/core';
import type { PositionToolChange, PositionToolSide, PositionToolState } from '../../features/chart/overlay/position-tool.model';
import { snapPrice } from '../../features/chart/overlay/position-tool.geometry';
import { createDraft } from './position-tool-draft';

/** What a panel's store reads from its session, at call time. */
export interface PositionToolsDeps {
  /** The last close on this panel (the forming bar's close), or null before data. */
  lastClose(): number | null;
  /** The open time of the bar at the cursor on this panel: where a new drawing starts. */
  anchorTime(): number | null;
  precision(): number;
  /** Called when this store's tool becomes the active one, so the session clears the others. */
  activated(store: PositionToolsStore): void;
  hint(message: string): void;
  newId(): string;
  /** ATR(14) of this panel's timeframe for the default stop (T-028); null or absent → 0.5 %. */
  atr?(): number | null;
}

/**
 * backtest-app-system-design.md §9.1 — one panel's position tools. `B`/`S` create a draft at the
 * pointer's price and bar (or the last close and last bar when the pointer is off this chart; T-050); the last created or
 * clicked tool is active (decision 29, one active tool across the workspace, coordinated through
 * `deps.activated`); `Esc` removes the active draft. Drag changes from the chart are applied
 * through `apply`. Drafts place no orders yet (T-023). Held by the session store per panel, so
 * the drafts survive a timeframe switch (the panel sources are rebuilt on one).
 */
export class PositionToolsStore {
  private readonly list = signal<PositionToolState[]>([]);
  /** The price under the pointer while it is over this panel's chart; null otherwise. */
  readonly pointerPrice = signal<number | null>(null);
  /** T-050: the time (ms) of the bar under the pointer, while it is over this panel's chart. */
  readonly pointerTime = signal<number | null>(null);
  readonly tools: Signal<readonly PositionToolState[]> = this.list.asReadonly();
  /** The active draft, if the active tool is a draft. */
  readonly active = computed(() => this.list().find((t) => t.active) ?? null);
  /** The active live order's drawing (T-023), if the active tool is one of those. */
  readonly activeOrderId = signal<string | null>(null);

  constructor(private readonly deps: PositionToolsDeps) {}

  /** A new active draft; null (with a hint) before the panel has any price. */
  create(side: PositionToolSide): PositionToolState | null {
    const lastClose = this.deps.lastClose();
    const anchorTime = this.deps.anchorTime();
    if (lastClose === null || anchorTime === null) {
      this.deps.hint('No price on this panel yet.');
      return null;
    }
    const { tool, hint } = createDraft({
      id: this.deps.newId(),
      side,
      price: this.pointerPrice() ?? lastClose,
      lastClose,
      precision: this.deps.precision(),
      // T-050: at the bar under the pointer (never later than the last bar), else the last bar
      anchorTime: Math.min(this.pointerTime() ?? anchorTime, anchorTime),
      atr: this.deps.atr?.() ?? null,
    });
    if (hint) this.deps.hint(hint);
    this.list.update((tools) => [...tools.map((t) => ({ ...t, active: false })), tool]);
    this.deps.activated(this);
    return tool;
  }

  /** A draft of this store, or else a live order's drawing (whose id is the order id, T-023). */
  activate(id: string): void {
    const isDraft = this.list().some((t) => t.id === id);
    this.list.update((tools) => tools.map((t) => (t.active === (t.id === id) ? t : { ...t, active: t.id === id })));
    this.activeOrderId.set(isDraft ? null : id);
    this.deps.activated(this);
  }

  /** Another panel's tool became active. */
  deactivate(): void {
    if (this.active()) this.list.update((tools) => tools.map((t) => (t.active ? { ...t, active: false } : t)));
    this.activeOrderId.set(null);
  }

  /** A draft was placed: the server's order now draws it (T-023). */
  removeDraft(id: string): void {
    this.list.update((tools) => tools.filter((t) => t.id !== id));
  }

  /** `Esc`: removes the active tool if it is a draft. True when one was removed. */
  removeActiveDraft(): boolean {
    const active = this.active();
    if (!active || active.kind !== 'draft') return false;
    this.list.update((tools) => tools.filter((t) => t.id !== active.id));
    return true;
  }

  /** A change emitted by the chart's position-tool controller. */
  apply(change: PositionToolChange): void {
    if (change.type === 'activate') this.activate(change.id);
    else if (change.type === 'hint') this.deps.hint(change.message);
    else this.list.update((tools) => tools.map((t) => (t.id === change.tool.id ? { ...change.tool, active: t.active } : t)));
  }

  /**
   * The replay stepped: a `market` draft stays on the last close, keeping its stop and target
   * distances (so its risk does not change under it). Limit drafts stay where they are.
   */
  followLastClose(lastClose: number): void {
    const precision = this.deps.precision();
    const close = snapPrice(lastClose, precision);
    if (!this.list().some((t) => t.kind === 'draft' && t.mode === 'market' && t.entry !== close)) return;
    this.list.update((tools) =>
      tools.map((t) => {
        if (t.kind !== 'draft' || t.mode !== 'market' || t.entry === close) return t;
        const shift = close - t.entry;
        return { ...t, entry: close, sl: snapPrice(t.sl + shift, precision), tp: t.tp === null ? null : snapPrice(t.tp + shift, precision) };
      }),
    );
  }
}
