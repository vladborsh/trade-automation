import type { EquityPoint, SessionStats, StatsBreakdown } from '@trade-automation/contracts';
import { formatMoney, formatPercent, formatR, formatRAmount, formatRatio, formatSignedMoney } from './journal-format';

/**
 * The full statistics screen's pure helpers (T-032, backtest-app-system-design.md §8). Display only:
 * every figure is a `GET …/stats`.computed field; the helpers only reshape it for a chart or a table.
 * Captions are for the user, so they are in plain Russian (PROJECT.md "Communicating with the user").
 */

export type EquityUnit = 'ccy' | 'r';

export interface ChartPoint {
  /** Seconds (lightweight-charts time). */
  time: number;
  value: number;
}

const valueOf = (p: EquityPoint, unit: EquityUnit) => (unit === 'ccy' ? p.balance : p.balanceR);

/**
 * The stepped equity curve (decision 26) as chart data. Several closes in the same second share a
 * time, and lightweight-charts needs strictly ascending times, so the chart keeps the last value
 * of each second — the balance after all of them. The raw points stay listed one for one.
 */
export function equityChartData(points: readonly EquityPoint[], unit: EquityUnit): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const p of points) {
    const time = Math.floor(p.time / 1000);
    const value = valueOf(p, unit);
    if (out.length > 0 && out[out.length - 1].time === time) out[out.length - 1] = { time, value };
    else out.push({ time, value });
  }
  return out;
}

/**
 * The drawdown overlay: at each point of the server's curve, how far it sits below its highest point
 * so far (0 at a new high, negative below it). Its deepest value is the server's `maxDrawdownCcy` /
 * `maxDrawdownR` — the same curve, read the same way (decision 26: drawdown on the stepped curve).
 */
export function drawdownChartData(points: readonly EquityPoint[], unit: EquityUnit): ChartPoint[] {
  let peak = Number.NEGATIVE_INFINITY;
  const underwater = points.map((p) => {
    const v = valueOf(p, unit);
    peak = Math.max(peak, v);
    return { ...p, balance: v - peak, balanceR: v - peak };
  });
  return equityChartData(underwater, unit);
}

export interface HistogramBin {
  label: string;
  count: number;
  /** For colouring: losing, breakeven-ish or winning bins. */
  side: 'loss' | 'flat' | 'win';
}

/**
 * The distribution of trade results in R: bins `width` R wide from `−limit` to `+limit`, plus one
 * open bin at each end, so a single outlier cannot stretch the chart. `results` are the server's
 * `pnlR` of the closed trades.
 */
export function rHistogram(results: readonly number[], width = 0.5, limit = 3): HistogramBin[] {
  const edges: number[] = [];
  for (let e = -limit; e <= limit + 1e-9; e += width) edges.push(Number(e.toFixed(6)));
  const bins: HistogramBin[] = [{ label: `below ${fmt(-limit)}`, count: 0, side: 'loss' }];
  for (let i = 0; i < edges.length - 1; i++) {
    const [a, b] = [edges[i], edges[i + 1]];
    bins.push({ label: `${fmt(a)} … ${fmt(b)}`, count: 0, side: b <= 0 ? 'loss' : a >= 0 ? 'win' : 'flat' });
  }
  bins.push({ label: `${fmt(limit)} and above`, count: 0, side: 'win' });
  for (const r of results) {
    if (r < -limit) bins[0].count++;
    else if (r >= limit) bins[bins.length - 1].count++;
    else bins[1 + Math.min(edges.length - 2, Math.floor((r + limit) / width))].count++;
  }
  return bins;
}

