import { LIQ_DEFAULT_PARAMS, type LiqParams } from '@trade-automation/contracts';
import type { VenueStatus } from '../../../src/alerts/liquidations/coverage';
import {
  journalRow, type JournalLiqRow, type LiqAlertStore, type LiqSettings, type NewMarketAlert, type NewMarketControl, type TapePrint, type VenuePair,
} from '../../../src/alerts/liquidations/pg/liq-alerts.repo';

/** IB-122 — the loop's store in memory, with the same once-keys as migration 031 (source, type, dedupe_key). */
export class MemoryLiqStore implements LiqAlertStore {
  tape: TapePrint[] = [];
  coins = [{ symbol: 'BTCUSDT', base: 'BTC' }, { symbol: 'TRXUSDT', base: 'TRX' }];
  params: LiqParams = structuredClone(LIQ_DEFAULT_PARAMS);
  enabled = false;
  alerts: Array<NewMarketAlert & { id: number; firedAt: number | null; recipients: number }> = [];
  controls: Array<NewMarketControl & { id: number }> = [];
  paths: Array<{ subject: string; symbol: string; t0: number }> = [];
  users = [{ chatId: 7, lang: 'ru' as const }];
  status: VenueStatus = MemoryLiqStore.allAlive();
  reads = { prints: 0 };
  private nextId = 1;

  static allAlive(): VenueStatus {
    const alive = { firstSeen: 0, lastSeen: Number.MAX_SAFE_INTEGER };
    return {
      heartbeats: new Map([['binance', alive], ['bybit', alive], ['okx', alive]]),
      gaps: [],
      tracked: new Map([['bybit', new Map([['BTCUSDT', 0], ['TRXUSDT', 0]])], ['okx', new Map([['BTC-USDT-SWAP', 0], ['TRX-USDT-SWAP', 0]])]]),
    };
  }

  async settings(): Promise<LiqSettings> {
    return { enabled: this.enabled, membersVisible: false, params: this.params, updatedAt: 0 };
  }

  async listedCoins() {
    return this.coins;
  }

  private match(pairs: readonly VenuePair[]) {
    return (p: TapePrint) => pairs.some((x) => x.venue === p.venue && x.symbol === p.symbol);
  }

  async prints(pairs: readonly VenuePair[], fromMs: number, toMs: number): Promise<TapePrint[]> {
    this.reads.prints++;
    return this.tape.filter((p) => this.match(pairs)(p) && p.ts > fromMs && p.ts <= toMs).sort((a, b) => a.ts - b.ts);
  }

  async journal(source: 'live' | 'backfill', sinceMs: number): Promise<JournalLiqRow[]> {
    return this.alerts.filter((a) => a.source === source && a.atMs > sinceMs).sort((a, b) => a.atMs - b.atMs || a.id - b.id)
      .map((a) => journalRow({ id: a.id, event: a.event, symbol: a.symbol, atMs: a.atMs, late: a.late, details: a.details, muted: a.mutedBy !== undefined }));
  }

  async venueStatus(): Promise<VenueStatus> {
    return this.status;
  }

  async insertAlert(x: NewMarketAlert): Promise<number | null> {
    if (this.alerts.some((a) => a.source === x.source && a.dedupeKey === x.dedupeKey)) return null;
    const id = this.nextId++;
    this.alerts.push({ ...structuredClone(x), id, firedAt: null, recipients: 0 });
    return id;
  }

  async insertControl(x: NewMarketControl): Promise<number | null> {
    if (this.controls.some((a) => a.source === x.source && a.dedupeKey === x.dedupeKey)) return null;
    const id = this.nextId++;
    this.controls.push({ ...structuredClone(x), id });
    return id;
  }

  async insertPaths(subject: { marketAlertId: number } | { marketControlId: number }, symbol: string, t0Sec: number): Promise<void> {
    this.paths.push({ subject: 'marketAlertId' in subject ? `alert:${subject.marketAlertId}` : `control:${subject.marketControlId}`, symbol, t0: t0Sec });
  }

  async recipients() {
    return this.users;
  }

  async markFired(id: number, firedAtMs: number, recipients: number): Promise<void> {
    const row = this.alerts.find((a) => a.id === id);
    if (row) { row.firedAt = firedAtMs; row.recipients = recipients; }
  }

  async footnoteSent(dayStartMs: number): Promise<boolean> {
    return this.alerts.some((a) => a.firedAt !== null && a.firedAt >= dayStartMs && a.firedAt < dayStartMs + 86_400_000 && a.details.binanceFootnote === true);
  }
}
