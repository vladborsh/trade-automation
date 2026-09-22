import type { Order, OrderDetail, SessionStatsResponse, SessionSummary } from '@trade-automation/contracts';
import { computeStats, toSessionAggregates } from '@trade-automation/replay-core';

/**
 * T-024 — the mock has no order endpoints yet (T-023 adds place/cancel/close), so every session
 * reports a small fixed journal: one ordinary 1m win, one of each flag (a stop resolved on bars,
 * SL and TP in one candle, an end-of-session close) and a cancelled limit. Stats are replay-core's
 * `computeStats` over them — the server's own function. A session whose name contains "drift"
 * reports `drift: true`, so the notice can be seen.
 */

const M = 60_000;

export function seededOrders(s: SessionSummary): Order[] {
  const panel = s.layout.panels[0];
  const t = (min: number) => s.periodFromMs + min * M;
  const base = {
    sessionId: s.id, panelId: panel.id, instrument: panel.instrument, type: 'market' as const, riskPct: 1, riskAmountCcy: 100,
    limitPrice: null, tpInitial: null, tpCurrent: null, cancelledAtMs: null, slTpSameBar: false, createdAt: t(0), updatedAt: t(0),
    contractMultiplier: 1, // D12 (T-053): stored on every order row
  };
  const closed = (
    n: number, side: Order['side'], entry: number, exit: number, sl: number, qty: number, pnl: number, r: number, mae: number,
    reason: Order['closeReason'], resolution: Order['fillResolution'], extra: Partial<Order> = {},
  ): Order => ({
    ...base, id: `00000000-0000-4000-8000-00000000c00${n}`, seq: n, side, status: 'closed', placedAtMs: t(n * 10), entryPrice: entry,
    entryTimeMs: t(n * 10), exitPrice: exit, exitTimeMs: t(n * 10 + 5), closeReason: reason, fillResolution: resolution, qty,
    slInitial: sl, slCurrent: sl, commissionCcy: 1.25, spreadCostCcy: 0.5, pnlCcy: pnl, pnlR: r, maePrice: null, maeR: mae, ...extra,
  });
  return [
    closed(1, 'long', 40_000, 40_400, 39_800, 0.5, 198.25, 1.98, 0.3, 'take-profit', '1m'),
    closed(2, 'short', 40_500, 40_700, 40_700, 0.5, -101.75, -1.02, 1, 'stop', 'pessimistic-bar'),
    closed(3, 'long', 40_200, 40_000, 40_000, 0.5, -101.75, -1.02, 1, 'stop', '1m', { slTpSameBar: true, tpInitial: 40_600, tpCurrent: 40_600 }),
    closed(4, 'long', 40_100, 40_180, 39_900, 0.5, 38.25, 0.38, 0.1, 'end-of-session', '1m'),
    {
      ...base, id: '00000000-0000-4000-8000-00000000c005', seq: 5, side: 'short', type: 'limit', status: 'cancelled', placedAtMs: t(50),
      limitPrice: 41_000, entryPrice: null, entryTimeMs: null, exitPrice: null, exitTimeMs: null, closeReason: null, fillResolution: null,
      qty: 0.4, slInitial: 41_300, slCurrent: 41_300, commissionCcy: 0, spreadCostCcy: 0, pnlCcy: null, pnlR: null, maePrice: null,
      maeR: null, cancelledAtMs: t(55),
    },
  ];
}

export function seededStats(s: SessionSummary): SessionStatsResponse {
  const computed = computeStats(seededOrders(s), s.initialBalance, s.periodFromMs);
  return { computed, stored: toSessionAggregates(computed, Date.now()), drift: s.name.includes('drift') };
}

/**
 * T-030 — `GET …/orders/:orderId`: a seeded order with one stop move on the pessimistic-bar trade
 * and an entry screenshot on the first one (served by `screenshotPng`), so the detail page shows
 * both kinds of content and both placeholders.
 */
export function seededOrderDetail(s: SessionSummary, orderId: string): OrderDetail | null {
  const order = seededOrders(s).find((o) => o.id === orderId);
  if (!order) return null;
  const modifications =
    order.seq === 2
      ? [{ id: 1, orderId, cursorMs: (order.entryTimeMs as number) + 2 * M, field: 'sl' as const, oldValue: 40_750, newValue: 40_700, createdAt: order.createdAt }]
      : [];
  const screenshots = order.seq === 1 ? { entry: `/api/backtest/sessions/${s.id}/orders/${orderId}/screenshots/entry` } : {};
  return { order, modifications, screenshots };
}

/** A 1x1 PNG, the mock's only screenshot. */
export const screenshotPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
