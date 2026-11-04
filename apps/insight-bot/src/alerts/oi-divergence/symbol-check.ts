import type { WebAlertSymbolRefusal } from '@trade-automation/contracts';

/**
 * IB-112 (V17) — may this symbol go on the alert list? Pure, over Binance USD-M `exchangeInfo`'s body:
 * a perpetual that is trading. Binance names TradFi perpetuals (`XAUUSDT`, `TSLAUSDT`) with their own
 * contractType, `TRADIFI_PERPETUAL`; they are perpetuals with OI on `/futures/data`, and the loop
 * already handles their closed sessions (V9's ledger), so they qualify. Quarterlies do not: their OI
 * history is not the coin's, and they expire.
 */
const PERPETUAL_TYPES = new Set(['PERPETUAL', 'TRADIFI_PERPETUAL']);

export type SymbolCheck = { ok: true; base: string } | { ok: false; refusal: Exclude<WebAlertSymbolRefusal, 'already_listed' | 'venue_unavailable'> };

export function checkAlertSymbol(exchangeInfo: unknown, symbol: string): SymbolCheck {
  const symbols = (exchangeInfo as { symbols?: unknown })?.symbols;
  if (!Array.isArray(symbols)) throw new Error('exchangeInfo without a symbols list');
  const row = symbols.find((s): s is { symbol: string; contractType?: string; status?: string; baseAsset?: string } =>
    typeof s === 'object' && s !== null && (s as { symbol?: unknown }).symbol === symbol);
  if (!row) return { ok: false, refusal: 'not_found' };
  if (!PERPETUAL_TYPES.has(String(row.contractType))) return { ok: false, refusal: 'not_perpetual' };
  if (row.status !== 'TRADING') return { ok: false, refusal: 'not_trading' };
  return { ok: true, base: typeof row.baseAsset === 'string' && row.baseAsset.length > 0 ? row.baseAsset : symbol };
}
