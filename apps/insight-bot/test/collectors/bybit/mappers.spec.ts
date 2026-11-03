import { liquidationRowFromEvent } from '../../../src/collectors/binance-perp/mappers';
import { liquidationRows } from '../../../src/collectors/bybit/mappers';
import type { BybitLiquidationEvent } from '../../../src/collectors/bybit/payloads';
import { LIQUIDATIONS } from './fixtures';

describe('Bybit liquidation mapping — the side LIQUIDATED (§3.3, D6)', () => {
  it('maps the recorded allLiquidation pushes', () => {
    const rows = liquidationRows(LIQUIDATIONS[0].data as readonly BybitLiquidationEvent[]);
    expect(rows).toEqual([
      { venue: 'bybit', symbol: 'ETHUSDT', ts: new Date(1_790_608_175_868), side: 'short', price: 2679.27, qty: 0.08, notional: 2679.27 * 0.08, orderStatus: null, source: 'ws' },
    ]);
  });

  it('an array push becomes one row per event', () => {
    const events: BybitLiquidationEvent[] = [
      { T: 1, s: 'BTCUSDT', S: 'Buy', v: '0.5', p: '80000' },
      { T: 2, s: 'BTCUSDT', S: 'Sell', v: '0.25', p: '80100' },
    ];
    expect(liquidationRows(events).map((r) => [r.side, r.notional])).toEqual([['long', 40000], ['short', 20025]]);
  });

  it('BYBIT AND BINANCE ARE INVERTED, and both normalise to the side liquidated', () => {
    // Bybit doc: "When you receive a Buy update, this means that a long position has been liquidated"
    const bybitBuy = liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', p: '100' }])[0];
    // Binance: `S` is the side of the order the engine submits, so SELL closes (liquidates) a long
    const binanceSell = liquidationRowFromEvent({
      e: 'forceOrder', E: 1,
      o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '1', p: '100', ap: '100', X: 'FILLED', l: '1', z: '1', T: 1 },
    });
    expect([bybitBuy.side, binanceSell.side]).toEqual(['long', 'long']); // same fact, opposite venue fields
    const bybitSell = liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Sell', v: '1', p: '100' }])[0];
    expect(bybitSell.side).toBe('short');
  });

  it('refuses a price or size that is not a number rather than writing NaN', () => {
    expect(() => liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Buy', v: 'x', p: '100' }])).toThrow(RangeError);
    expect(() => liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', p: '' }])).toThrow(RangeError);
  });
});

