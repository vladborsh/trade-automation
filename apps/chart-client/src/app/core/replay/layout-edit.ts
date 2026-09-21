import type { BacktestInstrument, InstrumentId, Order, SessionLayout, SessionPanel } from '@trade-automation/contracts';
import { isApiError } from '../api/api-error';

/**
 * T-029 — pure helpers for editing a session's layout mid-session. The server is the authority
 * (it runs the same rules and answers 409/422); these keep the UI from sending doomed edits.
 */

export const MAX_SESSION_PANELS = 4;
const ONE_MINUTE_MS = 60_000;

/**
 * What changed between two layouts, as the replay engine needs it: panels to gain a tape and
 * panels to lose one. A panel that keeps its id but points at another instrument is both.
 */
export function layoutDiff(before: SessionLayout, after: SessionLayout): { added: SessionPanel[]; removed: string[] } {
  const was = new Map(before.panels.map((p) => [p.id, p.instrument]));
  const now = new Map(after.panels.map((p) => [p.id, p.instrument]));
  return {
    added: after.panels.filter((p) => was.get(p.id) !== p.instrument),
    removed: before.panels.filter((p) => now.get(p.id) !== p.instrument).map((p) => p.id),
  };
}

/** The client mirror of the server rule: panels a layout would take from a pending or open order. */
export function panelsBlockedByOrders(after: SessionLayout, orders: readonly Pick<Order, 'panelId' | 'instrument' | 'status'>[]): string[] {
  const now = new Map(after.panels.map((p) => [p.id, p.instrument]));
  const active = orders.filter((o) => o.status === 'pending' || o.status === 'open');
  return [...new Set(active.filter((o) => now.get(o.panelId) !== o.instrument).map((o) => o.panelId))];
}

/** Panel ids that currently hold a pending or open order (the editor disables their remove button). */
export function panelsWithActiveOrders(orders: readonly Pick<Order, 'panelId' | 'status'>[]): Set<string> {
  return new Set(orders.filter((o) => o.status === 'pending' || o.status === 'open').map((o) => o.panelId));
}

/** Moves a panel one place up (-1) or down (+1); unchanged at the ends. */
export function movePanel(layout: SessionLayout, panelId: string, by: -1 | 1): SessionLayout {
  const i = layout.panels.findIndex((p) => p.id === panelId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= layout.panels.length) return layout;
  const panels = [...layout.panels];
  [panels[i], panels[j]] = [panels[j], panels[i]];
  return { ...layout, panels };
}

export function removePanel(layout: SessionLayout, panelId: string): SessionLayout {
  return fitGrid({ ...layout, panels: layout.panels.filter((p) => p.id !== panelId) });
}

/** Appends a candle panel for `instrument` with a fresh id (`^[a-z0-9-]+$`, unique in the layout). */
export function addPanel(layout: SessionLayout, instrument: InstrumentId): SessionLayout {
  const base = instrument.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const taken = new Set(layout.panels.map((p) => p.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return fitGrid({ ...layout, panels: [...layout.panels, { id, kind: 'candles', instrument, signals: false }] });
}

/** Keeps the grid while it has room for the panels; otherwise one row. */
function fitGrid(layout: SessionLayout): SessionLayout {
  const fits = layout.panels.length <= layout.grid.columns * layout.grid.rows;
  return fits ? layout : { ...layout, grid: { columns: Math.max(1, Math.min(4, layout.panels.length)), rows: 1 } };
}

/**
 * Instruments the editor may add: stored 1m overlapping the session's period (the coverage runs
 * to `to + 1m`), the session's own currency (decision 36), not already on the layout.
 */
export function addableInstruments(
  catalogue: readonly BacktestInstrument[],
  session: { sessionCurrency: string; periodFromMs: number; periodToMs: number; layout: SessionLayout },
): BacktestInstrument[] {
  const onLayout = new Set(session.layout.panels.map((p) => p.instrument));
  return catalogue.filter(
    (i) =>
      i.coverage !== null &&
      i.sessionCurrency === session.sessionCurrency &&
      !onLayout.has(i.id) &&
      session.periodFromMs < i.coverage.to + ONE_MINUTE_MS &&
      i.coverage.from < session.periodToMs,
  );
}

/** What the editor says when the server refuses a layout edit. */
export function layoutEditErrorMessage(err: unknown): string {
  if (!isApiError(err)) return 'Cannot reach the server. Check your connection and try again.';
  switch (err.code) {
    case 'LAYOUT_TOO_MANY_PANELS':
      return `A session holds at most ${MAX_SESSION_PANELS} panels.`;
    case 'MIXED_SESSION_CURRENCY':
      return 'Every panel must trade in the session currency.';
    case 'INSTRUMENT_NOT_AVAILABLE':
      return 'That instrument has no stored 1m history on the server.';
    case 'PERIOD_OUTSIDE_COVERAGE':
      return "That instrument's history does not overlap the session period.";
    case 'SESSION_COMPLETE':
      return 'The session is complete; its layout can no longer change.';
    default:
      if (err.status === 409) return 'A panel with pending or open orders cannot be removed. Cancel or close them first.';
      return 'Could not change the layout. Try again.';
  }
}
