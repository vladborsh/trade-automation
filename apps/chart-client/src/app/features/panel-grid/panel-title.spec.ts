import type { Instrument, Panel } from '@trade-automation/contracts';
import { panelTitle } from './panel-title';

describe('panelTitle', () => {
  const panel: Panel = {
    id: 'btc',
    kind: 'candles',
    instrument: 'binance:BTCUSDT',
    signals: false,
  };
  const instruments = [
    { id: 'binance:BTCUSDT', displayName: 'BTCUSDT' },
  ] as unknown as Instrument[];

  it('prefers the panel title', () => {
    expect(panelTitle({ ...panel, title: 'Bitcoin' }, instruments)).toBe('Bitcoin');
  });

  it('falls back to the instrument display name, then the raw instrument id', () => {
    expect(panelTitle(panel, instruments)).toBe('BTCUSDT');
    expect(panelTitle(panel, [])).toBe('binance:BTCUSDT');
  });
});
