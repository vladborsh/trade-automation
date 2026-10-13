import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { DB, type Db } from '../db/db.port';
import {
  noteToken, tokensDueSecurity, writePairSnapshots, writePools, writeSecurityFailure, writeTokenSecurity,
} from '../db/pg/dex-store';
import { DexClient } from './dex.client';
import { mapPairs } from './dexscreener';
import { FIELDS, mapTokenSecurity, unexpectedAbsences, type ChainFamily } from './goplus';
import { mapPools, type Network } from './mappers';
import {
  afterAttempt, keyOf, nextDue, SECURITY_STAGES, type Call, type CallState, type SecurityStage,
} from './schedule';

/**
 * IB-028 — the DEX snapshot collector (§10, §13 p.4).
 *
 * **The tick is the rate limiter.** One GeckoTerminal call per tick at most, and `nextDue` refuses
 * to return anything within `CALL_SPACING_MS` of the last one, so the 75-second spacing is a
 * property of the loop rather than a comment asking the caller to be careful. GeckoTerminal is the
 * binding constraint at a measured ~5 req/min (see `README.md`); everything here is sized from it.
 *
 * Request rate, stated as AGENTS.md requires:
 *
 * ```
 * GeckoTerminal  8 calls / 10 min cycle                  = 0.8/min   (16 % of ~5/min measured)
 * DexScreener    1 batched call per GeckoTerminal page    = 0.8/min   (< 1 % of >= 107/min)
 * GoPlus         <= 1 call per tick, capped per cycle     = <= 4/min  (<= 9 % of >= 46/min)
 * ```
 *
 * GoPlus is the only one whose worst case is driven by data rather than by the schedule — a cycle
 * can discover up to 80 new tokens — so it is capped at `SECURITY_CALLS_PER_TICK` per tick instead
 * of being allowed to drain the queue. A backlog is visible and harmless; a burst is a 429 and a
 * gap in the history.
 *
 * **Collection only.** Nothing here filters, scores or alerts. Every pool seen is written,
 * including the ones a later rule would discard, because the discarded ones are what makes that
 * rule judgeable (see the migration's header).
 */

/** The loop wakes often and does at most one venue call; the spacing does the limiting. */
export const TICK_MS = 15_000;

/**
 * GoPlus calls per tick. One, deliberately.
 *
 * At a 15-second tick that is 4/min — under a tenth of the measured ≥ 46/min — and it means a
 * cycle that discovers 80 new tokens works through them over the following ten minutes rather
 * than in one burst. The backlog is bounded by the schedule, not by the queue.
 */
export const SECURITY_CALLS_PER_TICK = 1;

const CHAIN_FAMILY: Record<Network, ChainFamily> = {
  solana: 'solana',
  base: 'evm',
  bsc: 'evm',
  eth: 'evm',
};

