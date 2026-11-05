import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DB, type Db } from '../../../db/db.port';
import { MarketCardsService } from '../market-cards.service';
import type { GlobalPayload } from '../market-cards.payloads';
import { recordMarketCap, type MarketCapRow } from '../pg/market-cap.repo';

/** IB-118: one poll every 10 min — CoinGecko refreshes `/global` every few minutes, the line needs no more. */
export const MARKET_CAP_RECORD_MS = 10 * 60_000;

/**
 * IB-118 (market round 2 §2, owner ruling 2026-11-05 «записываем сами») — writes the total market cap
 * into `market_cap_total` every 10 min, **whether or not anyone is viewing**, so the cap tile has a
 * 7-day line that keyless CoinGecko cannot give back.
 *
 * Reads `MarketCardsService.global()`, the 120 s slot the cards and the caps block already share, so
 * this adds **≤ 0.1 CoinGecko call/min** (none at all while a page keeps the slot warm).
 *
 * Keyed on CoinGecko's own `updated_at`: a poll that gets the same refresh again (the slot's cached value,
 * or the last good value it returns while CoinGecko fails) writes nothing new. A failed read — nothing
 * ever read, a payload without `updated_at` or a positive `total_market_cap.usd`, a database error —
 * writes nothing; it is logged at warn once per run of failures, and the next tick retries.
 *
 * The app's periodic-job shape (SessionSweeperService): once at boot, then on an unref'd interval
 * cleared on destroy; ticks never overlap; a tick never rejects.
 */
@Injectable()
export class MarketCapRecorderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketCapRecorderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private failing = false;

  constructor(@Inject(DB) private readonly db: Db | null, private readonly cards: MarketCardsService) {}

  onApplicationBootstrap(): void {
    if (!this.db) {
      this.logger.log('no database — market cap recording off');
      return;
    }
    void this.recordOnce();
    this.timer = setInterval(() => void this.recordOnce(), MARKET_CAP_RECORD_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One tick. Public so a spec can drive it; resolves whatever happens, never rejects. */
  async recordOnce(now = Date.now()): Promise<'recorded' | 'same' | 'failed' | null> {
    if (!this.db || this.running) return null;
    this.running = true;
    try {
      const row = marketCapObservation(await this.cards.global());
      if (row === null) return this.failed('CoinGecko /global gave no total_market_cap.usd with an updated_at');
      const added = await recordMarketCap(this.db, row, new Date(now));
      this.failing = false;
      return added ? 'recorded' : 'same';
    } catch (error) {
      return this.failed((error as Error).message);
    } finally {
      this.running = false;
    }
  }

  private failed(reason: string): 'failed' {
    if (!this.failing) this.logger.warn(`market cap not recorded, next try in ${MARKET_CAP_RECORD_MS / 60_000} min — ${reason}`);
    this.failing = true;
    return 'failed';
  }
}

/** The row a `/global` payload gives, or null when it lacks the time or a positive, finite total. */
export function marketCapObservation(payload: GlobalPayload | null): MarketCapRow | null {
  const usd = payload?.data.total_market_cap['usd'];
  const updatedAt = payload?.data.updated_at;
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return { tsMs: Math.round(updatedAt * 1000), totalUsd: usd };
}
