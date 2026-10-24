import type { WebUniverseSummaryRow } from '@trade-automation/contracts';
import type { OiHistRow, PremiumIndexSummaryRow, Ticker24hRow } from './summary.payloads';

/** The part of a top-list row the summary needs: who the coin is and where it ranks. */
export interface SummarySymbol {
  id: string;
  base: string;
  volumeRank: number | null;
}

/** A venue string as a number, or null. `Number('')` is 0, which would be a lie here. */
export function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Open-interest change in percent between the oldest and newest hourly sample.
 *
 * Asked for with `limit=25`, so oldest-to-newest spans 24 hours. Fewer than two rows, or an
 * oldest sample of zero, gives null: a percent change from nothing is not a number anyone should
 * read. The rows are sorted here rather than trusted to arrive in order.
 */
export function oiChangePct(rows: readonly OiHistRow[]): number | null {
  const values = [...rows]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((r) => numberOrNull(r.sumOpenInterest))
    .filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

/**
 * One summary row per top-list symbol, in the top list's order.
 *
 * A symbol the venue did not report (delisted, spot-only, a failed OI call) keeps its row with
 * nulls in the missing fields: the dropdown still lists it, and the dashes say why it is thin.
 * `oiBySymbol` has no entry for a symbol whose OI call failed, which reads as null, the same as
 * an empty answer.
 */
export function assembleSummary(
  symbols: readonly SummarySymbol[],
  tickers: readonly Ticker24hRow[],
  premium: readonly PremiumIndexSummaryRow[],
  oiBySymbol: ReadonlyMap<string, readonly OiHistRow[]>,
): WebUniverseSummaryRow[] {
  const ticker = new Map(tickers.map((t) => [t.symbol, t]));
  const index = new Map(premium.map((p) => [p.symbol, p]));
  return symbols.map((s) => {
    const t = ticker.get(s.id);
    const p = index.get(s.id);
    const oi = oiBySymbol.get(s.id);
    return {
      id: s.id,
      base: s.base,
      volumeRank: s.volumeRank,
      lastPrice: numberOrNull(t?.lastPrice),
      changePct24h: numberOrNull(t?.priceChangePercent),
      fundingRate: numberOrNull(p?.lastFundingRate),
      nextFundingTimeMs: p && Number.isInteger(p.nextFundingTime) && p.nextFundingTime > 0 ? p.nextFundingTime : null,
      oiChangePct24h: oi ? oiChangePct(oi) : null,
    };
  });
}
