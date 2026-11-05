import { LIQ_COVERAGE_WARMUP_SEC, LIQ_VENUES, type LiqSilentVenue, type LiqVenue } from '@trade-automation/contracts';
import { STALE_AFTER_MS } from '../../collectors/uptime/uptime.recorder';
import type { VenueSymbols } from './venue-symbols';

/**
 * IB-122 (design L3, L5) — which venues could NOT have reported this coin in the window (t − 5 min, t].
 * Such a venue is named in the message («нет данных с OKX»), never shown as $0: an undercount must not
 * look like a quiet venue (IB-BUG-011). Pure.
 *
 * - `not_listed`: the mapper has no contract for the coin on that venue;
 * - `not_collected`: Bybit/OKX had not tracked the coin since before the window (L5's 5 minutes);
 * - `stream_silent`: the venue's collector heartbeat (IB-BUG-010) was not alive across the window — first
 *   seen after its start, or last seen more than `STALE_AFTER_MS` before its end — or a collector gap row
 *   overlaps it.
 */
export interface VenueStatus {
  /** Per venue's liquidation stream: first and last heartbeat, epoch ms; absent = never seen. */
  heartbeats: ReadonlyMap<LiqVenue, { firstSeen: number; lastSeen: number }>;
  /** Collector gaps of the liquidation streams, epoch ms. */
  gaps: ReadonlyArray<{ venue: LiqVenue; from: number; to: number }>;
  /** `liquidation_tracked`: venue → venue symbol → since (epoch ms). Binance has none: it carries every symbol. */
  tracked: ReadonlyMap<'bybit' | 'okx', ReadonlyMap<string, number>>;
}

export function silentVenues(symbols: VenueSymbols, windowStartMs: number, atMs: number, status: VenueStatus): LiqSilentVenue[] {
  const out: LiqSilentVenue[] = [];
  for (const venue of LIQ_VENUES) {
    const symbol = symbols[venue];
    if (symbol === null) { out.push({ venue, reason: 'not_listed' }); continue; }
    if (venue !== 'binance') {
      const since = status.tracked.get(venue)?.get(symbol);
      if (since === undefined || since > atMs - LIQ_COVERAGE_WARMUP_SEC * 1_000) { out.push({ venue, reason: 'not_collected' }); continue; }
    }
    const beat = status.heartbeats.get(venue);
    const gap = status.gaps.some((g) => g.venue === venue && g.from < atMs && g.to > windowStartMs);
    if (!beat || beat.firstSeen > windowStartMs || beat.lastSeen < atMs - STALE_AFTER_MS || gap) out.push({ venue, reason: 'stream_silent' });
  }
  return out;
}
