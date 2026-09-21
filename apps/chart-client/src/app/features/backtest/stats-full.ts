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
  const bins: HistogramBin[] = [{ label: `до ${fmt(-limit)}`, count: 0, side: 'loss' }];
  for (let i = 0; i < edges.length - 1; i++) {
    const [a, b] = [edges[i], edges[i + 1]];
    bins.push({ label: `${fmt(a)} … ${fmt(b)}`, count: 0, side: b <= 0 ? 'loss' : a >= 0 ? 'win' : 'flat' });
  }
  bins.push({ label: `от ${fmt(limit)}`, count: 0, side: 'win' });
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
    i('trades', 'Сделок', 'Сколько сделок закрыто.', String(s.trades)),
    i('winRate', 'Доля прибыльных', 'Какая часть закрытых сделок принесла прибыль.', formatPercent(s.trades === 0 ? null : s.winRate * 100)),
    i('pnl', 'Результат', 'Итог всех закрытых сделок в валюте счёта, с учётом комиссий и спреда.', formatSignedMoney(s.pnl, ccy)),
    i('pnlR', 'Результат в R', 'Тот же итог в единицах риска: 1R — сумма, которой вы рисковали в сделке.', formatR(s.pnlR)),
    i('expectancyR', 'Средняя сделка в R', 'Сколько R в среднем приносила одна сделка.', formatR(s.expectancyR)),
    i('profitFactor', 'Профит-фактор', 'Вся прибыль, делённая на все убытки. Больше 1 — прибыли больше, чем убытков.', formatRatio(s.profitFactor)),
    i('avgWin', 'Средняя прибыль', 'Средний результат прибыльной сделки.', formatSignedMoney(s.avgWin, ccy)),
    i('avgWinR', 'Средняя прибыль в R', 'Средний результат прибыльной сделки в R.', formatR(s.avgWinR)),
    i('avgLoss', 'Средний убыток', 'Средний результат убыточной сделки.', formatSignedMoney(s.avgLoss, ccy)),
    i('avgLossR', 'Средний убыток в R', 'Средний результат убыточной сделки в R.', formatR(s.avgLossR)),
    i('maxDrawdownCcy', 'Макс. просадка', 'Самое большое падение счёта от его прежнего максимума, по закрытым сделкам.', formatMoney(s.maxDrawdownCcy, ccy)),
    i('maxDrawdownR', 'Макс. просадка в R', 'Та же просадка в единицах риска.', formatRAmount(s.maxDrawdownR)),
    i('maxDrawdownPct', 'Макс. просадка в %', 'Та же просадка в процентах от максимума счёта.', formatPercent(s.maxDrawdownPct)),
  ];
}

/** The adverse-excursion block, with the trades resolved on bars called out (decision 4). */
export function maeItems(s: SessionStats): FullStatsItem[] {
  const i = (key: keyof SessionStats, label: string, hint: string, text: string): FullStatsItem => ({
    key, label, hint, text, raw: s[key] as number | null,
  });
  return [
    i('maeAvg', 'Средний откат против позиции', 'Насколько в среднем цена уходила против вас до закрытия сделки, в R.', formatRAmount(s.maeAvg)),
    i('maeWorst', 'Худший откат против позиции', 'Самый глубокий уход цены против позиции среди всех сделок, в R.', formatRAmount(s.maeWorst)),
    i('pessimisticTrades', 'Сделок, посчитанных по барам', 'Для них не было минутных данных: исход считан по барам, и при касании стопа и цели в одной свече засчитан стоп.', String(s.pessimisticTrades)),
    i('endOfSessionCloses', 'Закрыто в конце сессии', 'Позиции, которые были ещё открыты к концу периода и закрыты по последней цене.', String(s.endOfSessionCloses)),
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
  const sideLabel: Record<string, string> = { long: 'Покупки (long)', short: 'Продажи (short)' };
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
