import { lastRevealed1m } from '../../src/backtest/last-revealed';
import { DAY, T0, candleStore, m1 } from './fake-backtest';

const MIN = 60_000;
const BTC = 'binance:BTCUSDT' as const;

describe('lastRevealed1m (design §5.1: revealed = openTime + 60 000 <= cursor)', () => {
  const cursor = T0 + 10 * DAY + 600 * MIN; // day 10, 10:00

  it('returns the candle that closed at the cursor, not the one opening at it', async () => {
    const store = candleStore([m1(BTC, cursor - 2 * MIN, 1, 1, 1, 1), m1(BTC, cursor - MIN, 2, 2, 2, 2), m1(BTC, cursor, 3, 3, 3, 3)]);
    expect(await lastRevealed1m(store, BTC, cursor)).toMatchObject({ openTime: cursor - MIN, close: 2 });
  });

  it('walks back across empty days (a weekend) within the lookback', async () => {
    const friday = cursor - 2 * DAY - 30 * MIN;
    const store = candleStore([m1(BTC, friday, 5, 5, 5, 5), m1(BTC, cursor + MIN, 9, 9, 9, 9)]);
    expect(await lastRevealed1m(store, BTC, cursor)).toMatchObject({ openTime: friday, close: 5 });
  });

  it('gives up beyond the 7-day lookback', async () => {
    const store = candleStore([m1(BTC, cursor - 7 * DAY - MIN, 5, 5, 5, 5), m1(BTC, cursor, 9, 9, 9, 9)]);
    expect(await lastRevealed1m(store, BTC, cursor)).toBeNull();
    expect(await lastRevealed1m(store, BTC, cursor, 8)).toMatchObject({ close: 5 });
  });

  it('never reads before the instrument coverage, and is null without any 1m', async () => {
    const store = candleStore([m1(BTC, cursor, 9, 9, 9, 9)]);
    expect(await lastRevealed1m(store, BTC, cursor)).toBeNull();
    expect((store as unknown as { query: jest.Mock }).query).not.toHaveBeenCalled();
    expect(await lastRevealed1m(candleStore([]), BTC, cursor)).toBeNull();
  });
});
