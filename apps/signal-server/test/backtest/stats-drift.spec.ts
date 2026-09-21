import { SessionAggregates } from '@trade-automation/contracts';
import { aggregateDrift } from '../../src/backtest/stats-drift';

const BASE: SessionAggregates = {
  tradesCount: 3, winsCount: 2, lossesCount: 1, pnlCcy: 141.92, pnlR: 1.4192, profitFactor: 2.5,
  maxDrawdownCcy: 58, maxDrawdownR: 0.58, avgWinCcy: 99.96, avgWinR: 0.9996, avgLossCcy: -58, avgLossR: -0.58,
  statsComputedAt: 1_790_000_000_000,
};

describe('aggregateDrift (decision 38, T-018 ruling)', () => {
  it('equal after rounding to the column scale → no drift; statsComputedAt is ignored', () => {
    const computed = { ...BASE, pnlCcy: 141.920000001, pnlR: 1.4192000004, statsComputedAt: null };
    expect(aggregateDrift(computed, BASE)).toEqual([]);
  });

  it('one money field off in the 9th decimal → no drift', () => {
    expect(aggregateDrift({ ...BASE, avgWinCcy: 99.960000004 }, BASE)).toEqual([]);
  });

  it('one money field off by 1e-6 → drift, naming the field', () => {
    expect(aggregateDrift({ ...BASE, pnlCcy: 141.920001 }, BASE)).toEqual(['pnlCcy']);
  });

  it('an R field off by 1e-6 → drift (scale 6)', () => {
    expect(aggregateDrift({ ...BASE, maxDrawdownR: 0.580001 }, BASE)).toEqual(['maxDrawdownR']);
  });

  it('a count off → drift', () => {
    expect(aggregateDrift({ ...BASE, lossesCount: 2 }, BASE)).toEqual(['lossesCount']);
  });

  it('null vs 0 profit factor → drift; null vs null → none', () => {
    expect(aggregateDrift({ ...BASE, profitFactor: null }, { ...BASE, profitFactor: 0 })).toEqual(['profitFactor']);
    expect(aggregateDrift({ ...BASE, avgLossCcy: null, avgLossR: null }, { ...BASE, avgLossCcy: null, avgLossR: null })).toEqual([]);
  });

  it('reports every differing field', () => {
    expect(aggregateDrift({ ...BASE, tradesCount: 4, avgLossR: -0.6 }, BASE)).toEqual(['tradesCount', 'avgLossR']);
  });
});
