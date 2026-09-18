import type { Instrument, Panel } from '@trade-automation/contracts';
import { metricUnitLabel, panelTitle } from './panel-title';

const btc: Pick<Instrument, 'symbol' | 'quoteCurrency' | 'displayName'> = {
  symbol: 'BTCUSDT',
  quoteCurrency: 'USDT',
  displayName: 'BTC/USDT Perp',
};
const oiPanel: Panel = { id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest', signals: false };
const candlesPanel: Panel = { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: true };

describe('metricUnitLabel (architecture/chart-layouts.md §11.1)', () => {
  it("'base' is the symbol minus its quoteCurrency suffix", () => {
    expect(metricUnitLabel('base', btc)).toBe('BTC');
    expect(metricUnitLabel('base', { symbol: 'ETHUSDC', quoteCurrency: 'USDC' })).toBe('ETH');
  });

  it("'base' falls back to the whole symbol when it does not end in quoteCurrency", () => {
    expect(metricUnitLabel('base', { symbol: 'BTCUSD_PERP', quoteCurrency: 'USD' })).toBe('BTCUSD_PERP');
  });

  it("'quote' is the quoteCurrency and 'contracts' is literal", () => {
    expect(metricUnitLabel('quote', btc)).toBe('USDT');
    expect(metricUnitLabel('contracts', btc)).toBe('contracts');
  });
});

describe('panelTitle', () => {
  it('names symbol, metric and unit on a metric panel', () => {
    expect(panelTitle(oiPanel, btc, 'base')).toBe('BTCUSDT · Open interest · BTC');
  });

  it('omits the unit until the series has reported one', () => {
    expect(panelTitle(oiPanel, btc, null)).toBe('BTCUSDT · Open interest');
  });

  it('falls back to the instrument id symbol before instruments have loaded', () => {
    expect(panelTitle(oiPanel, null, 'base')).toBe('BTCUSDT · Open interest');
  });

  it('keeps a layout-given title and appends the unit', () => {
    expect(panelTitle({ ...oiPanel, title: 'BTC OI' }, btc, 'base')).toBe('BTC OI · BTC');
  });

  it('leaves candle panels unchanged', () => {
    expect(panelTitle(candlesPanel, btc, null)).toBe('BTC/USDT Perp');
    expect(panelTitle({ ...candlesPanel, title: 'Bitcoin' }, btc, null)).toBe('Bitcoin');
    expect(panelTitle(candlesPanel, null, null)).toBe('binance:BTCUSDT');
  });
});
