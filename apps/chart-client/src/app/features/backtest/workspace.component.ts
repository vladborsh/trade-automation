import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, untracked } from '@angular/core';
import type { Timeframe } from '@trade-automation/contracts';
import { LayoutsStore } from '../../core/state/layouts.store';
import { ReplaySessionStore } from '../../core/replay/replay-session.store';
import { PanelGridComponent } from '../panel-grid/panel-grid.component';
import { ReplayToolbarComponent } from './replay-toolbar.component';
import { JournalComponent } from './journal.component';
import { StatsSummaryComponent } from './stats-summary.component';
import { adjacentTimeframe, replayKeyAction } from './replay-keys';

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
  imports: [ReplayToolbarComponent, PanelGridComponent, JournalComponent, StatsSummaryComponent],
  providers: [ReplaySessionStore, LayoutsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();

  readonly store = inject(ReplaySessionStore);
  readonly session = this.store.session;
  readonly engine = this.store.engine;
  readonly panels = computed(() => this.session()?.layout.panels ?? []);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.open(id));
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
    const action = engine && !engine.completed() ? replayKeyAction(event) : null;
    if (!engine || !action) return;
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
   * `Enter` (decision 29): never a guessed order. With no active draft, a hint and nothing else;
   * with one, placing it is T-023.
   */
  order(): void {
    const active = this.store.activeTool()?.store.active();
    if (!active || active.kind !== 'draft') this.store.showHint('No active position tool — press B or S');
  }
}
