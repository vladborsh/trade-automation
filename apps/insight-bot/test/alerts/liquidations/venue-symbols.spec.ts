import { COIN_M_PATTERNS } from '../../../src/web/liquidations/pg/episodes.repo';
import { trackedSymbols, venuePairs, venueSymbols, type UniverseSpelling } from '../../../src/alerts/liquidations/venue-symbols';

/** IB-122 (L5) — one mapper for the collectors and the loop; universe spellings win; never COIN-M. */
const UNIVERSE: UniverseSpelling[] = [
  { id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' },
  { id: '1000PEPEUSDT', base: 'PEPE', binance_perp: '1000PEPEUSDT', bybit_linear: '1000PEPEUSDT', okx_swap: 'PEPE-USDT-SWAP' },
  { id: 'HYPEUSDT', base: 'HYPE', binance_perp: 'HYPEUSDT', bybit_linear: 'HYPEUSDT' }, // not on OKX
];

describe('venueSymbols (L5)', () => {
  it('a coin outside the universe is named from its base: {BASE}USDT on Binance and Bybit, {BASE}-USDT-SWAP on OKX', () => {
    expect(venueSymbols('TRXUSDT', 'TRX', UNIVERSE)).toEqual({ binance: 'TRXUSDT', bybit: 'TRXUSDT', okx: 'TRX-USDT-SWAP' });
  });

  it('a universe coin uses universe.yaml\'s spellings (the 1000x prefix differs by venue)', () => {
    expect(venueSymbols('1000PEPEUSDT', '1000PEPE', UNIVERSE)).toEqual({ binance: '1000PEPEUSDT', bybit: '1000PEPEUSDT', okx: 'PEPE-USDT-SWAP' });
    expect(venueSymbols('HYPEUSDT', 'HYPE', UNIVERSE)).toEqual({ binance: 'HYPEUSDT', bybit: 'HYPEUSDT', okx: null });
  });

  it('a base that is not a plain ticker names nothing, rather than a guessed contract', () => {
    expect(venueSymbols('XUSDT', 'X_1', UNIVERSE)).toBeNull();
    expect(venueSymbols('XUSDT', '', UNIVERSE)).toBeNull();
  });

  it('IB-BUG-039: no symbol it produces can be a COIN-M or coin-quoted contract', () => {
    const bases = ['BTC', 'ETH', 'BNB', 'TRX', 'SOL', '1000SHIB', 'USD'];
    const produced = bases.flatMap((b) => Object.values(venueSymbols(`${b}USDT`, b, []) ?? {})).filter((s): s is string => s !== null);
    expect(produced.length).toBe(bases.length * 3);
    expect(produced.filter((s) => COIN_M_PATTERNS.some((p) => new RegExp(p).test(s)))).toEqual([]);
  });

  it('venuePairs lists Binance first and skips a venue without a contract', () => {
    expect(venuePairs({ binance: 'HYPEUSDT', bybit: 'HYPEUSDT', okx: null })).toEqual([{ venue: 'binance', symbol: 'HYPEUSDT' }, { venue: 'bybit', symbol: 'HYPEUSDT' }]);
  });
});

describe('trackedSymbols (L5): universe ∪ enabled alert coins', () => {
  it('universe order first (the liveness topic stays on the first), then extra alert coins, no duplicates', () => {
    const coins = [{ symbol: 'TRXUSDT', base: 'TRX' }, { symbol: 'BTCUSDT', base: 'BTC' }];
    expect(trackedSymbols('bybit', UNIVERSE, coins)).toEqual(['BTCUSDT', '1000PEPEUSDT', 'HYPEUSDT', 'TRXUSDT']);
    expect(trackedSymbols('okx', UNIVERSE, coins)).toEqual(['BTC-USDT-SWAP', 'PEPE-USDT-SWAP', 'TRX-USDT-SWAP']);
  });
});
