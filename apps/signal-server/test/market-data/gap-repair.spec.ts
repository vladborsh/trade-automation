import { Candle, Instrument } from '@trade-automation/contracts';
import { GapRepair } from '../../src/market-data/gap-repair';
import { VenueAdapter } from '../../src/market-data/venue-adapter.port';

const MIN = 60_000;

const instrument: Instrument = {
  id: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  assetClass: 'crypto-perp',
  displayName: 'BTC/USDT Perp',
  pricePrecision: 2,
  quoteCurrency: 'USDT',
  sessionCurrency: 'USDT',
  sessionTimezone: 'UTC',
};

function bar(openTime: number): Candle {
  return {
    instrument: instrument.id,
    timeframe: '1m',
    openTime,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
    closed: true,
    source: 'venue-stream',
  };
}

function fakeAdapter(fetchImpl: VenueAdapter['fetchCandles']): VenueAdapter {
  return {
    venue: 'binance',
    fetchCandles: fetchImpl,
    streamCandles: () => {
      throw new Error('not used in this test');
    },
    health: () => {
      throw new Error('not used in this test');
    },
  };
}

describe('GapRepair ordering (architecture/live-signal-server.md §4.1)', () => {
  it('forwards a contiguous candle with no fetch and no gap reported', async () => {
    const gr = new GapRepair();
    const fetchSpy = jest.fn();
    const adapter = fakeAdapter(fetchSpy);

    const first = await gr.onClosed1m(instrument, bar(0), adapter, 'up');
    expect(first.gap).toBeNull();
    expect(first.ordered).toEqual([bar(0)]);

    const second = await gr.onClosed1m(instrument, bar(MIN), adapter, 'up');
    expect(second.gap).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and orders the missing bars ahead of the new candle when a gap is detected', async () => {
    const gr = new GapRepair();
    const adapter = fakeAdapter(async (_i, _tf, from, to) => [bar(from), bar(from + MIN)]);

    await gr.onClosed1m(instrument, bar(0), adapter, 'up');
    // bars at MIN, 2*MIN are missing; next closed candle is at 3*MIN
    const result = await gr.onClosed1m(instrument, bar(3 * MIN), adapter, 'up');

    expect(result.gap).toEqual({ from: MIN, to: 2 * MIN, count: 2 });
    expect(result.ordered.map((c) => c.openTime)).toEqual([MIN, 2 * MIN, 3 * MIN]);
  });

  it('does not attempt a repair while the venue is not up (e.g. market closed)', async () => {
    const gr = new GapRepair();
    const fetchSpy = jest.fn();
    const adapter = fakeAdapter(fetchSpy);

    await gr.onClosed1m(instrument, bar(0), adapter, 'up');
    const result = await gr.onClosed1m(instrument, bar(5 * MIN), adapter, 'closed');

    expect(result.gap).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores an out-of-order or duplicate candle instead of reporting a negative gap', async () => {
    const gr = new GapRepair();
    const fetchSpy = jest.fn();
    const adapter = fakeAdapter(fetchSpy);

    await gr.onClosed1m(instrument, bar(2 * MIN), adapter, 'up');
    const result = await gr.onClosed1m(instrument, bar(MIN), adapter, 'up');

    expect(result.gap).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
