import type { WebAssetClass } from '@trade-automation/contracts';

/**
 * IB-084 (market-page design D6) — the asset class of a Binance USD-M symbol OUTSIDE the universe
 * (`!forceOrder@arr` carries every symbol), from `GET /fapi/v1/exchangeInfo` (weight 1).
 *
 * Measured 2026-11-03, one probe (test/fixtures/binance/exchangeInfo-classes.json):
 * - `underlyingType: COIN` — crypto, whatever the contract (perp, quarterly; non-ASCII bases too);
 * - `contractType: TRADIFI_PERPETUAL` — equities (US, HK, KR, CN), commodities, FX, pre-IPO;
 * - anything else — `PERPETUAL`/`INDEX` (crypto indices) and `PERPETUAL`/`PREMARKET` — is
 *   **unknown**: counted, in no total. The design's rule: never default to crypto, never guess.
 *
 * So the field DOES separate commodities and equities from coins; no hand list is needed.
 */
export interface ExchangeInfoSymbol {
  symbol: string;
  contractType?: string;
  underlyingType?: string;
}

export function classOf(info: ExchangeInfoSymbol | undefined): WebAssetClass {
  if (!info) return 'unknown';
  if (info.contractType === 'TRADIFI_PERPETUAL') return 'tradfi';
  if (info.underlyingType === 'COIN') return 'crypto';
  return 'unknown';
}

/** The symbol → class table from one exchangeInfo body. Throws on a body without `symbols[]`. */
export function classTable(body: unknown): Map<string, WebAssetClass> {
  const symbols = (body as { symbols?: unknown })?.symbols;
  if (!Array.isArray(symbols)) throw new Error('exchangeInfo: no symbols[] in the body');
  const table = new Map<string, WebAssetClass>();
  for (const s of symbols as ExchangeInfoSymbol[]) {
    if (typeof s?.symbol === 'string') table.set(s.symbol, classOf(s));
  }
  return table;
}
