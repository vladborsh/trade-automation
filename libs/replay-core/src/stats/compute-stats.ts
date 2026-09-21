import { EquityPoint, Order, OrderSide, SessionStats, StatsBreakdown } from '@trade-automation/contracts';

/** The `Order` fields `computeStats` reads. A contract `Order` is assignable as is. */
export type StatsOrder = Pick<
  Order,
  'id' | 'seq' | 'instrument' | 'side' | 'status' | 'exitTimeMs' | 'pnlCcy' | 'pnlR' | 'maeR' | 'fillResolution' | 'closeReason'
>;

interface ClosedTrade {
  seq: number;
  instrument: string;
  side: OrderSide;
  exitTimeMs: number;
  pnl: number;
  pnlR: number;
  maeR: number | null;
  pessimistic: boolean;
  endOfSession: boolean;
}

/**
 * architecture/backtest-app-system-design.md §8 — session statistics over closed trades, every
 * money figure in currency and in R. Pure and deterministic: orders are sorted by `exitTimeMs`,
 * then `seq`, before anything is summed, so the result (to the last bit) does not depend on the
 * input order. Orders whose `status` is not `closed` are ignored; a closed order missing
 * `exitTimeMs`, `pnlCcy` or `pnlR` throws.
 *
 * Conventions:
 * - a trade is a win when `pnlCcy > 0`, a loss when `pnlCcy < 0`, breakeven when `pnlCcy === 0`;
 * - `winRate = wins / trades` — breakevens count in the denominator (they are trades that did
 *   not win); a fraction in [0, 1], `0` for an empty session. Breakdowns use the same rule;
 * - `grossProfit(R)` is the sum over wins (>= 0); `grossLoss(R)` the sum over losses, signed
 *   (<= 0); `profitFactor = grossProfit / -grossLoss`, `null` when there are no losses;
 * - `avgWin(R)` / `avgLoss(R)` are the signed means over wins / losses, `null` when there are
 *   none; `expectancyR = pnlR / trades`, `0` for an empty session;
 * - `equityCurve` starts at `(periodFromMs, initialBalance, 0)` and steps once per close
 *   (decision 26); `balanceR` is the cumulative R. Max drawdown is the largest peak-to-trough fall
 *   on that stepped curve — in currency on `balance`, in R on `balanceR` (each against its own
 *   running peak), and in % of the running balance peak (`12.5` means 12.5 %). Intrabar
 *   excursions are MAE's job, not drawdown's;
 * - `maeAvg` / `maeWorst` are over the trades' `maeR`, skipping nulls; `null` when none has one.
 */
export function computeStats(
  orders: readonly StatsOrder[],
  initialBalance: number,
  periodFromMs: number,
): SessionStats {
  const trades = orders
    .filter((o) => o.status === 'closed')
    .map(toClosedTrade)
    .sort((a, b) => a.exitTimeMs - b.exitTimeMs || a.seq - b.seq);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const maes = trades.map((t) => t.maeR).filter((m): m is number => m !== null);

  const pnl = sum(trades, (t) => t.pnl);
  const pnlR = sum(trades, (t) => t.pnlR);
  const grossProfit = sum(wins, (t) => t.pnl);
  const grossLoss = sum(losses, (t) => t.pnl);
  const curve = equityCurve(trades, initialBalance, periodFromMs);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    winRate: winRate(trades),
    pnl,
    pnlR,
    grossProfit,
    grossProfitR: sum(wins, (t) => t.pnlR),
    grossLoss,
    grossLossR: sum(losses, (t) => t.pnlR),
    profitFactor: losses.length === 0 ? null : grossProfit / -grossLoss,
    equityCurve: curve.points,
    maxDrawdownCcy: curve.maxDrawdownCcy,
    maxDrawdownR: curve.maxDrawdownR,
    maxDrawdownPct: curve.maxDrawdownPct,
    avgWin: mean(wins, (t) => t.pnl),
    avgWinR: mean(wins, (t) => t.pnlR),
    avgLoss: mean(losses, (t) => t.pnl),
    avgLossR: mean(losses, (t) => t.pnlR),
    expectancyR: trades.length === 0 ? 0 : pnlR / trades.length,
    maeAvg: maes.length === 0 ? null : maes.reduce((a, m) => a + m, 0) / maes.length,
    maeWorst: maes.length === 0 ? null : Math.max(...maes),
    pessimisticTrades: trades.filter((t) => t.pessimistic).length,
    endOfSessionCloses: trades.filter((t) => t.endOfSession).length,
    byInstrument: breakdown(trades, (t) => t.instrument),
    bySide: {
      long: breakdownOf(trades.filter((t) => t.side === 'long')),
      short: breakdownOf(trades.filter((t) => t.side === 'short')),
    },
  };
}

function toClosedTrade(o: StatsOrder): ClosedTrade {
  if (o.exitTimeMs === null || o.pnlCcy === null || o.pnlR === null) {
    throw new Error(`order ${o.id}: closed order without exitTimeMs, pnlCcy or pnlR`);
  }
  return {
    seq: o.seq,
    instrument: o.instrument,
    side: o.side,
    exitTimeMs: o.exitTimeMs,
    pnl: o.pnlCcy,
    pnlR: o.pnlR,
    maeR: o.maeR,
    pessimistic: o.fillResolution === 'pessimistic-bar',
    endOfSession: o.closeReason === 'end-of-session',
  };
}

function equityCurve(trades: readonly ClosedTrade[], initialBalance: number, periodFromMs: number) {
  const points: EquityPoint[] = [{ time: periodFromMs, balance: initialBalance, balanceR: 0 }];
  let balance = initialBalance;
  let balanceR = 0;
  let peak = initialBalance;
  let peakR = 0;
  let maxDrawdownCcy = 0;
  let maxDrawdownR = 0;
  let maxDrawdownPct = 0;
  for (const t of trades) {
    balance += t.pnl;
    balanceR += t.pnlR;
    points.push({ time: t.exitTimeMs, balance, balanceR });
    peak = Math.max(peak, balance);
    peakR = Math.max(peakR, balanceR);
    maxDrawdownCcy = Math.max(maxDrawdownCcy, peak - balance);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - balanceR);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - balance) / peak) * 100);
  }
  return { points, maxDrawdownCcy, maxDrawdownR, maxDrawdownPct };
}

function breakdown(trades: readonly ClosedTrade[], key: (t: ClosedTrade) => string): Record<string, StatsBreakdown> {
  const groups = new Map<string, ClosedTrade[]>();
  for (const t of trades) groups.set(key(t), [...(groups.get(key(t)) ?? []), t]);
  const out: Record<string, StatsBreakdown> = {};
  for (const k of [...groups.keys()].sort()) out[k] = breakdownOf(groups.get(k)!);
  return out;
}

function breakdownOf(trades: readonly ClosedTrade[]): StatsBreakdown {
  return { trades: trades.length, pnl: sum(trades, (t) => t.pnl), pnlR: sum(trades, (t) => t.pnlR), winRate: winRate(trades) };
}

function winRate(trades: readonly ClosedTrade[]): number {
  return trades.length === 0 ? 0 : trades.filter((t) => t.pnl > 0).length / trades.length;
}

function sum<T>(items: readonly T[], f: (t: T) => number): number {
  return items.reduce((acc, t) => acc + f(t), 0);
}

function mean<T>(items: readonly T[], f: (t: T) => number): number | null {
  return items.length === 0 ? null : sum(items, f) / items.length;
}
