import { SessionAggregates, SessionStats } from '@trade-automation/contracts';

/**
 * architecture/backtest-app-system-design.md §3, decision 38 — the subset of `SessionStats`
 * written to the `backtest_sessions` aggregate columns. A pure projection (field renames only, no
 * arithmetic), so the server's drift check (T-018) compares stored columns against exactly the
 * numbers `computeStats` produced. `statsComputedAt` is the caller's clock, passed in to keep this
 * pure.
 */
export function toSessionAggregates(stats: SessionStats, statsComputedAt: number | null): SessionAggregates {
  return {
    tradesCount: stats.trades,
    winsCount: stats.wins,
    lossesCount: stats.losses,
    pnlCcy: stats.pnl,
    pnlR: stats.pnlR,
    profitFactor: stats.profitFactor,
    maxDrawdownCcy: stats.maxDrawdownCcy,
    maxDrawdownR: stats.maxDrawdownR,
    avgWinCcy: stats.avgWin,
    avgWinR: stats.avgWinR,
    avgLossCcy: stats.avgLoss,
    avgLossR: stats.avgLossR,
    statsComputedAt,
  };
}
