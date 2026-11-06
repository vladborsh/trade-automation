import {
  FUNDING_HISTORY_REFRESH_SEC, FUNDING_LATE_SEC, FUNDING_SIDES, FUNDING_SIDE_DIRECTION, type FundingEnterDetails, type FundingFlipDetails,
  type FundingNearMissDetails, type FundingParams, type FundingSide, type MarketAlertSource, mutedDedupeKey,
} from '@trade-automation/contracts';
import { fundingEnter, fundingFlip } from '../../delivery/templates/funding-alerts.texts';
import type { Texts } from '../../delivery/templates/texts';
import { FUNDING_FLOOR_PER_8H, POSITIONING_BASELINE_DAYS } from '../../insights/thresholds';
import { liqPathT0 } from '../liquidations/controls';
import { randomSlotAt } from './controls';
import { fundingCheck, type FundingCheck } from './funding-check';
import { fundingStep, type FundingSideState } from './funding-state';
import { stateKey, type FundingAlertStore, type FundingSettings, type NewFundingAlert } from './pg/funding-alerts.repo';

/**
 * IB-124 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §3, F1–F8) — the funding alert loop, as plain
 * logic over ports. The Nest service in delivery/ only schedules it every 5 min.
 *
 * Per listed coin (`alert_symbols`, enabled) and check:
 * 1. F1: its predicted rate (`premiumIndex?symbol=`, weight 1). Its 30-day settled history (`fundingRate`, weight 1)
 *    is re-read when the copy held is older than an hour; it is never stored (S1).
 * 2. F7: a rate older than 15 min gives no signal and does not move the state.
 * 3. F2/F3: `fundingCheck`, IB-135's judgement as R5 makes it, with the coin's floor (default `FUNDING_FLOOR_PER_8H`).
 * 4. F4/F5: `fundingStep` per side, from the state row (F6). An `enter` or a `flip` is journalled in the SAME
 *    transaction as the state that produced it (once-keys `funding:{symbol}:{side}:{episode start}` and
 *    `funding-flip:{symbol}:{side}:{episode start}`).
 * 5. Sent only while the type's switch is on (default OFF), to users with `funding_alerts`, in their language. A
 *    funding row is never `late`: a stale check is dropped before it can produce one (F7).
 * 5a. IB-151 (owner ruling 2026-11-06 B): a coin switched off (`perCoin[symbol].enabled = false`) is checked, its
 *    state kept and its rows journalled as for any coin, with `mutedBy: 'coin'` and a once-key of their own
 *    (`mutedDedupeKey`); they are never sent. Its two calls a check (weight 1 each, every 5 min) cost 0.4 weight a
 *    minute per switched-off coin, plus its hourly history read.
 * 6. F8: the first near-miss of a coin, side and UTC day while that side is normal; 2 hash-picked random checks a
 *    coin and day. Price paths for alerts and controls, direction-free (see `insertPaths`): the crowded side is the
 *    row's `direction`.
 *
 * Memory: per coin, the settled history (≤ 720 points for a 1 h coin, 90 for an 8 h one); the state is re-read each tick.
 */
export interface FundingVenuePort {
  /** `premiumIndex?symbol=`: the predicted rate (fraction), the venue's timestamp and the next settlement, epoch ms. */
  premiumIndex(symbol: string): Promise<{ rate: number; timeMs: number; nextFundingTimeMs: number }>;
  /** `fundingRate` over (fromMs, toMs], oldest first; `time` unix seconds. */
  settled(symbol: string, fromMs: number, toMs: number): Promise<Array<{ time: number; rate: number }>>;
}

export interface FundingAlertLoopPorts {
  store: FundingAlertStore;
  venue: FundingVenuePort;
  /** Delivered or not; never throws (TelegramSender.sendTo). */
  send(chatId: number, text: string): Promise<boolean>;
  webBaseUrl: string;
  build: string;
  source: MarketAlertSource;
  log?: { warn(message: string): void; log?(message: string): void };
}

export interface FundingTickReport {
  atMs: number;
  coins: number;
  /** Venue calls this tick (each weight 1). */
  calls: number;
  stale: number;
  /** Coins with too few settlements to judge. */
  insufficient: number;
  enters: number;
  flips: number;
  /** IB-151: enters and flips journalled muted by the coin's switch (never sent). */
  muted: number;
  sent: number;
  controls: number;
  /** Coins whose check failed (venue or DB); the others went on. */
  failed: string[];
}

