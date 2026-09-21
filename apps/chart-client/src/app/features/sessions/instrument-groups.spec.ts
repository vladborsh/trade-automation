import { groupByCurrency } from './instrument-groups';
import { CATALOGUE_LIST } from './sessions-test-fixtures';

describe('groupByCurrency (decisions 16, 36, D11)', () => {
  it('keeps only instruments with stored 1m, grouped by sessionCurrency, sorted', () => {
    expect(groupByCurrency(CATALOGUE_LIST).map((g) => [g.currency, g.instruments.map((i) => i.id)])).toEqual([
      ['CHF', ['capitalcom:EURCHF']],
      ['USD', ['binance:BTCUSDT', 'binance:ETHUSDT']],
    ]);
  });

  it('is empty when nothing has coverage', () => {
    expect(groupByCurrency(CATALOGUE_LIST.map((i) => ({ ...i, coverage: null })))).toEqual([]);
  });
});
