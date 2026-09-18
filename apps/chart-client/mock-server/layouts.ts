import type { Layout } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §2.1 / §6.7 — the mock's `GET /api/layouts`
 * fixture: both named layouts, with the Capital.com panels bound to the
 * mock-only `-MOCK` instrument ids (fixtures.ts) since this server has no
 * live Capital.com session to back the real `capitalcom:DXY`/`capitalcom:US500`.
 */
export const MOCK_LAYOUTS: Layout[] = [
  {
    id: 'crypto',
    name: 'Crypto trading',
    grid: { columns: 4, rows: 1 },
    panels: [
      { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: true },
      { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: true },
      { id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest', signals: false },
      { id: 'dxy', kind: 'candles', instrument: 'capitalcom:DXY-MOCK', signals: false },
    ],
  },
  {
    id: 'us-indices',
    name: 'US indices',
    grid: { columns: 3, rows: 1 },
    panels: [
      { id: 'us100', kind: 'candles', instrument: 'capitalcom:US100', signals: false },
      { id: 'us500', kind: 'candles', instrument: 'capitalcom:US500-MOCK', signals: false },
      { id: 'dxy', kind: 'candles', instrument: 'capitalcom:DXY-MOCK', signals: false },
    ],
  },
];
