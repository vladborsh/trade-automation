import { Logger } from '@nestjs/common';
import type { WebAssetClass } from '@trade-automation/contracts';
import type { UniverseSymbol } from '../../config/universe.schema';
import { aliasTable, baseTable, classTable } from '../../venues/binance/exchange-info';

/**
 * IB-084 (market-page design D6) — the asset class of a stored liquidation row, keyed by what the
 * row holds: `venue` + the venue's own symbol.
 *
 * 1. A universe symbol's class is its `asset_class` in universe.yaml — required, no default.
 * 2. Otherwise, on Binance, `exchangeInfo` (cached a day): `!forceOrder@arr` carries every USD-M
 *    symbol, most of them outside the universe.
 * 3. Otherwise `unknown` — counted in the block's `unknown` line, in no total. Bybit and OKX only
 *    ever write universe symbols (they subscribe/filter to it), so for them this is defensive.
 */
export type ClassKey = `${string}:${string}`;
export const classKey = (venue: string, symbol: string): ClassKey => `${venue}:${symbol}`;

/** venue:symbol → class for every universe spelling. Pure. */
export function universeClasses(symbols: readonly UniverseSymbol[]): Map<ClassKey, WebAssetClass> {
  const out = new Map<ClassKey, WebAssetClass>();
  for (const s of symbols) {
    out.set(classKey('binance', s.binance_perp), s.asset_class);
    if (s.bybit_linear) out.set(classKey('bybit', s.bybit_linear), s.asset_class);
    if (s.okx_swap) out.set(classKey('okx', s.okx_swap), s.asset_class);
  }
  return out;
}

/** The class of one row: universe first, then the Binance table, else unknown. Pure. */
export function classify(
  venue: string, symbol: string,
  universe: ReadonlyMap<ClassKey, WebAssetClass>,
  binance: ReadonlyMap<string, WebAssetClass> | null,
): WebAssetClass {
  const known = universe.get(classKey(venue, symbol));
  if (known) return known;
  if (venue === 'binance' && binance) return binance.get(symbol) ?? 'unknown';
  return 'unknown';
}

export const EXCHANGE_INFO_TTL_MS = 24 * 60 * 60 * 1000;
/** After a failed fetch, try again this soon rather than a day later. */
export const EXCHANGE_INFO_RETRY_MS = 5 * 60 * 1000;

export interface AssetClassifierOptions {
  symbols: readonly UniverseSymbol[];
  futuresBaseUrl: string;
  fetchFn?: typeof fetch;
  /** Weight 1 per call, recorded like every Binance read (`x-mbx-used-weight-1m` when sent). */
  onWeight?: (header: number | null) => void;
  now?: () => number;
}

/**
 * The cached classifier. A failed `exchangeInfo` leaves non-universe Binance symbols `unknown`
 * (counted, never crypto by default) and is retried in five minutes; the universe classes need no
 * network and always apply.
 */
export class AssetClassifier {
  private readonly logger = new Logger(AssetClassifier.name);
  private readonly universe: Map<ClassKey, WebAssetClass>;
  private binance: Map<string, WebAssetClass> | null = null;
  /** IB-BUG-025: Binance symbol → universe id for another quote/form of a universe coin; base assets. */
  private aliasMap = new Map<string, string>();
  private bases = new Map<string, string>();
  private nextRefreshAt = 0;
  private inFlight: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: AssetClassifierOptions) {
    this.universe = universeClasses(options.symbols);
    this.now = options.now ?? Date.now;
  }

  /** Refreshes the Binance table when stale; never throws. */
  async ready(): Promise<void> {
    if (this.now() < this.nextRefreshAt) return;
    this.inFlight ??= this.refresh().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  classify(venue: string, symbol: string): WebAssetClass {
    return classify(venue, symbol, this.universe, this.binance);
  }

  /**
   * IB-BUG-025: Binance contracts counted in a universe coin's row (`exchange-info.ts` `aliasTable`).
   * Empty until `exchangeInfo` has loaded — then those rows stay in `otherCoins`, never guessed.
   */
  aliases(): Array<{ symbol: string; id: string }> {
    return [...this.aliasMap].map(([symbol, id]) => ({ symbol, id }));
  }

  /** IB-BUG-025: which coin a row is, for counting distinct coins: the universe id, else Binance's base asset, else the venue symbol. */
  coinOf(venue: string, symbol: string): string {
    const column = venue === 'binance' ? 'binance_perp' : venue === 'bybit' ? 'bybit_linear' : venue === 'okx' ? 'okx_swap' : null;
    const u = column === null ? undefined : this.options.symbols.find((s) => s[column] === symbol);
    if (u) return u.id;
    return (venue === 'binance' ? this.bases.get(symbol) : undefined) ?? `${venue}:${symbol}`;
  }

  /** The class of a canonical universe id (`symbols.id`), or unknown for an id not in the file. */
  classOfId(id: string): WebAssetClass {
    return this.options.symbols.find((s) => s.id === id)?.asset_class ?? 'unknown';
  }

  private async refresh(): Promise<void> {
    const url = `${this.options.futuresBaseUrl.replace(/\/+$/, '')}/fapi/v1/exchangeInfo`;
    try {
      const response = await (this.options.fetchFn ?? fetch)(url);
      const header = response.headers.get('x-mbx-used-weight-1m');
      this.options.onWeight?.(header === null ? null : Number(header));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      this.binance = classTable(body);
      // the same body, no further call: aliases and base assets (IB-BUG-025)
      this.aliasMap = aliasTable(body, this.options.symbols);
      this.bases = baseTable(body);
      this.nextRefreshAt = this.now() + EXCHANGE_INFO_TTL_MS;
    } catch (error) {
      this.logger.warn(`exchangeInfo failed (${(error as Error).message}); non-universe Binance symbols count as unknown, retrying in 5 min`);
      this.nextRefreshAt = this.now() + EXCHANGE_INFO_RETRY_MS;
    }
  }
}
