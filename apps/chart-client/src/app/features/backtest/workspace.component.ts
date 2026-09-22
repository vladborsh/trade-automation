import { ChangeDetectionStrategy, Component, HostListener, type OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import type { Timeframe } from '@trade-automation/contracts';
import { LayoutsStore } from '../../core/state/layouts.store';
import { ReplaySessionStore } from '../../core/replay/replay-session.store';
import { PanelGridComponent } from '../panel-grid/panel-grid.component';
import { LayoutEditorComponent } from './layout-editor.component';
import { ReplayToolbarComponent } from './replay-toolbar.component';
import { OrderPanelComponent } from './order-panel.component';
import { PositionsDropdownComponent } from './positions-dropdown.component';
import { TradeControlsComponent } from './trade-controls.component';
import { TradeCloseSnackbarComponent } from './trade-close-snackbar.component';
import { CloseSoundToggleComponent } from './close-sound-toggle.component';
import { CloseSoundSetting } from '../../core/replay/close-sound.setting';
import { JournalComponent } from './journal.component';
import { StatsSummaryComponent } from './stats-summary.component';
import { adjacentTimeframe, keyAllowed, replayKeyAction } from './replay-keys';
import { AutoPlay, type AutoPlaySpeedMs } from '../../core/replay/auto-play';

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
    PositionsDropdownComponent,
    TradeControlsComponent,
    TradeCloseSnackbarComponent,
    CloseSoundToggleComponent,
  ],
  providers: [ReplaySessionStore, LayoutsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent implements OnDestroy {
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
    return {
      draft,
      lastClose: this.store.lastCloseOf(active.panelId),
      precision: (instrument && this.store.pricePrecision().get(instrument)) || 2,
      contract: this.store.instruments.contractOf(instrument), // T-054: unit, step, minimums, cap
    };
  });
  /**
   * T-052: Play / Pause. Steps through the same path as `→`; pauses by itself at the period end or
   * completion, and here on a new engine (a reload, view-only) and when the tab is hidden.
   */
  readonly autoplay = new AutoPlay({
    step: () => this.step(),
    canStep: () => {
      const e = this.engine();
      return !!e && e.started() && !e.viewOnly && !e.atEnd() && !e.completed() && !e.halted(); // T-059: halted pauses it
    },
    stepPending: () => {
      const e = this.engine();
      return !e || e.inFlight || e.blocked() || e.stepQueued();
    },
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
    // T-052: a new engine (a reload, view-only, another session) starts paused
    effect(() => {
      this.engine();
      untracked(() => this.autoplay.pause());
    });
    // the draft went away (removed, placed from elsewhere, a reload): the popup goes with it
    effect(() => {
      if (this.orderPopup() && !this.activeDraft()) this.orderPopup.set(false);
    });
  }

  step(): void {
    void this.engine()?.step();
  }

  setAutoplaySpeed(ms: AutoPlaySpeedMs): void {
    this.autoplay.setSpeed(ms);
  }

  /** T-052: a hidden tab pauses auto-play (it would step unseen, and timers are throttled there). */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.hidden) this.autoplay.pause();
  }

  ngOnDestroy(): void {
    this.autoplay.pause();
  }

  setTimeframe(tf: Timeframe): void {
    void this.engine()?.setTimeframe(tf);
  }

  private readonly closeSound = inject(CloseSoundSetting);

  /** Any click in the workspace is a user gesture: the browser may then play the close chime (T-051). */
  @HostListener('pointerdown')
  armSound(): void {
    this.closeSound.arm();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    this.closeSound.arm(); // a keypress is a gesture too (T-051)
    const engine = this.engine();
    const action = engine ? replayKeyAction(event) : null;
    if (!engine || !action) return;
    // Enter and Esc on the toolbar's own buttons (the positions dropdown, T-046; the trade controls,
    // T-048) are theirs — Enter clicks the focused button — the other hotkeys still work there
    if ((action === 'order' || action === 'cancel') && (event.target as Element | null)?.closest?.('app-positions-dropdown, app-trade-controls')) return;
    // T-059: a halted session is as locked as a complete one
    if (!keyAllowed(action, { completed: engine.completed() || engine.halted(), viewOnly: engine.viewOnly })) return;
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
