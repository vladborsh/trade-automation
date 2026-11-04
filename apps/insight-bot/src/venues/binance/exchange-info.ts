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
  baseAsset?: string;
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

/**
 * IB-BUG-025 — Binance contracts of a universe COIN in another quote or form (BTCUSDC, BTCUSD1,
 * BTCUSDT_261225, 1000PEPEUSDC): their liquidations are that coin's, so they count in its row.
 * Matched on the venue's own `baseAsset` against the base asset of the coin's universe contract,
 * so a 1000-prefix matches only its 1000-prefix (`1000PEPE`), never `PEPE`. Only crypto (COIN,
 * not TRADIFI); a symbol whose base matches no universe coin is left alone (it is counted in the
 * block's `otherCoins`) — never guessed. Universe spellings themselves are never aliased, which
 * is what keeps the SQL map's join one row per liquidation. Pure.
 */
export function aliasTable(body: unknown, universe: ReadonlyArray<{ id: string; binance_perp: string }>): Map<string, string> {
  const symbols = (body as { symbols?: unknown })?.symbols;
  if (!Array.isArray(symbols)) throw new Error('exchangeInfo: no symbols[] in the body');
  const bySymbol = new Map((symbols as ExchangeInfoSymbol[]).filter((s) => typeof s?.symbol === 'string').map((s) => [s.symbol, s]));
  const own = new Set(universe.map((u) => u.binance_perp));
  const idByBase = new Map<string, string>();
  for (const u of universe) {
    const s = bySymbol.get(u.binance_perp);
    if (s && classOf(s) === 'crypto' && s.baseAsset) idByBase.set(s.baseAsset, u.id);
  }
  const out = new Map<string, string>();
  for (const s of bySymbol.values()) {
    if (own.has(s.symbol) || classOf(s) !== 'crypto' || !s.baseAsset) continue;
    const id = idByBase.get(s.baseAsset);
    if (id) out.set(s.symbol, id);
  }
  return out;
}

/** IB-BUG-025: symbol → the venue's base asset, for counting distinct coins. Pure. */
export function baseTable(body: unknown): Map<string, string> {
  const symbols = (body as { symbols?: unknown })?.symbols;
  if (!Array.isArray(symbols)) throw new Error('exchangeInfo: no symbols[] in the body');
  return new Map((symbols as ExchangeInfoSymbol[]).filter((s) => typeof s?.symbol === 'string' && typeof s.baseAsset === 'string').map((s) => [s.symbol, s.baseAsset as string]));
}
