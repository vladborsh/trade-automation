import type { WebDominanceCard, WebFearGreedPoint, WebMarketCardsResponse } from '@trade-automation/contracts';
import { utcDay } from './context-mappers';
import { btcVsTopCard, capsCard, fearGreedCard } from '../context/market-cards';
import { marketCapCurrent, marketCapDays, type CoinCapRow } from '../context/market-shares';
import type { CoinMarketRow, GlobalPayload } from './market-cards.payloads';

export interface LiveCardsInput {
  /** alternative.me rows, newest first as the venue sends them; already parsed. */
  fearGreed: readonly WebFearGreedPoint[] | null;
  global: GlobalPayload | null;
  markets: readonly CoinMarketRow[] | null;
  /** The top-20 CoinGecko ids, in the order the stored path uses. */
  coins: readonly string[];
  nowMs: number;
}

/**
 * The market cards from live venue reads (2026-10-24: the page showed only «пока не собран»,
 * because nothing has collected since the collectors stopped on 2026-10-21).
 *
 * The stored path's card builders are reused wherever the live data has the same meaning, so the
 * two cannot disagree about a figure: Fear & Greed is the same card from the venue's own last eight
 * days; BTC-vs-top-20 is the same share from today's caps. What the venue does not give free is
 * left null and the page leaves it out (`live: true`): dominance moves and cap moves over 7 or 30
 * days need CoinGecko's paid history. The 24 h cap change is the venue's own figure.
 *
 * A source that failed is a null card, not a failed page: the three are independent.
 */
export function liveMarketCards(input: LiveCardsInput): WebMarketCardsResponse {
  const today = utcDay(input.nowMs);
  const rows: CoinCapRow[] = (input.markets ?? [])
    .filter((m) => input.coins.includes(m.id))
    .map((m) => ({ day: today, coin: m.id, capUsd: m.market_cap, priceUsd: m.current_price }));
  const days = marketCapDays(rows, input.coins);
  const change24h = new Map((input.markets ?? []).map((m) => [m.id, m.market_cap_change_percentage_24h]));
  const caps = marketCapCurrent(days, rows).map((c) => {
    const pct = change24h.get(c.coin);
    return { ...c, change24h: pct === null || pct === undefined ? null : pct / 100 };
  });

  return {
    fearGreed: input.fearGreed ? fearGreedCard(input.fearGreed) : null,
    dominance: input.global ? liveDominance(input.global, input.nowMs) : null,
    btcVsTop: rows.length > 0 ? btcVsTopCard(days, input.coins.length) : null,
    caps: capsCard(caps),
    capsDay: rows.length > 0 ? today : null,
    capsSource: 'coingecko',
    live: true,
  };
}

/** `/global` as the dominance card. Null when the venue omitted BTC's share: 0 % would be a lie. */
export function liveDominance(payload: GlobalPayload, nowMs: number): WebDominanceCard | null {
  const pct = payload.data.market_cap_percentage;
  if (typeof pct.btc !== 'number') return null;
  return {
    btcPct: pct.btc,
    ethPct: typeof pct.eth === 'number' ? pct.eth : null,
    totalUsd: typeof payload.data.total_market_cap.usd === 'number' ? payload.data.total_market_cap.usd : null,
    atMs: payload.data.updated_at !== undefined ? payload.data.updated_at * 1000 : nowMs,
    changePct24h: null,
    changePct7d: null,
    totalChangePct24h: payload.data.market_cap_change_percentage_24h_usd ?? null,
    coverageDays: 0,
    source: 'coingecko',
  };
}
