import type { LiqVenue } from '@trade-automation/contracts';

/**
 * IB-122 (design L5) — a coin's liquidation symbol on each venue. Pure; used by the Bybit and OKX
 * collectors (what to subscribe / keep) and by the alert loop (what to read), so the two cannot disagree.
 *
 * - A **universe** coin uses universe.yaml's spellings: they were checked by hand and carry the venue's
 *   own quirks (Binance and Bybit `1000PEPEUSDT`, OKX `PEPE-USDT-SWAP`).
 * - Any other coin is named from its base: `{BASE}USDT` on Binance and Bybit, `{BASE}-USDT-SWAP` on OKX.
 *   For a coin a venue prefixes (`1000…`), the guess is wrong on the venue that does not, which reads
 *   as "no rows" and is named in the message (L3), never as a different coin's money.
 *
 * Only USDT-linear contracts (IB-BUG-018 / IB-BUG-039): COIN-M `…USD_PERP`, quarterlies and
 * coin-quoted contracts are never produced, and a base that would build one is refused.
 */
export interface VenueSymbols {
  binance: string;
  bybit: string | null;
  okx: string | null;
}

export interface UniverseSpelling {
  id: string;
  base: string;
  binance_perp: string;
  bybit_linear?: string;
  okx_swap?: string;
}

/** A base asset as Binance names it (`BTC`, `1000PEPE`): upper-case letters and digits only. */
const BASE = /^[A-Z0-9]{1,20}$/;

/** Venue symbols for one alert coin (`alert_symbols.symbol` / `.base`). Null: the base cannot name a USDT-linear contract. */
export function venueSymbols(symbol: string, base: string, universe: readonly UniverseSpelling[]): VenueSymbols | null {
  const known = universe.find((u) => u.id === symbol || u.binance_perp === symbol);
  if (known) return { binance: known.binance_perp, bybit: known.bybit_linear ?? null, okx: known.okx_swap ?? null };
  if (!BASE.test(base)) return null;
  return { binance: `${base}USDT`, bybit: `${base}USDT`, okx: `${base}-USDT-SWAP` };
}

/** The (venue, venue symbol) pairs to read for one coin, Binance first. */
export function venuePairs(v: VenueSymbols): Array<{ venue: LiqVenue; symbol: string }> {
  const out: Array<{ venue: LiqVenue; symbol: string }> = [{ venue: 'binance', symbol: v.binance }];
  if (v.bybit) out.push({ venue: 'bybit', symbol: v.bybit });
  if (v.okx) out.push({ venue: 'okx', symbol: v.okx });
  return out;
}

/**
 * The set a Bybit or OKX collector tracks: universe ∪ enabled alert coins, as that venue spells them.
 * Universe order first (the first Bybit symbol carries the liveness topic and must not move), then the
 * extra alert coins in symbol order; no duplicates.
 */
export function trackedSymbols(
  venue: 'bybit' | 'okx',
  universe: readonly UniverseSpelling[],
  alertCoins: ReadonlyArray<{ symbol: string; base: string }>,
): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => { if (s && !out.includes(s)) out.push(s); };
  for (const u of universe) add(venue === 'bybit' ? u.bybit_linear : u.okx_swap);
  for (const c of [...alertCoins].sort((a, b) => a.symbol.localeCompare(b.symbol))) add(venueSymbols(c.symbol, c.base, universe)?.[venue]);
  return out;
}
