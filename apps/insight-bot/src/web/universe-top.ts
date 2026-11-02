import type { WebUniverseTopResponse } from '@trade-automation/contracts';
import type { UniverseSymbol } from '../config/universe.schema';

/**
 * WD-009 — the picker's list straight from `config/universe.yaml`, not from the `symbols` table
 * (which is only ever a copy of that file, synced at boot). Same order the sync stored: the
 * file's stated `volume_rank`, else its position (the file is ordered by 30-day quote volume), ties
 * by id. Pure, so the order is pinned by a spec rather than by a SQL `order by`.
 */
export function universeTop(
  symbols: readonly UniverseSymbol[],
  signalSet: readonly string[],
  n: number,
): WebUniverseTopResponse['symbols'] {
  const inSet = new Set(signalSet);
  return symbols
    .map((s, index) => ({ s, rank: s.volume_rank ?? index + 1 }))
    .sort((a, b) => a.rank - b.rank || a.s.id.localeCompare(b.s.id))
    .slice(0, n)
    .map(({ s, rank }) => ({
      id: s.id, base: s.base, quote: s.quote, volumeRank: rank, inSignalSet: inSet.has(s.id),
      venues: {
        binancePerp: Boolean(s.binance_perp), binanceSpot: Boolean(s.binance_spot),
        bybitLinear: Boolean(s.bybit_linear), okxSwap: Boolean(s.okx_swap),
      },
    }));
}
