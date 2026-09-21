import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { BacktestInstrument, InstrumentId, SessionLayout } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import {
  MAX_SESSION_PANELS,
  addPanel,
  addableInstruments,
  layoutDiff,
  layoutEditErrorMessage,
  movePanel,
  panelsBlockedByOrders,
  panelsWithActiveOrders,
  removePanel,
} from '../../core/replay/layout-edit';
import { ReplaySessionStore } from '../../core/replay/replay-session.store';

/**
 * T-029 — editing the layout inside a session: add, remove and reorder candle panels. Each action
 * is one `PATCH …/sessions/:id {layout}` (the server re-runs the create checks and refuses to take
 * a panel from a pending or open order); on success the engine gains or drops the panels' tapes,
 * then the session's layout is replaced, so the grid re-renders. Reads the workspace's
 * `ReplaySessionStore` (provided by the workspace component) and changes only its layout.
 */
@Component({
  selector: 'app-layout-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './layout-editor.component.html',
  styleUrl: './layout-editor.component.scss',
})
export class LayoutEditorComponent {
  private readonly store = inject(ReplaySessionStore);
  private readonly client = inject(BacktestClient);

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly choice = signal<InstrumentId | ''>('');
  private readonly catalogue = signal<BacktestInstrument[] | null>(null);

  readonly session = this.store.session;
  readonly panels = computed(() => this.session()?.layout.panels ?? []);
  readonly locked = computed(() => this.session()?.status === 'complete');
  readonly withOrders = computed(() => panelsWithActiveOrders(this.store.portfolio.orders()));
  readonly full = computed(() => this.panels().length >= MAX_SESSION_PANELS);
  readonly addable = computed(() => {
    const session = this.session();
    const catalogue = this.catalogue();
    return session && catalogue ? addableInstruments(catalogue, session) : [];
  });

  async toggle(): Promise<void> {
    this.open.update((v) => !v);
    this.error.set(null);
    if (this.open() && this.catalogue() === null) {
      try {
        this.catalogue.set(await this.client.getInstruments());
      } catch (err) {
        this.error.set(layoutEditErrorMessage(err));
      }
    }
  }

  move(panelId: string, by: -1 | 1): void {
    this.edit((layout) => movePanel(layout, panelId, by));
  }

  remove(panelId: string): void {
    this.edit((layout) => removePanel(layout, panelId));
  }

  add(): void {
    const instrument = this.choice();
    if (!instrument) return;
    this.edit((layout) => addPanel(layout, instrument));
    this.choice.set('');
  }

  /** One edit: the client-side refusal, then the server, then the engine's tapes, then the grid. */
  private async edit(change: (layout: SessionLayout) => SessionLayout): Promise<void> {
    const session = this.session();
    const engine = this.store.engine();
    if (!session || !engine || this.busy() || this.locked()) return;
    const next = change(session.layout);
    if (next === session.layout) return;
    const blocked = panelsBlockedByOrders(next, this.store.portfolio.orders());
    if (blocked.length > 0) {
      this.error.set(`Panel ${blocked.map((p) => `'${p}'`).join(', ')} has pending or open orders. Cancel or close them first.`);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await this.client.patchSession(session.id, { layout: next });
      const { added, removed } = layoutDiff(session.layout, updated.layout);
      for (const panel of added) await engine.addPanel(panel); // the tape exists before the grid asks for it
      this.store.session.update((s) => (s ? { ...s, layout: updated.layout } : s));
      for (const id of removed) await engine.removePanel(id); // and goes after the grid has let go of it
    } catch (err) {
      this.error.set(layoutEditErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
