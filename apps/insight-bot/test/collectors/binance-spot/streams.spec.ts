import { spotStreamNames } from '../../../src/collectors/binance-spot/streams';

describe('spotStreamNames (§4.2)', () => {
  it('is one lowercase kline stream per symbol, and nothing else', () => {
    expect(spotStreamNames(['BTCUSDT', 'ETHUSDT'])).toEqual(['btcusdt@kline_1m', 'ethusdt@kline_1m']);
  });

  it('has no array streams: spot has no markPrice and no forceOrder', () => {
    expect(spotStreamNames(['BTCUSDT']).some((s) => s.startsWith('!'))).toBe(false);
  });

  it('an empty universe subscribes to nothing', () => {
    expect(spotStreamNames([])).toEqual([]);
  });
});