const HISTORY_MS = POSITIONING_BASELINE_DAYS * 86_400_000;
const REFRESH_MS = FUNDING_HISTORY_REFRESH_SEC * 1_000;
const LATE_MS = FUNDING_LATE_SEC * 1_000;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `on`: the coin's own switch; off only mutes (IB-151). */
interface Coin { symbol: string; base: string; floorPer8h: number; on: boolean }

export class FundingAlertLoop {
  private running = false;
  private readonly history = new Map<string, { fetchedAt: number; points: Array<{ time: number; rate: number }> }>();

  constructor(private readonly ports: FundingAlertLoopPorts) {}

  /** One check of every enabled coin. Null when the previous tick is still running. */
  async tick(nowMs: number): Promise<FundingTickReport | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const report: FundingTickReport = { atMs: nowMs, coins: 0, calls: 0, stale: 0, insufficient: 0, enters: 0, flips: 0, muted: 0, sent: 0, controls: 0, failed: [] };
      const { store, source } = this.ports;
      const settings = await store.settings();
      const coins = coinsOf(await store.listedCoins(), settings.params);
      report.coins = coins.length;
      const states = await store.states(source);
      for (const coin of coins) {
        try {
          await this.checkCoin(coin, settings, states, nowMs, report);
        } catch (error) {
          report.failed.push(coin.symbol);
          this.ports.log?.warn(`funding alerts ${coin.symbol}: ${(error as Error).message}`);
        }
      }
      this.pruneHistory(coins);
      return report;
    } finally {
      this.running = false;
    }
  }

  private async checkCoin(coin: Coin, settings: FundingSettings, states: Map<string, FundingSideState>, nowMs: number, report: FundingTickReport): Promise<void> {
    const settled = await this.settledOf(coin.symbol, nowMs, report);
    const pi = await this.ports.venue.premiumIndex(coin.symbol);
    report.calls++;
    if (nowMs - pi.timeMs > LATE_MS) {
      report.stale++;
      return;
    }
    const check = fundingCheck({ rate: pi.rate, rateTimeMs: pi.timeMs, nextFundingTimeMs: pi.nextFundingTimeMs, settled, floorPer8h: coin.floorPer8h });
    if (check === null) {
      report.insufficient++;
      return;
    }

    const next: Array<{ side: FundingSide; state: FundingSideState }> = [];
    const alerts: NewFundingAlert[] = [];
    for (const side of FUNDING_SIDES) {
      const step = fundingStep(states.get(stateKey(coin.symbol, side)) ?? null, side, nowMs, check.extreme === side, check.facts.ratePer8h, settings.params);
      next.push({ side, state: step.state });
      if (step.event?.kind === 'enter') {
        const details: FundingEnterDetails = { ...check.facts, side, episodeStartMs: step.event.episodeStartMs };
        alerts.push({ event: 'enter', symbol: coin.symbol, direction: FUNDING_SIDE_DIRECTION[side], atMs: step.event.episodeStartMs, details, dedupeKey: `funding:${coin.symbol}:${side}:${step.event.episodeStartMs}` });
      } else if (step.event?.kind === 'flip') {
        const e = step.event;
        const details: FundingFlipDetails = { ...check.facts, side, episodeStartMs: e.episodeStartMs, episodeEndMs: e.episodeEndMs, episodeHours: e.episodeHours, flipSinceMs: e.flipSinceMs };
        // the new crowded side is the opposite of the episode's
        alerts.push({ event: 'flip', symbol: coin.symbol, direction: FUNDING_SIDE_DIRECTION[side === 'high' ? 'low' : 'high'], atMs: e.flipSinceMs, details, dedupeKey: `funding-flip:${coin.symbol}:${side}:${e.episodeStartMs}` });
      }
    }
    const { store, source, build } = this.ports;
    if (!coin.on) for (const [i, a] of alerts.entries()) alerts[i] = { ...a, mutedBy: 'coin', dedupeKey: mutedDedupeKey(a.dedupeKey) };
    const ids = await store.commit({ source, build, params: settings.params, confirmedAtMs: nowMs, symbol: coin.symbol, states: next, alerts });

    for (const [i, a] of alerts.entries()) {
      const id = ids[i];
      if (id === null || id === undefined) continue;
      if (a.event === 'enter') report.enters++;
      else report.flips++;
      if (a.mutedBy) report.muted++;
      await store.insertPaths({ marketAlertId: id }, coin.symbol, liqPathT0(a.atMs));
      if (source === 'live' && settings.enabled && !a.mutedBy) {
        const t = { base: coin.base, symbol: coin.symbol };
        const texts = a.event === 'enter'
          ? fundingEnter(t, a.details as FundingEnterDetails, this.ports.webBaseUrl)
          : fundingFlip(t, a.details as FundingFlipDetails, this.ports.webBaseUrl);
        report.sent += await this.deliver(id, texts, nowMs);
      }
    }
    await this.controls(coin, check, next, settings.params, nowMs, report);
  }

  /** F1: the copy held, re-read when older than an hour. A failed refresh keeps a copy still under two hours old. */
  private async settledOf(symbol: string, nowMs: number, report: FundingTickReport): Promise<Array<{ time: number; rate: number }>> {
    const held = this.history.get(symbol);
    if (held && nowMs - held.fetchedAt < REFRESH_MS) return held.points;
    try {
      report.calls++;
      const points = await this.ports.venue.settled(symbol, nowMs - HISTORY_MS, nowMs);
      this.history.set(symbol, { fetchedAt: nowMs, points });
      return points;
    } catch (error) {
      if (held && nowMs - held.fetchedAt < 2 * REFRESH_MS) {
        this.ports.log?.warn(`funding alerts ${symbol}: history refresh failed, using the copy from ${new Date(held.fetchedAt).toISOString()}: ${(error as Error).message}`);
        return held.points;
      }
      throw error;
    }
  }

  private pruneHistory(coins: readonly Coin[]): void {
    const on = new Set(coins.map((c) => c.symbol));
    for (const s of this.history.keys()) if (!on.has(s)) this.history.delete(s);
  }

  private async deliver(id: number, texts: Texts, nowMs: number): Promise<number> {
    let delivered = 0;
    for (const r of await this.ports.store.recipients()) if (await this.ports.send(r.chatId, texts[r.lang])) delivered++;
    await this.ports.store.markFired(id, nowMs, delivered);
    return delivered;
  }

  /** F8: near-miss (one a coin, side and day, while that side is normal) and random checks; their paths. */
  private async controls(
    coin: Coin, check: FundingCheck, next: ReadonlyArray<{ side: FundingSide; state: FundingSideState }>, params: FundingParams, nowMs: number, report: FundingTickReport,
  ): Promise<void> {
    const { store, source, build } = this.ports;
    const nm = check.nearMiss;
    // one a coin, side and UTC day: the once-key absorbs the day's later candidates (one insert attempt a check at most)
    if (nm && next.find((n) => n.side === nm.side)?.state.zone === 'normal') {
      const details: FundingNearMissDetails = { ...check.facts, side: nm.side, failed: nm.failed };
      const id = await store.insertControl(source, build, params, {
        kind: 'near_miss', symbol: coin.symbol, direction: FUNDING_SIDE_DIRECTION[nm.side], atMs: nowMs, details,
        dedupeKey: `funding-nm:${coin.symbol}:${nm.side}:${dayOf(nowMs)}`,
      });
      if (id !== null) {
        report.controls++;
        await store.insertPaths({ marketControlId: id }, coin.symbol, liqPathT0(nowMs));
      }
    }
    const slot = randomSlotAt(coin.symbol, nowMs);
    if (slot !== null) {
      const id = await store.insertControl(source, build, params, {
        kind: 'random', symbol: coin.symbol, direction: null, atMs: nowMs, details: check.facts, dedupeKey: `funding-rnd:${coin.symbol}:${slot}`,
      });
      if (id !== null) {
        report.controls++;
        await store.insertPaths({ marketControlId: id }, coin.symbol, liqPathT0(nowMs));
      }
    }
  }
}

/**
 * Every enabled `alert_symbols` coin; a coin missing from `perCoin` is on at the shared floor. A coin funding has
 * switched off is still checked (IB-151): its rows are journalled muted.
 */
export function coinsOf(listed: ReadonlyArray<{ symbol: string; base: string }>, params: FundingParams): Coin[] {
  return listed.map((c) => ({
    symbol: c.symbol, base: c.base, floorPer8h: params.perCoin[c.symbol]?.floorPer8h ?? FUNDING_FLOOR_PER_8H, on: params.perCoin[c.symbol]?.enabled ?? true,
  }));
}
