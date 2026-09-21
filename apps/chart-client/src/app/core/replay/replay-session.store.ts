import { Injectable, type OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Session, Timeframe } from '@trade-automation/contracts';
import { BacktestClient } from '../api/backtest.client';
import { AdvanceQueue, type MutationOutcome, type MutationTransport } from './advance-queue';
import { PortfolioStore } from './portfolio.store';
import { refusalNotice } from './refusal-notice';
import type { PanelPositionTools } from '../../features/panel-grid/panel-source';
import { ReplayEngine, type ReplayApi } from './replay-engine';
import { ReplayPanelSource } from './replay-panel-source';
import { PositionToolsStore } from './position-tools.store';

/** How long a one-line notice (resynced, reloaded) stays in the toolbar. */
const NOTICE_MS = 8_000;
/** How long a position-tool hint (a refused drag, `Enter` with no active tool) stays up. */
const HINT_MS = 3_000;
const DEFAULT_PRICE_PRECISION = 2;

/**
 * backtest-app-system-design.md §2.3, §5.4–5.5 — one open backtest session in the workspace: the
 * session row, its `ReplayEngine`, one `ReplayPanelSource` per panel, the `AdvanceQueue` that
 * persists every step and order op, and the `PortfolioStore` the responses are reconciled into.
 * Provided by the workspace component, so it lives exactly as long as the route.
 *
 * Every step is queued as an advance; the UI never waits for it. Each response moves the engine's
 * server cursor, replaces the balance/status and the returned orders, and a `complete` status locks
 * the workspace. A request the server refuses (a second tab moved the session, it completed
 * elsewhere, a client bug) reloads the session from the server — its state is the truth.
 */
@Injectable()
export class ReplaySessionStore implements OnDestroy {
  private readonly client = inject(BacktestClient);

  readonly session = signal<Session | null>(null);
  readonly engine = signal<ReplayEngine | null>(null);
  readonly portfolio = new PortfolioStore();
  readonly loadError = signal<string | null>(null);
  /** A request is being retried after a network error or 5xx. */
  readonly retrying = signal(false);
  /** A one-line message: "resynced", "reloaded from the server", … */
  readonly notice = signal<string | null>(null);
  /** Instrument → price decimals, for the journal (from `GET /backtest/instruments`). */
  readonly pricePrecision = signal<ReadonlyMap<string, number>>(new Map());

  /** A short position-tool message (T-022): a refused drag, `Enter` with no active tool, … */
  readonly hint = signal<string | null>(null);

  private queue: AdvanceQueue | null = null;
  private sessionId: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  /** Panel id → its position tools; kept across timeframe switches (the sources are rebuilt). */
  private readonly toolStores = new Map<string, PositionToolsStore>();
  private toolSeq = 0;

  constructor() {
    // A `market` draft stays on its panel's last close as the replay steps (§9.1).
    effect(() => {
      const engine = this.engine();
      // reading the sources creates each panel's store, so this effect tracks every panel's series
      const panelIds = [...this.sources().keys()];
      if (!engine) return;
      for (const panelId of panelIds) {
        const store = this.toolStore(panelId);
        const s = engine.seriesFor(panelId)();
        const close = (s.forming ?? s.closed.at(-1))?.close;
        if (close !== undefined) untracked(() => store.followLastClose(close));
      }
    });
  }

  /**
   * Panel id → source, for the panel grid. New sources per timeframe, so the grid re-creates its
   * charts on a switch exactly as the live terminal's does on a feed rebuild.
   */
  readonly sources = computed(() => {
    const engine = this.engine();
    const session = this.session();
    if (!engine || !session) return new Map<string, ReplayPanelSource>();
    engine.timeframe();
    return new Map(session.layout.panels.map((p) => [p.id, new ReplayPanelSource(p, engine, this.toolsBinding(p.id))]));
  });

  /** The panel's position-tool store (created on first use). */
  toolStore(panelId: string): PositionToolsStore {
    let store = this.toolStores.get(panelId);
    if (!store) {
      const lastBar = () => {
        const s = this.engine()?.seriesFor(panelId)();
        return s ? (s.forming ?? s.closed.at(-1) ?? null) : null;
      };
      store = new PositionToolsStore({
        lastClose: () => lastBar()?.close ?? null,
        anchorTime: () => lastBar()?.openTime ?? null,
        precision: () => this.precisionOf(panelId),
        activated: (active) => this.toolStores.forEach((other) => other !== active && other.deactivate()),
        hint: (message) => this.showHint(message),
        newId: () => `tool-${++this.toolSeq}`,
      });
      this.toolStores.set(panelId, store);
    }
    return store;
  }

  /** The workspace's single active tool (decision 29), with its panel. */
  activeTool(): { panelId: string; store: PositionToolsStore } | null {
    for (const [panelId, store] of this.toolStores) if (store.active()) return { panelId, store };
    return null;
  }

  /** `B`/`S`: on the panel under the pointer, else the active tool's panel, else the first panel. */
  createDraft(side: 'long' | 'short'): void {
    const panels = this.session()?.layout.panels ?? [];
    const hovered = panels.find((p) => this.toolStores.get(p.id)?.pointerPrice() != null);
    const panelId = hovered?.id ?? this.activeTool()?.panelId ?? panels[0]?.id;
    if (panelId) this.toolStore(panelId).create(side);
  }

