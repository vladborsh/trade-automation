import * as fs from 'fs';
import * as path from 'path';
import { loadUniverseFile, parseUniverse } from '../src/config/universe.loader';

const VALID = `
signal_set: [BTCUSDT, ETHUSDT]
symbols:
  - id: BTCUSDT
    base: BTC
    quote: USDT
    binance_perp: BTCUSDT
    binance_spot: BTCUSDT
    bybit_linear: BTCUSDT
    okx_swap: BTC-USDT-SWAP
    listed_perp: 2020-01-01
  - id: ETHUSDT
    base: ETH
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

describe('config/universe.yaml (the shipped file)', () => {
  const file = path.join(__dirname, '..', 'config', 'universe.yaml');
  const universe = parseUniverse(fs.readFileSync(file, 'utf8'), file);

  it('holds the top 30 perps and the stage-1 signal set', () => {
    expect(universe.symbols).toHaveLength(30);
    expect(universe.signal_set).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('maps every symbol to a Binance spot market and gives it an archive listing date', () => {
    for (const s of universe.symbols) {
      expect(s.binance_perp).toBe(s.id);
      // The universe is filtered to perps whose base has a Binance spot USDT pair, so spot CVD
      // is available for all thirty (§2.3 expects no gap here in the top 30).
      expect(s.binance_spot).toBeDefined();
      expect(s.listed_perp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${s.listed_perp}T00:00:00Z`).getTime()).toBeGreaterThan(Date.UTC(2019, 8, 1));
    }
  });
});
