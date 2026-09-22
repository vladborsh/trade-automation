import type { EquityPoint, SessionStats } from '@trade-automation/contracts';
import { breakdownRows, drawdownChartData, equityChartData, fullStatsItems, maeItems, rHistogram } from './stats-full';

const S = 1_000;
const curve: EquityPoint[] = [
  { time: 0, balance: 10_000, balanceR: 0 }, // seeded at the period start (decision 26)
  { time: 60 * S, balance: 10_200, balanceR: 2 },
  { time: 120 * S, balance: 10_050, balanceR: 0.5 },
  { time: 120 * S + 500, balance: 9_950, balanceR: -0.5 }, // a second close in the same second
  { time: 300 * S, balance: 10_300, balanceR: 3 },
];

describe('equityChartData', () => {
  it('seconds, currency or R, one point per second (the last close of that second wins)', () => {
    expect(equityChartData(curve, 'ccy')).toEqual([
      { time: 0, value: 10_000 },
      { time: 60, value: 10_200 },
      { time: 120, value: 9_950 },
      { time: 300, value: 10_300 },
    ]);
    expect(equityChartData(curve, 'r').map((p) => p.value)).toEqual([0, 2, -0.5, 3]);
  });

  it('an empty session is its seed point alone', () => {
    expect(equityChartData([curve[0]], 'ccy')).toEqual([{ time: 0, value: 10_000 }]);
  });
});

describe('drawdownChartData', () => {
  it('is the distance below the running peak; its deepest point is the max drawdown', () => {
    expect(drawdownChartData(curve, 'ccy')).toEqual([
      { time: 0, value: 0 },
      { time: 60, value: 0 },
      { time: 120, value: -250 },
      { time: 300, value: 0 },
    ]);
    expect(Math.min(...drawdownChartData(curve, 'r').map((p) => p.value))).toBe(-2.5);
  });
});

describe('rHistogram', () => {
  it('bins R results half an R wide, with open bins beyond ±3R', () => {
    const bins = rHistogram([-5, -1, -0.99, 0.2, 1.97, 2.5, 3, 7]);
    const counts = Object.fromEntries(bins.filter((b) => b.count > 0).map((b) => [b.label, b.count]));
    expect(counts).toEqual({ 'below −3R': 1, '−1R … −0.5R': 2, '0R … +0.5R': 1, '+1.5R … +2R': 1, '+2.5R … +3R': 1, '+3R and above': 2 });
    expect(bins).toHaveLength(14);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(8);
  });

  it('colours loss, win and straddling bins', () => {
    const bins = rHistogram([], 1, 1);
    expect(bins.map((b) => [b.label, b.side])).toEqual([
      ['below −1R', 'loss'],
      ['−1R … 0R', 'loss'],
      ['0R … +1R', 'win'],
      ['+1R and above', 'win'],
    ]);
  });
});

const STATS = {
  trades: 4, winRate: 0.25, pnl: -201.08, pnlR: -2.02, expectancyR: -0.505, profitFactor: 0.11, avgWin: 24.46, avgWinR: 0.24,
  avgLoss: -75.18, avgLossR: -0.76, maxDrawdownCcy: 225.54, maxDrawdownR: 2.27, maxDrawdownPct: 2.2, maeAvg: 0.93, maeWorst: 1.82,
  pessimisticTrades: 1, endOfSessionCloses: 1,
} as unknown as SessionStats;

describe('fullStatsItems / maeItems', () => {
  it('keeps the raw server value next to a Russian caption and a plain explanation', () => {
    const items = fullStatsItems(STATS, 'USD');
    expect(items.find((x) => x.key === 'winRate')).toMatchObject({ label: 'Win rate', text: '25.0 %', raw: 0.25 });
    expect(items.find((x) => x.key === 'pnl')?.text).toBe('−201.08 USD');
    expect(items.every((x) => x.hint.length > 0)).toBe(true);
    const mae = maeItems(STATS);
    expect(mae.map((x) => [x.key, x.text])).toEqual([
      ['maeAvg', '0.93 R'],
      ['maeWorst', '1.82 R'],
      ['pessimisticTrades', '1'],
      ['endOfSessionCloses', '1'],
    ]);
  });
});

describe('breakdownRows', () => {
  it('one row per instrument or side, in Russian where it is a word', () => {
    const rows = breakdownRows('bySide', { long: { trades: 3, winRate: 1 / 3, pnl: -46.23, pnlR: -0.47 }, short: { trades: 1, winRate: 0, pnl: -154.85, pnlR: -1.55 } }, 'USD');
    expect(rows.map((r) => [r.key, r.label, r.trades, r.winRate, r.pnl, r.pnlR])).toEqual([
      ['bySide.long', 'Long', 3, '33.3 %', '−46.23 USD', '−0.47 R'],
      ['bySide.short', 'Short', 1, '0.0 %', '−154.85 USD', '−1.55 R'],
    ]);
    expect(breakdownRows('byInstrument', { 'binance:BTCUSDT': { trades: 0, winRate: 0, pnl: 0, pnlR: 0 } }, 'USD')[0]).toMatchObject({ label: 'binance:BTCUSDT', winRate: '—' });
  });
});
