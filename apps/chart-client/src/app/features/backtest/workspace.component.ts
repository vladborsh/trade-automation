import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Timeframe } from '@trade-automation/contracts';
import { LayoutsStore } from '../../core/state/layouts.store';
import { ReplaySessionStore } from '../../core/replay/replay-session.store';
import { PanelGridComponent } from '../panel-grid/panel-grid.component';
import { LayoutEditorComponent } from './layout-editor.component';
import { ReplayToolbarComponent } from './replay-toolbar.component';
import { OrderPanelComponent } from './order-panel.component';
import { PositionsPanelComponent } from './positions-panel.component';
import { JournalComponent } from './journal.component';
import { StatsSummaryComponent } from './stats-summary.component';
import { adjacentTimeframe, keyAllowed, replayKeyAction } from './replay-keys';

/**
 * backtest-app-system-design.md §2.3, §5.4 — `/sessions/:id`: the replay toolbar over the panel
 * grid, each panel rendered from its `ReplayPanelSource`; the journal and the statistics summary
 * (T-024, read-only, the server's numbers) below it.
 *
 * Provides its own `LayoutsStore` (empty): the grid and its panels read the *active layout* for
 * collapsing, and the live terminal's layout must not reach into a session — so nothing collapses
 * here, and the terminal's collapsed panels are untouched. The hotkeys are a window listener that
 * exists only while this route is mounted, so they cannot collide with the terminal's.
 */
@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [
    ReplayToolbarComponent,
    PanelGridComponent,
    LayoutEditorComponent,
    JournalComponent,
    StatsSummaryComponent,
    OrderPanelComponent,
    PositionsPanelComponent,
  ],
  providers: [ReplaySessionStore, LayoutsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** `?viewAt=<ms>&order=<id>` — §9.3 view-only rewind ("Show on chart" from a trade's detail). */
  readonly viewAt = input<string | undefined>();
  /** Public name `order` (the query parameter); `order()` is the Enter action. */
  readonly viewOrder = input<string | undefined>(undefined, { alias: 'order' });

  readonly store = inject(ReplaySessionStore);
  readonly session = this.store.session;
  readonly engine = this.store.engine;
  readonly panels = computed(() => this.session()?.layout.panels ?? []);
  /** The active draft and what the order panel sizes it from (T-023). */
  readonly activeDraft = computed(() => {
    const active = this.store.activeTool();
    const draft = active?.store.active();
    if (!active || !draft || draft.kind !== 'draft') return null;
    const instrument = this.panels().find((p) => p.id === active.panelId)?.instrument;
    return { draft, lastClose: this.store.lastCloseOf(active.panelId), precision: (instrument && this.store.pricePrecision().get(instrument)) || 2 };
  });
  /** T-045: the order popup, open at the submit step — for as long as there is an active draft. */
  readonly orderPopup = signal(false);
  readonly popupDraft = computed(() => (this.orderPopup() ? this.activeDraft() : null));

  constructor() {
    effect(() => {
      const id = this.id();
      const viewAt = Number(this.viewAt());
      const view = Number.isFinite(viewAt) && viewAt > 0 ? { viewAt, orderId: this.viewOrder() ?? null } : null;
      untracked(() => void this.store.open(id, view));
    });
    // the draft went away (removed, placed from elsewhere, a reload): the popup goes with it
    effect(() => {
      if (this.orderPopup() && !this.activeDraft()) this.orderPopup.set(false);
    });
  }

  step(): void {
    void this.engine()?.step();
  }

  setTimeframe(tf: Timeframe): void {
    void this.engine()?.setTimeframe(tf);
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const engine = this.engine();
    const action = engine ? replayKeyAction(event) : null;
    if (!engine || !action) return;
    if (!keyAllowed(action, { completed: engine.completed(), viewOnly: engine.viewOnly })) return;
    if (this.orderPopup()) {
      // the popup is modal: Enter confirms, Esc closes it (keeping the draft), nothing else acts.
      // Keys inside it are its own (its form submits on Enter, closes on Esc).
      if ((event.target as Element | null)?.closest?.('app-order-panel')) return;
      event.preventDefault();
      if (action === 'order') this.confirmOrder();
      else if (action === 'cancel') this.orderPopup.set(false);
      return;
    }
    event.preventDefault(); // → would otherwise scroll the page
    switch (action) {
      case 'step':
        return this.step();
      case 'finer':
      case 'coarser':
        return this.setTimeframe(adjacentTimeframe(engine.timeframe(), action));
      case 'long':
      case 'short':
        return this.store.createDraft(action);
      case 'cancel':
        this.store.activeTool()?.store.removeActiveDraft();
        return;
      case 'order':
        return this.order();
    }
  }

  /**
   * `Enter` (decision 29): with an active draft, opens the order popup (T-045) — the submit step;
   * with none, a hint and nothing else.
   */
  order(): void {
    if (this.activeDraft()) this.orderPopup.set(true);
    else this.store.placeActiveDraft();
  }

  /** The popup's Confirm: places the draft through the queue as before. */
  confirmOrder(): void {
    this.orderPopup.set(false);
    this.store.placeActiveDraft();
  }
}
