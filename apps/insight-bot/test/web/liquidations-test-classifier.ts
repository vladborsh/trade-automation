import type { UniverseSymbol } from '../../src/config/universe.schema';
import { AssetClassifier } from '../../src/web/liquidations/asset-classes';

/**
 * IB-084 — a classifier for specs: the given universe, and an exchangeInfo answered from memory
 * (no network). `binance` maps extra Binance symbols to a raw exchangeInfo entry.
 */
export function stubClassifier(
  symbols: readonly UniverseSymbol[] = [],
  binance: Array<{ symbol: string; contractType?: string; underlyingType?: string; baseAsset?: string }> = [],
): AssetClassifier {
  return new AssetClassifier({
    symbols,
    futuresBaseUrl: 'http://exchange-info.invalid',
    fetchFn: (async () => new Response(JSON.stringify({ symbols: binance }), { status: 200 })) as unknown as typeof fetch,
  });
}
