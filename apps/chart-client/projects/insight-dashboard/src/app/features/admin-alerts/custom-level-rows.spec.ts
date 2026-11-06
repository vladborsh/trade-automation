import { ApiError } from '@backtest-core/api/api-error';
import { describe, expect, it } from 'vitest';
import { CUSTOM_EVENT_COLUMNS, createBody, customLevelErrorKey, parsePriceText, toCustomLevelRow } from './custom-level-rows';

/** IB-128 (alerts design §4 P9) — the custom levels block's mapping. */
describe('custom level rows (IB-128)', () => {
  it('the price: a dot for decimals; a comma, a sign, an exponent or zero is refused', () => {
    expect(parsePriceText(' 72000 ')).toBe(72_000);
    expect(parsePriceText('0.3125')).toBe(0.3125);
    for (const bad of ['72,000', '0,31', '-1', '+1', '1e5', '0', '0.0', '', '.5', '5.', 'abc']) expect(parsePriceText(bad)).toBeNull();
  });

  it('the body: coin and price, the note only when typed', () => {
    expect(createBody({ symbol: 'BTCUSDT', price: '72000', note: '  ' })).toEqual({ symbol: 'BTCUSDT', price: 72_000 });
    expect(createBody({ symbol: 'BTCUSDT', price: '72000', note: ' range high ' })).toEqual({ symbol: 'BTCUSDT', price: 72_000, note: 'range high' });
    expect(createBody({ symbol: '', price: '72000', note: '' })).toBeNull();
    expect(createBody({ symbol: 'BTCUSDT', price: '72,000', note: '' })).toBeNull();
  });

  it('a row: the four events of an open, in order, with their switches', () => {
    expect(CUSTOM_EVENT_COLUMNS.map((c) => c.event)).toEqual(['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below']);
    const row = toCustomLevelRow({
      id: 7, symbol: 'BTCUSDT', base: 'BTC', price: 72_000, note: null, createdBy: 1, createdAt: Date.UTC(2026, 10, 6, 9, 30) / 1000,
      events: { breakout_up: true, breakout_down: true, sweep_above: false, sweep_below: true },
    });
    expect(row).toEqual({
      id: 7, symbol: 'BTCUSDT', price: '72000', note: '', added: '2026-11-06 09:30',
      cells: [{ event: 'breakout_up', on: true }, { event: 'breakout_down', on: true }, { event: 'sweep_above', on: false }, { event: 'sweep_below', on: true }],
    });
  });

  it('errors by code: the cap, the coin not listed, anything else', () => {
    expect(customLevelErrorKey(new ApiError(409, 'TOO_MANY_LEVELS', 'x'))).toBe('customLevels.tooMany');
    expect(customLevelErrorKey(new ApiError(404, 'NOT_FOUND', 'x'))).toBe('customLevels.notListed');
    expect(customLevelErrorKey(new ApiError(400, 'INVALID_LEVEL', 'x'))).toBe('alerts.failed');
    expect(customLevelErrorKey(new Error('network'))).toBe('alerts.failed');
  });
});
