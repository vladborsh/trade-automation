import * as fs from 'fs';
import * as path from 'path';
import { loadUniverseFile, parseUniverse } from '../src/config/universe.loader';

const VALID = `
signal_set: [BTCUSDT, ETHUSDT]
symbols:
  - id: BTCUSDT
    base: BTC
    asset_class: crypto
    quote: USDT
    binance_perp: BTCUSDT
    binance_spot: BTCUSDT
    bybit_linear: BTCUSDT
    okx_swap: BTC-USDT-SWAP
    listed_perp: 2020-01-01
  - id: ETHUSDT
    base: ETH
    asset_class: crypto
    quote: USDT
    binance_perp: ETHUSDT
    listed_perp: '2020-01-01'
`;

describe('parseUniverse', () => {
  it('parses the symbols and the signal set', () => {
    const universe = parseUniverse(VALID);
    expect(universe.signal_set).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(universe.symbols.map((s) => s.id)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(universe.symbols[0].okx_swap).toBe('BTC-USDT-SWAP');
  });

  it('normalises listed_perp to an ISO day, whether yaml gave it as a date or a string', () => {
    // An unquoted 2020-01-01 becomes a JS Date in yaml; a quoted one stays a string. Both are
    // the same calendar day, and `symbols.listed_perp` is a SQL `date`.
    const universe = parseUniverse(VALID);
    expect(universe.symbols[0].listed_perp).toBe('2020-01-01');
    expect(universe.symbols[1].listed_perp).toBe('2020-01-01');
  });

  it('leaves a missing spot/bybit/okx mapping undefined rather than defaulting it', () => {
    // §2.3: "a symbol with no binance_spot simply has no spot CVD; features that need it are
    // null for it, never silently zero."
    const eth = parseUniverse(VALID).symbols[1];
    expect(eth.binance_spot).toBeUndefined();
    expect(eth.bybit_linear).toBeUndefined();
    expect(eth.okx_swap).toBeUndefined();
  });

  it('rejects a signal_set member that is not in symbols', () => {
    const text = VALID.replace('[BTCUSDT, ETHUSDT]', '[BTCUSDT, SOLUSDT]');
    expect(() => parseUniverse(text)).toThrow(/signal_set references 'SOLUSDT'/);
  });

  it('rejects a duplicate symbol id', () => {
    const text = VALID.replace('  - id: ETHUSDT', '  - id: BTCUSDT').replace('[BTCUSDT, ETHUSDT]', '[BTCUSDT]');
    expect(() => parseUniverse(text)).toThrow(/duplicate symbol id 'BTCUSDT'/);
  });

  it('rejects an unknown key, a missing required field and a malformed date', () => {
    expect(() => parseUniverse(VALID + '    extra_key: 1\n')).toThrow(/Invalid universe file/);
    expect(() => parseUniverse(VALID.replace('    base: BTC\n', ''))).toThrow(/Invalid universe file/);
    expect(() => parseUniverse(VALID.replace('2020-01-01', "'2020-13-01'"))).toThrow(/Invalid universe file/);
  });

  it('rejects yaml that is not a universe document at all', () => {
    expect(() => parseUniverse('just a string')).toThrow(/Invalid universe file/);
    expect(() => parseUniverse('signal_set: [BTCUSDT]\nsymbols: []\n')).toThrow(/Invalid universe file/);
  });

  it('names the file it could not find', () => {
    expect(() => loadUniverseFile('config/does-not-exist.yaml')).toThrow(/Universe file not found/);
  });
});

describe('IB-084 D6: asset_class is required, with no default', () => {
  it('a symbol without asset_class fails the load, naming the field', () => {
    const missing = VALID.replace('    asset_class: crypto\n    quote: USDT\n    binance_perp: ETHUSDT', '    quote: USDT\n    binance_perp: ETHUSDT');
    expect(missing).not.toBe(VALID);
    expect(() => parseUniverse(missing)).toThrow(/asset_class/);
  });

  it('accepts only crypto or tradfi — "unknown" is a runtime verdict, never a configured one', () => {
    expect(() => parseUniverse(VALID.replace('asset_class: crypto', 'asset_class: unknown'))).toThrow(/asset_class/);
    expect(() => parseUniverse(VALID.replace('asset_class: crypto', 'asset_class: tradfi'))).not.toThrow();
  });
});

describe('config/universe.yaml (the shipped file)', () => {
  const file = path.join(__dirname, '..', 'config', 'universe.yaml');
  const universe = parseUniverse(fs.readFileSync(file, 'utf8'), file);

  // IB-070: TradFi perps added by hand after the crypto top 30 (see the file's header).
  const TRADFI = ['XAUUSDT', 'XAGUSDT', 'CLUSDT', 'BZUSDT', 'NATGASUSDT', 'COPPERUSDT', 'XPTUSDT', 'XPDUSDT', 'SPYUSDT', 'QQQUSDT'];

  it('holds the top 30 crypto perps, then the hand-added TradFi perps, and the stage-1 signal set', () => {
    expect(universe.symbols).toHaveLength(40);
    expect(universe.symbols.slice(30).map((s) => s.id)).toEqual(TRADFI);
    expect(universe.signal_set).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('maps every crypto symbol to a Binance spot market and gives every symbol an archive listing date', () => {
    for (const s of universe.symbols) {
      expect(s.binance_perp).toBe(s.id);
      // The crypto top 30 is filtered to perps whose base has a Binance spot USDT pair, so spot
      // CVD is available for all thirty (§2.3 expects no gap there). TradFi perps have none.
      if (TRADFI.includes(s.id)) expect(s.binance_spot).toBeUndefined();
      else expect(s.binance_spot).toBeDefined();
      expect(s.listed_perp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${s.listed_perp}T00:00:00Z`).getTime()).toBeGreaterThan(Date.UTC(2019, 8, 1));
    }
  });

  it('keeps the market-context top 20 all-crypto: every one of the first 20 carries a coingecko_id', () => {
    // ContextService.coins() slices the first 20 THEN drops ids it lacks, while the context
    // controller's topCoins() drops first THEN slices 20. They agree only while the first 20 all
    // have an id — which listing the TradFi perps after the top 30 is what preserves.
    const first20 = universe.symbols.slice(0, 20);
    expect(first20.filter((s) => s.coingecko_id === undefined).map((s) => s.id)).toEqual([]);
    expect(first20.some((s) => TRADFI.includes(s.id))).toBe(false);
  });

  it('gives the TradFi perps no coingecko_id, so the market-cap chart never reads a guessed coin', () => {
    for (const s of universe.symbols.filter((x) => TRADFI.includes(x.id))) {
      expect(s.coingecko_id).toBeUndefined();
    }
  });
});

describe('IB-084 D6: the shipped classes agree with Binance', () => {
  const file = path.join(__dirname, '..', 'config', 'universe.yaml');
  const universe = parseUniverse(fs.readFileSync(file, 'utf8'), file);
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'binance', 'exchangeInfo-classes.json'), 'utf8')) as { symbols: Array<{ symbol: string; contractType: string; underlyingType: string }> };

  it('every universe asset_class matches exchangeInfo (captured 2026-11-03): 30 crypto, 10 tradfi', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { classOf } = require('../src/venues/binance/exchange-info');
    const mismatch = universe.symbols
      .map((s) => ({ id: s.id, yaml: s.asset_class, binance: classOf(fixture.symbols.find((f) => f.symbol === s.binance_perp)) }))
      .filter((x) => x.yaml !== x.binance);
    expect(mismatch).toEqual([]);
    expect(universe.symbols.filter((s) => s.asset_class === 'crypto')).toHaveLength(30);
    expect(universe.symbols.filter((s) => s.asset_class === 'tradfi')).toHaveLength(10);
  });
});
