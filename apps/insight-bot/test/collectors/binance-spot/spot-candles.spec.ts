import type { Instrument } from '@trade-automation/contracts';
import { SpotCandleSource } from '../../../src/collectors/binance-spot/spot-candles';
import { SPOT_REST_PAGE_LIMIT, type SpotRest } from '../../../src/collectors/binance-spot/rest';

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const BTC = { id: 'binance:BTCUSDT', symbol: 'BTCUSDT' } as unknown as Instrument;

/** `limit` rows of 1m klines from `from`, in Binance's array shape. */
const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => [from + i * MINUTE, '100', '110', '90', '105', '10', from + i * MINUTE + 59_999, '1050', 7, '4', '420', '0']);

describe('SpotCandleSource (IB-006) — the repair reader', () => {
  it('maps one page into candles of the asked instrument', async () => {
    const rest = { klineRange: async () => page(T0, 3) } as unknown as SpotRest;
    const candles = await new SpotCandleSource(rest).fetchCandles(BTC, '1m', T0, T0 + 2 * MINUTE);
    expect(candles.map((c) => c.openTime)).toEqual([T0, T0 + MINUTE, T0 + 2 * MINUTE]);
    expect(candles[0]).toMatchObject({ instrument: 'binance:BTCUSDT', timeframe: '1m', closed: true });
  });

  it('pages: a full page is followed from the bar after its last, a short page ends the walk', async () => {
    const asked: Array<{ from: number; to: number }> = [];
    const rest = {
      klineRange: async (_s: string, from: number, to: number) => {
        asked.push({ from, to });
        return asked.length === 1 ? page(from, SPOT_REST_PAGE_LIMIT) : page(from, 2);
      },
    } as unknown as SpotRest;

    const to = T0 + (SPOT_REST_PAGE_LIMIT + 1) * MINUTE;
    const candles = await new SpotCandleSource(rest).fetchCandles(BTC, '1m', T0, to);
    expect(asked).toEqual([
      { from: T0, to },
      { from: T0 + SPOT_REST_PAGE_LIMIT * MINUTE, to },
    ]);
    expect(candles).toHaveLength(SPOT_REST_PAGE_LIMIT + 2);
  });

  it('an empty answer ends the walk rather than looping', async () => {
    let calls = 0;
    const rest = { klineRange: async () => (calls++, []) } as unknown as SpotRest;
    expect(await new SpotCandleSource(rest).fetchCandles(BTC, '1m', T0, T0 + 10 * MINUTE)).toEqual([]);
    expect(calls).toBe(1);
  });

  it('refuses a timeframe other than 1m: a collector repairs raw bars only', async () => {
    const rest = { klineRange: async () => [] } as unknown as SpotRest;
    await expect(new SpotCandleSource(rest).fetchCandles(BTC, '5m', T0, T0 + MINUTE)).rejects.toThrow(/1m only/);
  });
});