@Injectable()
export class DexService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('DexSnapshots');
  private readonly client: DexClient;
  private readonly state = new Map<string, CallState>();
  private lastCallAt = 0;
  /** Round-robin cursor over the three stages, so one stage's backlog cannot starve the others. */
  private stageCursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(@Inject(DB) private readonly db: Db | null, @Optional() client?: DexClient) {
    this.client = client ?? new DexClient();
  }

  onApplicationBootstrap(): void {
    if (!this.db) {
      this.logger.warn('no database — DEX snapshots disabled');
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log('DEX snapshots started (GeckoTerminal 0.8/min, DexScreener 0.8/min, GoPlus <= 4/min)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One tick: at most one listing page, plus at most one security check. Public so specs can drive it. */
  async tick(now = Date.now()): Promise<void> {
    // A slow tick must not overlap the next: two in flight would issue two GeckoTerminal calls
    // inside the spacing and take the burst 429 this schedule exists to avoid.
    if (this.running) return;
    this.running = true;
    try {
      const call = nextDue(now, this.state, this.lastCallAt);
      if (call !== null) await this.pollListing(call, now);
      await this.checkSecurity(now);
    } finally {
      this.running = false;
    }
  }

  private async pollListing(call: Call, now: number): Promise<void> {
    const db = this.db;
    if (!db) return;

    // the attempt is recorded BEFORE the result is known: a call that throws must still consume
    // its slot, or a failing network would be retried every tick and take the whole budget
    this.lastCallAt = now;
    const outcome = await this.client.geckoTerminal(call.network, call.listing);
    if (!outcome.ok) {
      this.state.set(keyOf(call), afterAttempt(this.state.get(keyOf(call)), now, false));
      this.logger.warn(`${keyOf(call)}: ${outcome.reason}`);
      return;
    }

    const observedAt = new Date(now);
    try {
      const { rows, skipped } = mapPools(outcome.body, call.network, call.listing, observedAt);
      if (skipped.length > 0) {
        const reasons = [...new Set(skipped.map((s) => s.reason))].join(', ');
        this.logger.warn(`${keyOf(call)}: ${skipped.length} pools skipped (${reasons})`);
      }
      const written = await writePools(db, rows);
      await this.noteTokens(rows, observedAt);
      this.state.set(keyOf(call), afterAttempt(this.state.get(keyOf(call)), now, true));
      this.logger.log(`${keyOf(call)}: ${rows.length} pools, ${written} new observations`);

      // DexScreener is batched and costs ONE request for the whole page, so it rides along with
      // the page rather than having a schedule of its own. Its failure is contained: the
      // GeckoTerminal snapshot is already written and is worth keeping without it.
      await this.pollPairs(call.network, rows.map((r) => r.address), observedAt);
    } catch (error) {
      this.state.set(keyOf(call), afterAttempt(this.state.get(keyOf(call)), now, false));
      this.logger.error(`${keyOf(call)}: unmappable — ${(error as Error).message}`);
    }
  }

  private async pollPairs(network: Network, addresses: readonly string[], observedAt: Date): Promise<void> {
    const db = this.db;
    if (!db || addresses.length === 0) return;
    const outcome = await this.client.dexScreener(network, addresses);
    if (!outcome.ok) {
      this.logger.warn(`dexscreener ${network}: ${outcome.reason}`);
      return;
    }
    try {
      const { rows, missing, skipped } = mapPairs(outcome.body, network, addresses, observedAt);
      const written = await writePairSnapshots(db, rows);
      if (skipped.length > 0) this.logger.warn(`dexscreener ${network}: ${skipped.length} pairs skipped`);
      // A pool DexScreener does not know is reported, not written as zeros, and not silent: the
      // count is the only way to tell "thin coverage" from "our join is broken".
      this.logger.log(
        `dexscreener ${network}: ${written} pairs stored, ${missing.length}/${addresses.length} not known to the venue`,
      );
    } catch (error) {
      this.logger.error(`dexscreener ${network}: unmappable — ${(error as Error).message}`);
    }
  }

  /** Every base token of the page, so the security schedule has something to work from. */
  private async noteTokens(rows: readonly { baseTokenId: string | null; network: Network }[], at: Date): Promise<void> {
    const db = this.db;
    if (!db) return;
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.baseTokenId === null || seen.has(row.baseTokenId)) continue;
      seen.add(row.baseTokenId);
      // GeckoTerminal's token id is '<network>_<address>'; the address is what GoPlus needs
      const address = row.baseTokenId.slice(`${row.network}_`.length);
      if (address.length === 0) continue;
      await noteToken(db, {
        tokenId: row.baseTokenId, network: row.network, address, symbol: null, name: null,
      }, at);
    }
  }

  /**
   * At most one GoPlus call, for one token, at one stage.
   *
   * The stage is round-robined rather than always starting at `first_seen`, because first sight is
   * the stage with the largest and most renewable backlog: a fixed order would mean a busy day on
   * Solana permanently starves the +6 h and +24 h re-checks, and the re-check is the only reason
   * the schedule has three looks.
   */
  private async checkSecurity(now: number): Promise<void> {
    const db = this.db;
    if (!db) return;
    for (let attempt = 0; attempt < SECURITY_STAGES.length; attempt += 1) {
      const stage = SECURITY_STAGES[(this.stageCursor + attempt) % SECURITY_STAGES.length];
      const due = await tokensDueSecurity(db, stage, new Date(now), SECURITY_CALLS_PER_TICK);
      if (due.length === 0) continue;
      this.stageCursor = (this.stageCursor + attempt + 1) % SECURITY_STAGES.length;
      for (const token of due.slice(0, SECURITY_CALLS_PER_TICK)) {
        await this.askGoPlus(token, stage, now);
      }
      return;
    }
  }

  private async askGoPlus(
    token: { tokenId: string; network: string; address: string },
    stage: SecurityStage,
    now: number,
  ): Promise<void> {
    const db = this.db;
    if (!db) return;
    const network = token.network as Network;
    const family = CHAIN_FAMILY[network];
    if (family === undefined) {
      // an unknown network cannot be asked about, and recording it as a failure is honest: the
      // alternative is a token that is due for ever and is tried every tick
      await writeSecurityFailure(db, token.tokenId, stage, new Date(now), 'evm', `unknown network ${token.network}`);
      return;
    }

    const outcome = await this.client.goPlus(network, token.address);
    if (!outcome.ok) {
      // THE fourth state: an attempt, not an answer. The token stays due (bounded by `attempts`)
      // rather than being recorded as "asked and told nothing", which would make us permanently
      // and silently ignorant about this token.
      await writeSecurityFailure(db, token.tokenId, stage, new Date(now), family, outcome.reason);
      this.logger.warn(`goplus ${token.tokenId} @ ${stage}: ${outcome.reason}`);
      return;
    }

    try {
      const mapped = mapTokenSecurity(outcome.body, family);
      if (mapped === null) {
        // a 200 whose payload holds no token for the address we asked about. The venue answered,
        // so this is state 3 — asked, told nothing — written with the flags left null.
        await writeTokenSecurity(db, token.tokenId, stage, new Date(now), {
          chainFamily: family, mintable: null, freezable: null, closable: null, metadataMutable: null,
          balanceMutableAuthority: null, isOpenSource: null, cannotBuy: null, buyTax: null,
          sellTax: null, holderCount: null, totalSupply: null,
          // nothing was said about ANY field, because there was no token object to read
          absentFields: [...FIELDS[family]], raw: JSON.parse(outcome.body),
        });
        this.logger.log(`goplus ${token.tokenId} @ ${stage}: answered with no data for this token`);
        return;
      }
      // A field measured as ALWAYS present going missing is either a shape change or a
      // classification of mine that was too strong. Both need a human; neither is worth throwing
      // the row away, which is what the first version did — so this is loud and the row is kept.
      const surprising = unexpectedAbsences(mapped.row);
      if (surprising.length > 0) {
        this.logger.error(
          `goplus ${token.tokenId}: field(s) measured as ALWAYS present are missing: ` +
          `${surprising.map((c) => `${c.field} (${c.evidence})`).join('; ')} — the API changed shape, ` +
          'or that classification needs re-measuring. The row IS stored, with the names in absent_fields.',
        );
      }
      await writeTokenSecurity(db, token.tokenId, stage, new Date(now), mapped.row);
    } catch (error) {
      // an unparseable or shape-changed answer is a FAILED ask, not an answer with nothing in it
      await writeSecurityFailure(db, token.tokenId, stage, new Date(now), family, (error as Error).message);
      this.logger.warn(`goplus ${token.tokenId} @ ${stage}: unmappable — ${(error as Error).message}`);
    }
  }
}
