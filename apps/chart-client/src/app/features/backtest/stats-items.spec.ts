import type { SessionStats } from '@trade-automation/contracts';
import { headlineStats, statsItems } from './stats-items';

const STATS = {
  trades: 4, winRate: 0.5, pnl: 312.4, pnlR: 3.1, profitFactor: 2.25, maxDrawdownCcy: 150, maxDrawdownR: 1.5,
  maxDrawdownPct: 1.47, avgWin: 280, avgWinR: 2.8, avgLoss: -124, avgLossR: -1.25,
} as unknown as SessionStats;

describe('statsItems', () => {
  it('shows the server figures, win rate in percent', () => {
    expect(statsItems(STATS, 'USD').map((i) => [i.key, i.text])).toEqual([
      ['trades', '4'],
      ['winRate', '50.0 %'],
      ['pnl', '+312.40 USD'],
      ['pnlR', '+3.10 R'],
      ['profitFactor', '2.25'],
      ['maxDrawdownCcy', '150.00 USD'],
      ['maxDrawdownR', '1.50 R'],
      ['maxDrawdownPct', '1.5 %'],
      ['avgWin', '+280.00 USD'],
      ['avgWinR', '+2.80 R'],
      ['avgLoss', '−124.00 USD'],
      ['avgLossR', '−1.25 R'],
    ]);
    expect(statsItems(STATS, 'USD').find((i) => i.key === 'winRate')?.raw).toBe(0.5);
  });

  it('an empty session: no win rate, no averages, profit factor n/a', () => {
    const empty = { ...STATS, trades: 0, winRate: 0, profitFactor: null, avgWin: null, avgWinR: null, avgLoss: null, avgLossR: null } as SessionStats;
    const text = Object.fromEntries(statsItems(empty, 'USD').map((i) => [i.key, i.text]));
    expect(text['winRate']).toBe('—');
    expect(text['profitFactor']).toBe('n/a');
    expect(text['avgWin']).toBe('—');
  });
});

describe('headlineStats (T-044)', () => {
  it('P&L in currency and R up front; every other figure, in order, behind the button', () => {
    const { headline, details } = headlineStats(statsItems(STATS, 'USD'));
    expect(headline.map((i) => i.key)).toEqual(['pnl', 'pnlR']);
    expect(details.map((i) => i.key)).toEqual([
      'trades', 'winRate', 'profitFactor', 'maxDrawdownCcy', 'maxDrawdownR', 'maxDrawdownPct', 'avgWin', 'avgWinR', 'avgLoss', 'avgLossR',
    ]);
  });
});
