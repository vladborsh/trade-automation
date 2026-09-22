import type { InstrumentId } from '@trade-automation/contracts';
import { groupByCurrency } from './instrument-groups';
import { filterGroups, nextActive, optionIds, toggled } from './instrument-options';
import { CATALOGUE_LIST } from './sessions-test-fixtures';

const groups = groupByCurrency(CATALOGUE_LIST); // CHF: EUR/CHF; USD: BTC/USDT Perp, ETH/USDT Perp

describe('instrument-options (T-039)', () => {
  it('filters by display name or id (which carries the symbol), case-insensitively, and drops empty groups', () => {
    expect(filterGroups(groups, '').map((g) => g.currency)).toEqual(['CHF', 'USD']);
    expect(optionIds(filterGroups(groups, 'eth'))).toEqual(['binance:ETHUSDT']);
    expect(optionIds(filterGroups(groups, 'BTCUSDT'))).toEqual(['binance:BTCUSDT']);
    expect(optionIds(filterGroups(groups, 'capitalcom:'))).toEqual(['capitalcom:EURCHF']);
    expect(filterGroups(groups, 'usdt').map((g) => g.currency)).toEqual(['USD']);
    expect(filterGroups(groups, 'nothing like this')).toEqual([]);
  });

  it('flattens options in display order across groups', () => {
    expect(optionIds(groups)).toEqual(['capitalcom:EURCHF', 'binance:BTCUSDT', 'binance:ETHUSDT']);
  });

  it('moves the active option without wrapping; from none or a filtered-out one it starts at an end', () => {
    const ids = optionIds(groups);
    expect(nextActive(ids, null, 1)).toBe('capitalcom:EURCHF');
    expect(nextActive(ids, null, -1)).toBe('binance:ETHUSDT');
    expect(nextActive(ids, 'capitalcom:EURCHF', 1)).toBe('binance:BTCUSDT');
    expect(nextActive(ids, 'binance:ETHUSDT', 1)).toBe('binance:ETHUSDT');
    expect(nextActive(ids, 'capitalcom:EURCHF', -1)).toBe('capitalcom:EURCHF');
    expect(nextActive(ids, 'capitalcom:US100' as InstrumentId, 1)).toBe('capitalcom:EURCHF');
    expect(nextActive([], null, 1)).toBeNull();
  });

  it('toggles: removes a selected one, adds while below the limit, refuses beyond it', () => {
    const btc = 'binance:BTCUSDT' as InstrumentId;
    const eth = 'binance:ETHUSDT' as InstrumentId;
    expect(toggled([btc], btc, 4)).toEqual([]);
    expect(toggled([btc], eth, 4)).toEqual([btc, eth]);
    expect(toggled([btc, eth], 'capitalcom:EURCHF' as InstrumentId, 2)).toEqual([btc, eth]);
    expect(toggled([btc, eth], eth, 2)).toEqual([btc]); // removing is always allowed
  });
});
