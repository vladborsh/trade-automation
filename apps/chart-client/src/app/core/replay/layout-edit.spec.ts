import type { BacktestInstrument, SessionLayout } from '@trade-automation/contracts';
import { ApiError } from '../api/api-error';
import {
  addPanel,
  addableInstruments,
  layoutDiff,
  layoutEditErrorMessage,
  movePanel,
  panelsBlockedByOrders,
  panelsWithActiveOrders,
  removePanel,
  setPanelIndicators,
} from './layout-edit';

const L: SessionLayout = {
  id: 'l',
  name: 'L',
  grid: { columns: 2, rows: 1 },
  panels: [
    { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false },
    { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: false },
  ],
};
const DAY = 86_400_000;
const T0 = Date.UTC(2021, 5, 1);

describe('layout-edit (T-029)', () => {
  it('layoutDiff: added and removed panels; a re-pointed panel is both', () => {
    const next = addPanel(removePanel(L, 'btc'), 'capitalcom:US100');
    expect(layoutDiff(L, next)).toEqual({ added: [next.panels[1]], removed: ['btc'] });
    const repointed: SessionLayout = { ...L, panels: [L.panels[0], { ...L.panels[1], instrument: 'binance:BTCUSDT' }] };
    expect(layoutDiff(L, repointed)).toEqual({ added: [repointed.panels[1]], removed: ['eth'] });
    expect(layoutDiff(L, movePanel(L, 'eth', -1))).toEqual({ added: [], removed: [] }); // a reorder changes no tape
  });

  it('panelsBlockedByOrders mirrors the server: pending/open orders pin their panel id and instrument', () => {
    const orders = [
      { panelId: 'eth', instrument: 'binance:ETHUSDT' as const, status: 'open' as const },
      { panelId: 'btc', instrument: 'binance:BTCUSDT' as const, status: 'closed' as const },
    ];
    expect(panelsBlockedByOrders(removePanel(L, 'btc'), orders)).toEqual([]); // closed orders do not block
    expect(panelsBlockedByOrders(removePanel(L, 'eth'), orders)).toEqual(['eth']);
    expect(panelsWithActiveOrders([...orders, { panelId: 'x', status: 'pending' as const }])).toEqual(new Set(['eth', 'x']));
  });

  it('movePanel swaps neighbours and is a no-op at the ends', () => {
    expect(movePanel(L, 'eth', -1).panels.map((p) => p.id)).toEqual(['eth', 'btc']);
    expect(movePanel(L, 'btc', -1)).toBe(L);
    expect(movePanel(L, 'eth', 1)).toBe(L);
  });

  it('addPanel picks a unique contract-shaped id and widens the grid only when needed', () => {
    const one = addPanel(L, 'binance:BTCUSDT');
    expect(one.panels[2]).toEqual({ id: 'binance-btcusdt', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false });
    expect(one.grid).toEqual({ columns: 3, rows: 1 });
    expect(addPanel(one, 'binance:BTCUSDT').panels[3].id).toBe('binance-btcusdt-2');
    expect(addPanel({ ...L, grid: { columns: 2, rows: 2 } }, 'binance:BTCUSDT').grid).toEqual({ columns: 2, rows: 2 });
    expect(removePanel(L, 'eth').grid).toEqual({ columns: 2, rows: 1 }); // still fits
  });

  it('addableInstruments: covered, overlapping the period, the session currency, not already there', () => {
    const cat = (id: string, ccy: string, cov: [number, number] | null): BacktestInstrument => ({
      id: id as BacktestInstrument['id'], displayName: id, assetClass: 'crypto-perp', sessionCurrency: ccy, pricePrecision: 2,
      coverage: cov && { from: cov[0], to: cov[1] },
      contract: null,
    });
    const session = { sessionCurrency: 'USD', periodFromMs: T0 + 10 * DAY, periodToMs: T0 + 20 * DAY, layout: L };
    const out = addableInstruments(
      [
        cat('binance:BTCUSDT', 'USD', [T0, T0 + 30 * DAY]), // already on the layout
        cat('binance:SOLUSDT', 'USD', [T0, T0 + 30 * DAY]),
        cat('capitalcom:EURCHF', 'CHF', [T0, T0 + 30 * DAY]), // other currency
        cat('capitalcom:US100', 'USD', null), // no 1m
        cat('binance:LATEUSDT', 'USD', [T0 + 25 * DAY, T0 + 30 * DAY]), // after the period
        cat('binance:EDGEUSDT', 'USD', [T0, T0 + 10 * DAY - 60_000 + 1]), // its last bar closes just inside
      ],
      session,
    );
    expect(out.map((i) => i.id)).toEqual(['binance:SOLUSDT', 'binance:EDGEUSDT']);
  });

  it('layoutEditErrorMessage covers the codes, the plain 409 and the network', () => {
    expect(layoutEditErrorMessage(new ApiError(422, 'MIXED_SESSION_CURRENCY', 'x'))).toMatch(/session currency/);
    expect(layoutEditErrorMessage(new ApiError(422, 'LAYOUT_TOO_MANY_PANELS', 'x'))).toMatch(/at most 4/);
    expect(layoutEditErrorMessage(new ApiError(422, 'PERIOD_OUTSIDE_COVERAGE', 'x'))).toMatch(/does not overlap/);
    expect(layoutEditErrorMessage(new ApiError(422, 'INSTRUMENT_NOT_AVAILABLE', 'x'))).toMatch(/no stored 1m/);
    expect(layoutEditErrorMessage(new ApiError(409, 'SESSION_COMPLETE', 'x'))).toMatch(/complete/);
    expect(layoutEditErrorMessage(new ApiError(409, null, 'x'))).toMatch(/pending or open orders/);
    expect(layoutEditErrorMessage(new ApiError(500, null, 'x'))).toMatch(/Could not change/);
    expect(layoutEditErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Cannot reach/);
  });
});

describe('setPanelIndicators (T-028)', () => {
  it("replaces one panel's indicators and drops the field when emptied", () => {
    const withEma = setPanelIndicators(L, 'eth', [{ id: 'ema', params: { length: 9 } }]);
    expect(withEma.panels[1].indicators).toEqual([{ id: 'ema', params: { length: 9 } }]);
    expect(withEma.panels[0]).toBe(L.panels[0]);
    expect(setPanelIndicators(withEma, 'eth', []).panels[1]).not.toHaveProperty('indicators');
    expect(layoutDiff(L, withEma)).toEqual({ added: [], removed: [] }); // no tape change
  });
});
