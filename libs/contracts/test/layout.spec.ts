import { Layout, LayoutSchema, LayoutsResponseSchema, Panel, PanelSchema } from '../src';

function candlesPanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: 'btc',
    kind: 'candles',
    instrument: 'binance:BTCUSDT',
    signals: false,
    ...overrides,
  };
}

describe('layout contracts round-trip (architecture/chart-layouts.md §2.2)', () => {
  it('parses and re-serializes a candles Panel identically', () => {
    const panel = candlesPanel({ signals: true });
    const parsed = PanelSchema.parse(panel);
    expect(parsed).toEqual(panel);
    expect(PanelSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(panel);
  });

  it('parses a metric Panel with signals defaulted to false', () => {
    const parsed = PanelSchema.parse({
      id: 'btc-oi',
      kind: 'metric',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
    });
    expect(parsed.signals).toBe(false);
  });

  it('rejects a metric-kind panel without a `metric` field', () => {
    expect(() =>
      PanelSchema.parse({ id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT' }),
    ).toThrow();
  });

  it('rejects a candles-kind panel that sets `metric`', () => {
    expect(() =>
      PanelSchema.parse({
        id: 'btc',
        kind: 'candles',
        instrument: 'binance:BTCUSDT',
        metric: 'openInterest',
      }),
    ).toThrow();
  });

  it('rejects a metric panel with `signals: true`', () => {
    expect(() =>
      PanelSchema.parse({
        id: 'btc-oi',
        kind: 'metric',
        instrument: 'binance:BTCUSDT',
        metric: 'openInterest',
        signals: true,
      }),
    ).toThrow();
  });

  it('parses and re-serializes a full crypto Layout identically', () => {
    const layout: Layout = {
      id: 'crypto',
      name: 'Crypto trading',
      grid: { columns: 2, rows: 2 },
      panels: [
        candlesPanel({ id: 'btc', signals: true }),
        candlesPanel({ id: 'eth', instrument: 'binance:ETHUSDT', signals: true }),
        {
          id: 'btc-oi',
          kind: 'metric',
          instrument: 'binance:BTCUSDT',
          metric: 'openInterest',
          signals: false,
        },
        candlesPanel({ id: 'dxy', instrument: 'capitalcom:DXY', signals: false }),
      ],
    };
    const parsed = LayoutSchema.parse(layout);
    expect(parsed).toEqual(layout);
    expect(LayoutSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(layout);

    const response = LayoutsResponseSchema.parse([layout]);
    expect(response).toEqual([layout]);
  });

  it('rejects a layout with more panels than grid cells', () => {
    expect(() =>
      LayoutSchema.parse({
        id: 'crypto',
        name: 'Crypto trading',
        grid: { columns: 1, rows: 1 },
        panels: [candlesPanel({ id: 'btc' }), candlesPanel({ id: 'eth', instrument: 'binance:ETHUSDT' })],
      }),
    ).toThrow();
  });

  it('rejects a layout with duplicate panel ids', () => {
    expect(() =>
      LayoutSchema.parse({
        id: 'crypto',
        name: 'Crypto trading',
        grid: { columns: 2, rows: 1 },
        panels: [candlesPanel({ id: 'btc' }), candlesPanel({ id: 'btc', instrument: 'binance:ETHUSDT' })],
      }),
    ).toThrow();
  });
});
