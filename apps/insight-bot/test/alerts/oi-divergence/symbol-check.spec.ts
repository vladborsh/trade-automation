import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAlertSymbol } from '../../../src/alerts/oi-divergence/symbol-check';

/**
 * IB-112 (V17) — adding a coin, checked against Binance's own `exchangeInfo` (the committed capture,
 * 2026-11-03/04): every refusal comes from a real row, so a venue that renames a field fails here.
 */
const INFO = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'binance', 'exchangeInfo-classes.json'), 'utf8'));
const row = (pred: (s: { symbol: string; contractType: string; status: string }) => boolean) =>
  (INFO.symbols as Array<{ symbol: string; contractType: string; status: string }>).find(pred)?.symbol as string;

describe('checkAlertSymbol over the real exchangeInfo', () => {
  it('a trading crypto perpetual is accepted, with its base asset', () => {
    expect(checkAlertSymbol(INFO, 'BTCUSDT')).toEqual({ ok: true, base: 'BTC' });
  });
  it('a TradFi perpetual (Binance: TRADIFI_PERPETUAL) is a perpetual too', () => {
    const tradfi = row((s) => s.contractType === 'TRADIFI_PERPETUAL' && s.status === 'TRADING');
    expect(tradfi).toBeDefined();
    expect(checkAlertSymbol(INFO, tradfi)).toMatchObject({ ok: true });
  });
  it('a quarterly contract is refused: not_perpetual', () => {
    const quarterly = row((s) => s.contractType === 'CURRENT_QUARTER');
    expect(quarterly).toBeDefined();
    expect(checkAlertSymbol(INFO, quarterly)).toEqual({ ok: false, refusal: 'not_perpetual' });
  });
  it('a perpetual that is settling is refused: not_trading', () => {
    const settling = row((s) => s.contractType === 'PERPETUAL' && s.status !== 'TRADING');
    expect(settling).toBeDefined();
    expect(checkAlertSymbol(INFO, settling)).toEqual({ ok: false, refusal: 'not_trading' });
  });
  it('a symbol Binance does not list is refused: not_found; a body without symbols throws (venue changed)', () => {
    expect(checkAlertSymbol(INFO, 'NOSUCHUSDT')).toEqual({ ok: false, refusal: 'not_found' });
    expect(() => checkAlertSymbol({}, 'BTCUSDT')).toThrow();
  });
});