const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}R`;

export interface FullStatsItem {
  /** A path into `SessionStats` — the diff/e2e hook (`data-stat`). */
  key: string;
  label: string;
  /** One plain-Russian sentence on what the figure means (shown on hover). */
  hint: string;
  text: string;
  raw: number | null;
}

/** The headline figures, captioned for the trader. */
export function fullStatsItems(s: SessionStats, ccy: string): FullStatsItem[] {
  const i = (key: keyof SessionStats, label: string, hint: string, text: string): FullStatsItem => ({
    key, label, hint, text, raw: s[key] as number | null,
  });
  return [
    i('trades', 'Trades', 'How many trades have closed.', String(s.trades)),
    i('winRate', 'Win rate', 'The share of closed trades that made a profit.', formatPercent(s.trades === 0 ? null : s.winRate * 100)),
    i('pnl', 'P&L', 'The result of all closed trades in the account currency, after commission and spread.', formatSignedMoney(s.pnl, ccy)),
    i('pnlR', 'P&L (R)', 'The same result in units of risk: 1R is the amount you risked on the trade.', formatR(s.pnlR)),
    i('expectancyR', 'Expectancy (R)', 'How many R one trade made on average.', formatR(s.expectancyR)),
    i('profitFactor', 'Profit factor', 'All the profit divided by all the losses. Above 1 means more profit than loss.', formatRatio(s.profitFactor)),
    i('avgWin', 'Average win', 'The average result of a winning trade.', formatSignedMoney(s.avgWin, ccy)),
    i('avgWinR', 'Average win (R)', 'The average result of a winning trade, in R.', formatR(s.avgWinR)),
    i('avgLoss', 'Average loss', 'The average result of a losing trade.', formatSignedMoney(s.avgLoss, ccy)),
    i('avgLossR', 'Average loss (R)', 'The average result of a losing trade, in R.', formatR(s.avgLossR)),
    i('maxDrawdownCcy', 'Max drawdown', 'The largest fall of the balance from its previous high, over closed trades.', formatMoney(s.maxDrawdownCcy, ccy)),
    i('maxDrawdownR', 'Max drawdown (R)', 'The same drawdown in units of risk.', formatRAmount(s.maxDrawdownR)),
    i('maxDrawdownPct', 'Max drawdown (%)', 'The same drawdown as a percentage of the balance high.', formatPercent(s.maxDrawdownPct)),
  ];
}

/** The adverse-excursion block, with the trades resolved on bars called out (decision 4). */
export function maeItems(s: SessionStats): FullStatsItem[] {
  const i = (key: keyof SessionStats, label: string, hint: string, text: string): FullStatsItem => ({
    key, label, hint, text, raw: s[key] as number | null,
  });
  return [
    i('maeAvg', 'Average adverse excursion', 'How far on average the price moved against you before the trade closed, in R.', formatRAmount(s.maeAvg)),
    i('maeWorst', 'Worst adverse excursion', 'The furthest the price moved against a position across all trades, in R.', formatRAmount(s.maeWorst)),
    i('pessimisticTrades', 'Trades resolved on bars', 'There was no 1-minute data for them: the outcome was read from bars, and when one candle touched both the stop and the target, the stop was taken.', String(s.pessimisticTrades)),
    i('endOfSessionCloses', 'Closed at the session end', 'Positions still open at the end of the period, closed at the last price.', String(s.endOfSessionCloses)),
  ];
}

export interface BreakdownRow {
  /** `byInstrument.<id>` / `bySide.<side>` — the diff hook prefix. */
  key: string;
  label: string;
  trades: number;
  winRate: string;
  pnl: string;
  pnlR: string;
  raw: StatsBreakdown;
}

/** One table row per instrument or side, in the server's order. */
export function breakdownRows(
  group: 'byInstrument' | 'bySide',
  data: Readonly<Partial<Record<string, StatsBreakdown>>>,
  ccy: string,
): BreakdownRow[] {
  const sideLabel: Record<string, string> = { long: 'Long', short: 'Short' };
  const entries = Object.entries(data).filter((e): e is [string, StatsBreakdown] => e[1] !== undefined);
  return entries.map(([k, b]) => ({
    key: `${group}.${k}`,
    label: group === 'bySide' ? (sideLabel[k] ?? k) : k,
    trades: b.trades,
    winRate: formatPercent(b.trades === 0 ? null : b.winRate * 100),
    pnl: formatSignedMoney(b.pnl, ccy),
    pnlR: formatR(b.pnlR),
    raw: b,
  }));
}
