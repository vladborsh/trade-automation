import type { InstrumentId, Layout } from '@trade-automation/contracts';
import { buildSessionLayout, panelIdFor, presetOptions } from './session-layout';

const crypto: Layout = {
  id: 'crypto',
  name: 'Crypto trading',
  grid: { columns: 4, rows: 1 },
  panels: [
    { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: true },
    { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: true, title: 'Ether' },
    { id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest', signals: false },
    { id: 'dxy', kind: 'candles', instrument: 'capitalcom:DXY', signals: false },
  ],
};
const six: Layout = {
  id: 'six',
  name: 'Six',
  grid: { columns: 3, rows: 2 },
  panels: (['a', 'b', 'c', 'd', 'e'] as const).map((s) => ({ id: s, kind: 'candles' as const, instrument: `binance:${s.toUpperCase()}USDT` as InstrumentId, signals: false })),
};
const available = new Set<InstrumentId>(['binance:BTCUSDT', 'binance:ETHUSDT', 'binance:AUSDT']);

describe('presetOptions (D10)', () => {
  it('strips metric panels and leaves out candle panels whose instrument has no stored 1m', () => {
    const [option] = presetOptions([crypto], available);
    expect(option.panels).toEqual([
      { id: 'btc', instrument: 'binance:BTCUSDT' },
      { id: 'eth', instrument: 'binance:ETHUSDT', title: 'Ether' },
    ]);
    expect(option.unavailable).toEqual(['capitalcom:DXY']);
    expect(option.disabledReason).toBeNull();
  });

  it('disables a preset with more than 4 candle panels after stripping', () => {
    const [option] = presetOptions([six], available);
    expect(option.disabledReason).toMatch(/5 candle panels; a session holds at most 4/);
  });

  it('disables a preset none of whose instruments is available', () => {
    const [option] = presetOptions([crypto], new Set());
    expect(option.disabledReason).toMatch(/None of its instruments/);
  });
});

describe('buildSessionLayout', () => {
  it('without a preset: one candle panel per instrument in one row, ids from the instrument', () => {
    expect(buildSessionLayout(['binance:BTCUSDT', 'capitalcom:US100'], null)).toEqual({
      id: 'custom',
      name: 'Custom',
      grid: { columns: 2, rows: 1 },
      panels: [
        { id: 'binance-btcusdt', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false },
        { id: 'capitalcom-us100', kind: 'candles', instrument: 'capitalcom:US100', signals: false },
      ],
    });
  });

  it('with a preset: its panels keep id/title and come first, extras get instrument ids, the preset grid is kept', () => {
    const [option] = presetOptions([crypto], available);
    const layout = buildSessionLayout(['binance:AUSDT', 'binance:ETHUSDT', 'binance:BTCUSDT'], option);
    expect(layout.id).toBe('crypto');
    expect(layout.grid).toEqual({ columns: 4, rows: 1 });
    expect(layout.panels.map((p) => [p.id, p.instrument, p.title])).toEqual([
      ['btc', 'binance:BTCUSDT', undefined],
      ['eth', 'binance:ETHUSDT', 'Ether'],
      ['binance-ausdt', 'binance:AUSDT', undefined],
    ]);
    expect(layout.panels.every((p) => p.kind === 'candles' && p.signals === false)).toBe(true);
  });

  it('falls back to one row when the preset grid has no room', () => {
    const small = presetOptions([{ ...crypto, grid: { columns: 1, rows: 1 } }], available)[0];
    expect(buildSessionLayout(['binance:BTCUSDT', 'binance:ETHUSDT'], small).grid).toEqual({ columns: 2, rows: 1 });
  });

  it('never repeats a panel id', () => {
    const [option] = presetOptions([{ ...crypto, panels: [{ id: 'binance-ausdt', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] }], available);
    const ids = buildSessionLayout(['binance:BTCUSDT', 'binance:AUSDT'], option).panels.map((p) => p.id);
    expect(ids).toEqual(['binance-ausdt', 'binance-ausdt-2']);
  });

  it('panelIdFor matches the contract id pattern', () => {
    expect(panelIdFor('capitalcom:EURCHF')).toBe('capitalcom-eurchf');
    expect(panelIdFor('binance:BTC_USDT')).toMatch(/^[a-z0-9-]+$/);
  });
});
