import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session, Timeframe } from '@trade-automation/contracts';
import { BacktestClient } from '../api/backtest.client';
import { ReplayEngine, type ReplayApi } from './replay-engine';
import { ReplayPanelSource } from './replay-panel-source';

/**
 * backtest-app-system-design.md §2.3 — one open backtest session in the workspace: the session
 * row, its `ReplayEngine` and one `ReplayPanelSource` per panel. Provided by the workspace
 * component, so it lives exactly as long as the route.
 *
 * TODO(T-021): the server is not told about advances yet, so its cursor stays where it was and a
 * reload returns to the session's stored cursor. Only the timeframe is persisted (PATCH).
 */
@Injectable()
export class ReplaySessionStore {
  private readonly client = inject(BacktestClient);

  readonly session = signal<Session | null>(null);
  readonly engine = signal<ReplayEngine | null>(null);
  readonly loadError = signal<string | null>(null);

  /**
   * Panel id → source, for the panel grid. New sources per timeframe, so the grid re-creates its
   * charts on a switch exactly as the live terminal's does on a feed rebuild.
   */
  readonly sources = computed(() => {
    const engine = this.engine();
    const session = this.session();
    if (!engine || !session) return new Map<string, ReplayPanelSource>();
    engine.timeframe();
    return new Map(session.layout.panels.map((p) => [p.id, new ReplayPanelSource(p, engine)]));
  });

  async open(id: string): Promise<void> {
    this.loadError.set(null);
    try {
      const { session } = await this.client.getSession(id);
      const engine = new ReplayEngine(this.api(id), {
        panels: session.layout.panels,
        cursorMs: session.cursorMs,
        serverCursorMs: session.cursorMs,
        timeframe: session.timeframe,
        periodToMs: session.periodToMs,
        skipWeekends: session.skipWeekends,
      });
      this.session.set(session);
      this.engine.set(engine);
      await engine.start();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
    }
  }

  private api(id: string): ReplayApi {
    return {
      history: (panelId, tf, before, limit) => this.client.getReplayHistory(id, panelId, tf, before, limit),
      ahead: (panelId, fromMs, limit) => this.client.getReplayAhead(id, panelId, fromMs, limit),
      patchTimeframe: async (tf: Timeframe) => {
        const session = await this.client.patchSession(id, { timeframe: tf });
        this.session.set(session);
      },
    };
  }
}
