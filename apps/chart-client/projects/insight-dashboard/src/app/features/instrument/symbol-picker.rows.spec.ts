import type { WebUniverseSummaryRow, WebUniverseSymbol } from '@trade-automation/contracts';
import { enterTarget, matches, pickerRows } from './symbol-picker.rows';

const venues = { binancePerp: true, binanceSpot: true, bybitLinear: true, okxSwap: true };
const sym = (id: string, base: string, rank: number): WebUniverseSymbol =>
  ({ id, base, quote: 'USDT', volumeRank: rank, inSignalSet: false, venues });
const UNIVERSE = [sym('BTCUSDT', 'BTC', 1), sym('ETHUSDT', 'ETH', 2), sym('ETHFIUSDT', 'ETHFI', 3), sym('SOLUSDT', 'SOL', 4)];

const row = (id: string, over: Partial<WebUniverseSummaryRow> = {}): WebUniverseSummaryRow => ({
  id, base: id.replace('USDT', ''), volumeRank: 1, lastPrice: 1, changePct24h: 1.84,
  fundingRate: 0.000123, nextFundingTimeMs: 1, oiChangePct24h: 3.44, ...over,
});

describe('matches', () => {
  it('finds a coin by the start of its base or anywhere in its id, case-insensitively', () => {
    expect(matches(UNIVERSE[0], 'bt')).toBe(true);
    expect(matches(UNIVERSE[0], 'cusd')).toBe(true);
    expect(matches(UNIVERSE[3], 'xrp')).toBe(false);
    expect(matches(UNIVERSE[3], '   ')).toBe(true); // an empty query lists everything
  });
});

describe('pickerRows', () => {
  it('keeps the top list order and marks the open symbol', () => {
    const rows = pickerRows(UNIVERSE, null, '', 'ETHUSDT');
    expect(rows.map((r) => r.id)).toEqual(['BTCUSDT', 'ETHUSDT', 'ETHFIUSDT', 'SOLUSDT']);
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual(['ETHUSDT']);
  });

  it('filters by what was typed', () => {
    expect(pickerRows(UNIVERSE, null, 'eth', '').map((r) => r.id)).toEqual(['ETHUSDT', 'ETHFIUSDT']);
  });

  it('without the summary every figure is null, never zero', () => {
    const [btc] = pickerRows(UNIVERSE, null, 'btc', '');
    expect([btc.change, btc.funding, btc.oi]).toEqual([null, null, null]);
    expect([btc.changeSign, btc.fundingSign, btc.oiSign]).toEqual([null, null, null]);
  });

  it('formats funding from a FRACTION to a percentage, not the raw venue number', () => {
    const [btc] = pickerRows(UNIVERSE, [row('BTCUSDT', { fundingRate: 0.000123 })], 'btc', '');
    expect(btc.funding).toBe('+0.0123');
  });

  it('signs negatives with the typographic minus and keeps the sign for colour', () => {
    const [sol] = pickerRows(UNIVERSE, [row('SOLUSDT', { changePct24h: -0.92, oiChangePct24h: -1.84, fundingRate: -0.0000310 })], 'sol', '');
    expect(sol.change).toBe('−0.92');
    expect(sol.oi).toBe('−1.8');
    expect(sol.funding).toBe('−0.0031');
    expect([sol.changeSign, sol.oiSign, sol.fundingSign]).toEqual([-1, -1, -1]);
  });

  it('a coin the summary left out keeps its row, with dashes', () => {
    const rows = pickerRows(UNIVERSE, [row('BTCUSDT')], '', '');
    expect(rows).toHaveLength(4);
    expect(rows[1].change).toBeNull();
    expect(rows[0].change).toBe('+1.84');
  });
});

describe('enterTarget', () => {
  it('opens the only match, else the typed text as a symbol, else nothing', () => {
    const rows = pickerRows(UNIVERSE, null, 'sol', '');
    expect(enterTarget(rows, 'sol')).toBe('SOLUSDT');
    expect(enterTarget(pickerRows(UNIVERSE, null, 'doge', ''), 'doge')).toBe('DOGE');
    expect(enterTarget(pickerRows(UNIVERSE, null, '', ''), '  ')).toBeNull();
  });
});
