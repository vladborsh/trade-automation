import * as fs from 'fs';
import * as path from 'path';
import { classOf, classTable } from '../../src/venues/binance/exchange-info';
import { classify, universeClasses } from '../../src/web/liquidations/asset-classes';
import { stubClassifier } from './liquidations-test-classifier';

/** IB-084 D6 — classes from the real exchangeInfo shape (captured 2026-11-03, one probe). */
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'binance', 'exchangeInfo-classes.json'), 'utf8'));

describe('exchangeInfo → asset class', () => {
  const table = classTable(fixture);

  it('COIN is crypto (non-ASCII bases and quarterlies too), TRADIFI is tradfi', () => {
    expect(table.get('BTCUSDT')).toBe('crypto');
    expect(table.get('币安人生USDT')).toBe('crypto');
    expect(table.get('BTCUSDT_261225')).toBe('crypto');
    expect(table.get('XAUUSDT')).toBe('tradfi');
    expect(table.get('SPYUSDT')).toBe('tradfi');
  });

  it('every TRADIFI kind in the capture is tradfi; INDEX and PERPETUAL/PREMARKET are unknown, never crypto', () => {
    for (const s of fixture.symbols as Array<{ symbol: string; contractType: string; underlyingType: string }>) {
      if (s.contractType === 'TRADIFI_PERPETUAL') expect(classOf(s)).toBe('tradfi');
      else if (s.underlyingType === 'COIN') expect(classOf(s)).toBe('crypto');
      else expect(classOf(s)).toBe('unknown');
    }
    expect((fixture.symbols as Array<{ underlyingType: string }>).some((s) => s.underlyingType === 'INDEX')).toBe(true);
  });

  it('a symbol exchangeInfo does not list is unknown', () => {
    expect(classOf(undefined)).toBe('unknown');
  });

  it('a body without symbols[] throws rather than classing everything unknown silently', () => {
    expect(() => classTable({})).toThrow(/symbols/);
  });
});

describe('classify (universe first, then Binance, else unknown)', () => {
  const universe = universeClasses([
    { id: 'XAUUSDT', base: 'XAU', asset_class: 'tradfi', quote: 'USDT', binance_perp: 'XAUUSDT', bybit_linear: 'XAUUSDT', okx_swap: 'XAU-USDT-SWAP', listed_perp: '2025-12-11' },
  ]);
  const binance = new Map([['DOGEUSDT', 'crypto' as const], ['XAUUSDT', 'crypto' as const]]);

  it('the YAML wins over exchangeInfo, on every venue spelling', () => {
    expect(classify('binance', 'XAUUSDT', universe, binance)).toBe('tradfi');
    expect(classify('okx', 'XAU-USDT-SWAP', universe, binance)).toBe('tradfi');
  });

  it('a non-universe Binance symbol takes exchangeInfo; a non-universe Bybit/OKX one is unknown', () => {
    expect(classify('binance', 'DOGEUSDT', universe, binance)).toBe('crypto');
    expect(classify('bybit', 'DOGEUSDT', universe, binance)).toBe('unknown');
  });

  it('with exchangeInfo unavailable, non-universe Binance symbols are unknown — not crypto by default', () => {
    expect(classify('binance', 'DOGEUSDT', universe, null)).toBe('unknown');
  });

  it('the cached classifier fetches exchangeInfo once, and a failure leaves them unknown', async () => {
    const c = stubClassifier([], [{ symbol: 'DOGEUSDT', contractType: 'PERPETUAL', underlyingType: 'COIN' }]);
    expect(c.classify('binance', 'DOGEUSDT')).toBe('unknown'); // not loaded yet
    await c.ready();
    expect(c.classify('binance', 'DOGEUSDT')).toBe('crypto');
  });
});