  showHint(message: string): void {
    this.hint.set(message);
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.set(null), HINT_MS);
  }

  private precisionOf(panelId: string): number {
    const instrument = this.session()?.layout.panels.find((p) => p.id === panelId)?.instrument;
    return (instrument && this.pricePrecision().get(instrument)) ?? DEFAULT_PRICE_PRECISION;
  }

  private toolsBinding(panelId: string): PanelPositionTools {
    const store = this.toolStore(panelId);
    const view = computed(() => ({
      tools: store.tools(),
      balance: this.session()?.balance ?? 0,
      riskPct: this.session()?.defaultRiskPct ?? 1,
      pricePrecision: this.precisionOf(panelId),
    }));
    return { view, apply: (change) => store.apply(change), setPointerPrice: (price) => store.pointerPrice.set(price) };
  }

  /** Loads (or reloads) the session from the server and builds a fresh engine and queue at its cursor. */
  async open(id: string): Promise<void> {
    this.sessionId = id;
    this.queue?.stop();
    this.loadError.set(null);
    try {
      const detail = await this.client.getSession(id);
      const { session } = detail;
      const queue = new AdvanceQueue(this.transport(id), {
        onOutcome: (outcome) => this.reconcile(outcome),
        onRefused: (err) => this.refused(err),
        onRetrying: (retrying) => this.retrying.set(retrying),
        onIdle: () => void this.refreshStats(id),
      });
      const engine = new ReplayEngine(this.api(id), {
        panels: session.layout.panels,
        cursorMs: session.cursorMs,
        serverCursorMs: session.cursorMs,
        completed: session.status === 'complete',
        timeframe: session.timeframe,
        periodToMs: session.periodToMs,
        skipWeekends: session.skipWeekends,
        onStep: (cursorMs) => queue.push({ kind: 'advance', toCursorMs: cursorMs }),
      });
      this.queue = queue;
      this.portfolio.load(detail);
      await this.loadJournal(id);
      this.session.set(session);
      this.engine.set(engine);
      await engine.start();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * The journal and summary sources (T-024): every order, the stats with their drift flag, and the
   * instruments' price precision. Afterwards rows are refreshed from queue outcomes and the stats
   * once the queue goes idle — never polled.
   */
  private async loadJournal(id: string): Promise<void> {
    const [orders, stats, instruments] = await Promise.all([
      this.client.listOrders(id),
      this.client.getStats(id),
      this.client.getInstruments(),
    ]);
    this.portfolio.setOrders(orders);
    this.portfolio.applyStatsResponse(stats);
    this.pricePrecision.set(new Map(instruments.map((i) => [i.id, i.pricePrecision])));
  }

  /** One `GET …/stats` after the queue has drained, so `drift` reflects the rows just written. */
  private async refreshStats(id: string): Promise<void> {
    try {
      this.portfolio.applyStatsResponse(await this.client.getStats(id));
    } catch (err) {
      console.warn('[ReplaySessionStore] could not refresh the stats', err);
    }
  }

  /** Requests not yet answered (e2e and diagnostics). */
  get pendingMutations(): number {
    return this.queue?.pending ?? 0;
  }

  ngOnDestroy(): void {
    // The queue is left to drain: steps taken just before leaving the workspace still reach the server.
    clearTimeout(this.noticeTimer);
    clearTimeout(this.hintTimer);
  }

  private reconcile(outcome: MutationOutcome): void {
    const engine = this.engine();
    switch (outcome.kind) {
      case 'advance': {
        const { cursorMs, status, balance, events, orders, stats } = outcome.result;
        engine?.confirmServerCursor(cursorMs);
        this.session.update((s) => (s ? { ...s, cursorMs, status, balance } : s));
        this.applyOrders(orders);
        this.portfolio.applyEvents(events);
        this.portfolio.stats.set(stats);
        if (status === 'complete') engine?.complete();
        return;
      }
      case 'place':
        this.applyOrders([outcome.result.order]);
        this.portfolio.applyEvents(outcome.result.events);
        return;
      case 'close':
        this.applyOrders([outcome.result.order]);
        this.portfolio.stats.set(outcome.result.stats);
        this.session.update((s) => (s ? { ...s, balance: outcome.result.balance } : s));
        return;
      case 'cancel':
      case 'modify':
        this.applyOrders([outcome.result]);
        return;
    }
  }

  private applyOrders(orders: Parameters<PortfolioStore['applyOrders']>[0]): void {
    const mismatches = this.portfolio.applyOrders(orders);
    if (mismatches.length > 0) {
      console.warn('[ReplaySessionStore] preview/server mismatch — the server rows win', mismatches);
      this.showNotice('Resynced with the server.');
    }
  }

  private refused(err: unknown): void {
    console.warn('[ReplaySessionStore] the server refused a mutation — reloading the session', err);
    this.showNotice(refusalNotice(err));
    if (this.sessionId) void this.open(this.sessionId);
  }

  private showNotice(text: string): void {
    clearTimeout(this.noticeTimer);
    this.notice.set(text);
    this.noticeTimer = setTimeout(() => this.notice.set(null), NOTICE_MS);
  }

  private transport(id: string): MutationTransport {
    return {
      advance: (body) => this.client.advance(id, body),
      place: (body) => this.client.placeOrder(id, body),
      cancel: (orderId, body) => this.client.cancelOrder(id, orderId, body),
      close: (orderId, body) => this.client.closeOrder(id, orderId, body),
      modify: (orderId, body) => this.client.modifyOrder(id, orderId, body),
    };
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
