import type { SessionStats } from '@trade-automation/contracts';
import { formatMoney, formatPercent, formatR, formatRAmount, formatRatio, formatSignedMoney } from './journal-format';

export interface StatsItem {
  /** The `SessionStats` field shown (a diff/e2e hook, `data-stat`). */
  key: keyof SessionStats;
  label: string;
  text: string;
  raw: number | null;
}

/**
 * backtest-app-system-design.md §8 — the basic summary: the server's recompute (`GET …/stats`
 * `computed`), formatted. Display only; `winRate` is a fraction on the wire and shown in percent.
 */
export function statsItems(s: SessionStats, currency: string): StatsItem[] {
  return [
    { key: 'trades', label: 'Trades', text: String(s.trades), raw: s.trades },
    { key: 'winRate', label: 'Win rate', text: formatPercent(s.trades === 0 ? null : s.winRate * 100), raw: s.winRate },
    { key: 'pnl', label: 'P&L', text: formatSignedMoney(s.pnl, currency), raw: s.pnl },
    { key: 'pnlR', label: 'P&L (R)', text: formatR(s.pnlR), raw: s.pnlR },
    { key: 'profitFactor', label: 'Profit factor', text: formatRatio(s.profitFactor), raw: s.profitFactor },
    { key: 'maxDrawdownCcy', label: 'Max drawdown', text: formatMoney(s.maxDrawdownCcy, currency), raw: s.maxDrawdownCcy },
    { key: 'maxDrawdownR', label: 'Max drawdown (R)', text: formatRAmount(s.maxDrawdownR), raw: s.maxDrawdownR },
    { key: 'maxDrawdownPct', label: 'Max drawdown (%)', text: formatPercent(s.maxDrawdownPct), raw: s.maxDrawdownPct },
    { key: 'avgWin', label: 'Average win', text: formatSignedMoney(s.avgWin, currency), raw: s.avgWin },
    { key: 'avgWinR', label: 'Average win (R)', text: formatR(s.avgWinR), raw: s.avgWinR },
    { key: 'avgLoss', label: 'Average loss', text: formatSignedMoney(s.avgLoss, currency), raw: s.avgLoss },
    { key: 'avgLossR', label: 'Average loss (R)', text: formatR(s.avgLossR), raw: s.avgLossR },
  ];
}
