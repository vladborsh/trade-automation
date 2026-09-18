import * as path from 'path';
import { LayoutsController } from '../../src/api/rest/layouts.controller';
import { AppConfigService } from '../../src/config/config.service';

/**
 * architecture/chart-layouts.md §2.3 — GET /api/layouts returns Layout[] verbatim from the
 * configured layouts.yaml. Boots AppConfigService against the real repo config so this also
 * exercises the cross-file instrument check for the shipped 'crypto'/'us-indices' layouts.
 */
function fakeNestConfig() {
  const root = path.join(__dirname, '../../config');
  const paths: Record<string, string> = {
    INSTRUMENTS_FILE: path.join(root, 'instruments.yaml'),
    STRATEGIES_FILE: path.join(root, 'strategies.yaml'),
    LAYOUTS_FILE: path.join(root, 'layouts.yaml'),
    METRIC_AGGREGATES_FILE: path.join(root, 'metric-aggregates.yaml'),
  };
  return { get: (key: string) => paths[key] } as never;
}

describe('GET /api/layouts (architecture/chart-layouts.md §2.3)', () => {
  it('returns both configured layouts, correctly shaped', () => {
    const config = new AppConfigService(fakeNestConfig());
    const controller = new LayoutsController(config);

    const layouts = controller.list();
    expect(layouts.map((l) => l.id)).toEqual(['crypto', 'us-indices']);

    const crypto = layouts.find((l) => l.id === 'crypto')!;
    expect(crypto.grid).toEqual({ columns: 4, rows: 1 }); // chart-layouts.md §11.3: one row of columns
    expect(crypto.panels).toHaveLength(4);
    expect(crypto.panels.map((p) => p.id)).toEqual(['btc', 'eth', 'btc-oi', 'dxy']);
    expect(crypto.panels.find((p) => p.id === 'btc-oi')).toMatchObject({
      kind: 'metric',
      instrument: 'binance:BTCUSDT',
      metric: 'openInterest',
      aggregate: 'btc-perp-oi', // architecture/aggregate-oi.md §3.3
      signals: false,
    });
    expect(config.metricAggregates.map((a) => [a.id, a.countingConvention, a.members.map((m) => m.id)])).toEqual([
      ['btc-perp-oi', 'one-sided', ['binance:BTCUSDT', 'bybit:BTCUSDT', 'hyperliquid:BTC']],
    ]);
    expect(crypto.panels.filter((p) => p.signals).map((p) => p.id)).toEqual(['btc', 'eth']);
    expect(crypto.panels.find((p) => p.id === 'dxy')).toMatchObject({
      kind: 'candles',
      instrument: 'capitalcom:DXY',
      signals: false,
    });

    const usIndices = layouts.find((l) => l.id === 'us-indices')!;
    expect(usIndices.grid).toEqual({ columns: 3, rows: 1 });
    expect(usIndices.panels.map((p) => p.instrument)).toEqual([
      'capitalcom:US100',
      'capitalcom:US500',
      'capitalcom:DXY',
    ]);
    expect(usIndices.panels.every((p) => p.signals === false)).toBe(true);
  });
});
