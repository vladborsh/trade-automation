import type { Db } from '../../../db/db.port';
import { trackedSymbols, type UniverseSpelling } from '../../../alerts/liquidations/venue-symbols';

/**
 * IB-122 (liq design L5, after OI design V3) — what the Bybit and OKX liquidation collectors track:
 * **universe ∪ the enabled `alert_symbols`**, as that venue spells them (one mapper, shared with the
 * alert loop), re-read every `TRACK_REFRESH_MS`. A coin added on the admin page joins the tape without
 * a deploy; a removed one stops (its rows stay).
 *
 * Each read also records the set in `liquidation_tracked` (venue, symbol, since), which the alert loop
 * reads to name a venue that has not yet collected a coin for 5 minutes. A coin already there keeps its
 * `since`; a coin no longer tracked loses its row.
 *
 * If `alert_symbols` cannot be read, the previous list stands: a database hiccup must not stop
 * collecting a listed coin. Without a database the universe alone is tracked.
 */
export const TRACK_REFRESH_MS = 5 * 60_000;

export class LiquidationTracking {
  private last = new Map<'bybit' | 'okx', string[]>();

  constructor(
    private readonly db: Db | null,
    private readonly universe: readonly UniverseSpelling[],
    private readonly logger: { warn(message: string): void },
  ) {}

  async symbols(venue: 'bybit' | 'okx', now = new Date()): Promise<string[]> {
    const fallback = this.last.get(venue) ?? trackedSymbols(venue, this.universe, []);
    if (!this.db) return fallback;
    let list: string[];
    try {
      const coins = await this.db.query<{ symbol: string; base: string }>('select symbol, base from alert_symbols where enabled order by symbol');
      list = trackedSymbols(venue, this.universe, coins);
    } catch (error) {
      this.logger.warn(`${venue} liquidations: alert_symbols unreadable, keeping the last list: ${(error as Error).message}`);
      return fallback;
    }
    this.last.set(venue, list);
    try {
      await this.db.query('delete from liquidation_tracked where venue = $1 and not (symbol = any($2::text[]))', [venue, list]);
      await this.db.query(
        'insert into liquidation_tracked (venue, symbol, since) select $1, s, $3 from unnest($2::text[]) as s on conflict do nothing',
        [venue, list, now],
      );
    } catch (error) {
      this.logger.warn(`${venue} liquidations: liquidation_tracked not written: ${(error as Error).message}`);
    }
    return list;
  }
}
