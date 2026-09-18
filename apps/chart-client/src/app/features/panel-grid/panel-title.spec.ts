import type { Instrument, MetricPoint, Panel } from '@trade-automation/contracts';
import { metricUnitLabel, panelTitle, plottedMetricUnit } from './panel-title';

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

describe('plottedMetricUnit (§11.1 — the panel plots notional)', () => {
  it('is the quote currency once the series has data, whatever unit `value` is in', () => {
    const point = { unit: 'base' } as MetricPoint;
    expect(plottedMetricUnit([point])).toBe('quote');
    expect(panelTitle(oiPanel, btc, plottedMetricUnit([point]))).toBe('BTCUSDT · Open interest · USDT');
  });

  it('is null before the series has data', () => {
    expect(plottedMetricUnit([])).toBeNull();
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

describe('panelTitle — aggregate panel (architecture/aggregate-oi.md §1)', () => {
  const aggPanel: Panel = { ...oiPanel, aggregate: 'btc-perp-oi' };

  it('is `<displayName> · Open interest · USD` once the series has data', () => {
    expect(panelTitle(aggPanel, btc, 'quote', { displayName: 'BTC perps · 3 venues' })).toBe(
      'BTC perps · 3 venues · Open interest · USD',
    );
  });

  it('falls back to the aggregate id before the definition arrives, and has no unit before data', () => {
    expect(panelTitle(aggPanel, btc, null)).toBe('btc-perp-oi · Open interest');
  });

  it('a layout title still wins', () => {
    expect(panelTitle({ ...aggPanel, title: 'OI' }, btc, 'quote', { displayName: 'x' })).toBe('OI · USD');
  });
});
