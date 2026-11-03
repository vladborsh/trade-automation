import {
  WEB_CAPS_TOP_N, type WebCapsCoin, type WebCapsDominance, type WebCapsResponse, type WebCapsUnavailable,
  type WebMarketPeriod,
} from '@trade-automation/contracts';
import type { CapsMarketRow, GlobalPayload, StablecoinRow } from './market-cards.payloads';

/**
 * IB-087 (market-page design D11) — the caps block from three CoinGecko reads, as a pure function.
 *
 * **Period.** CoinGecko's `/coins/markets` serves the price change for 1h, 24h and 7d (requested
 * with `price_change_percentage=1h,24h,7d`). It has no 4h figure, and we store no prices (D7), so
 * 4h is refused explicitly (`period_not_served`) — never approximated from 1h or 24h.
 *
 * **Dominance bar.** BTC and ETH are CoinGecko's own `/global` percentages. The stablecoin share is
 * ours: Σ cap of every coin in CoinGecko's `stablecoins` category ÷ `/global`'s total. Caps of
 * stablecoins inside the top-250 call are live; the few outside it come from the once-a-day
 * category call (pegged coins, so a day-old cap moves the share by hundredths of a point —
 * measured 2026-11-03: 36 of the category's coins were in the top 250, holding 98.5 % of its cap).
 * `restPct` is the remainder, so the four sum to 100 by construction.
 *
 * **Invariants checked at runtime, refusing instead of drawing a wrong bar:**
 * - `/global`'s percentages are PERCENT (BTC between 1 and 100), not fractions — a unit change at
 *   the source would otherwise draw BTC at 0.5 %;
 * - the remainder is not negative (`sources_disagree`).
 */

export const CAPS_SOURCE = { name: 'CoinGecko', url: 'https://www.coingecko.com' } as const;

export interface CapsInput {
  period: WebMarketPeriod;
  /** `/coins/markets` top by cap; null when that read failed. */
  top: readonly CapsMarketRow[] | null;
  /** The stablecoin category (ids + caps); null when that read failed. */
  stablecoins: readonly StablecoinRow[] | null;
  /** `/global`; null when that read failed. */
  global: GlobalPayload | null;
  nowMs: number;
}

const CHANGE_FIELD: Record<WebMarketPeriod, keyof CapsMarketRow | null> = {
  '1h': 'price_change_percentage_1h_in_currency',
  '4h': null,
  '24h': 'price_change_percentage_24h_in_currency',
  '7d': 'price_change_percentage_7d_in_currency',
};

export function assembleCaps(input: CapsInput): WebCapsResponse {
  const field = CHANGE_FIELD[input.period];
  const stableIds = new Set((input.stablecoins ?? []).map((s) => s.id));

  const coins: WebCapsCoin[] = (input.top ?? [])
    .filter((r): r is CapsMarketRow & { market_cap: number } => typeof r.market_cap === 'number' && r.market_cap > 0)
    .sort((a, b) => b.market_cap - a.market_cap)
    .slice(0, WEB_CAPS_TOP_N)
    .map((r) => ({
      id: r.id,
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      capUsd: r.market_cap,
      priceUsd: r.current_price,
      changePct: field === null ? null : finiteOrNull(r[field]),
      stable: stableIds.has(r.id),
    }));

  const { dominance, reason } = dominanceOf(input);
  return {
    period: input.period,
    coins,
    coinsUnavailable: coins.length === 0 ? 'source_unavailable' : null,
    changeUnavailable: field === null ? 'period_not_served' : null,
    dominance,
    dominanceUnavailable: reason,
    source: { ...CAPS_SOURCE },
    generatedAt: new Date(input.nowMs).toISOString(),
  };
}

function dominanceOf(input: CapsInput): { dominance: WebCapsDominance | null; reason: WebCapsUnavailable | null } {
  if (!input.global || !input.top || !input.stablecoins) return { dominance: null, reason: 'source_unavailable' };
  const g = input.global.data;
  const totalCapUsd = g.total_market_cap.usd;
  const btcPct = g.market_cap_percentage.btc;
  const ethPct = g.market_cap_percentage.eth;
  if (!(totalCapUsd > 0) || typeof btcPct !== 'number' || typeof ethPct !== 'number') {
    return { dominance: null, reason: 'source_unavailable' };
  }
  // PERCENT, not a fraction: BTC has never been under 1 % of the market.
  if (!(btcPct > 1 && btcPct < 100) || !(ethPct >= 0 && ethPct < 100)) return { dominance: null, reason: 'sources_disagree' };

  const liveCap = new Map(input.top.map((r) => [r.id, r.market_cap]));
  let stablesCapUsd = 0;
  let stablesCounted = 0;
  for (const s of input.stablecoins) {
    const cap = liveCap.has(s.id) ? liveCap.get(s.id) : s.market_cap;
    if (typeof cap === 'number' && cap > 0) {
      stablesCapUsd += cap;
      stablesCounted += 1;
    }
  }
  const stablesPct = (stablesCapUsd / totalCapUsd) * 100;
  const restPct = 100 - btcPct - ethPct - stablesPct;
  if (restPct < 0) return { dominance: null, reason: 'sources_disagree' };

  return {
    dominance: {
      btcPct, ethPct, stablesPct, restPct, totalCapUsd,
      totalCapChangePct24h: finiteOrNull(g.market_cap_change_percentage_24h_usd),
      stablesCounted,
      asOf: new Date((g.updated_at ?? input.nowMs / 1000) * 1000).toISOString(),
    },
    reason: null,
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
