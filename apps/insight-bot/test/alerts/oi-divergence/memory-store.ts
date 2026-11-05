import {
  OI_DIVERGENCE_DEFAULT_PARAMS, OI_RESEARCH_WINDOWS, OI_RESEARCH_WINDOW_SEC, type OiDivergenceDirection, type OiDivergenceKind, type OiDivergenceTf, type OiJournalSource,
  type WebAlertSettings,
} from '@trade-automation/contracts';
import type {
  NewOiAlert, NewOiControl, NewOiNearMiss, NewOiSkip, NewPaths, OiAlertRecipient, OiAlertStore, OutcomeDue, PathDue, PathSubjectRef,
} from '../../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import type { PathMeasurement } from '../../../src/alerts/oi-divergence/research/path';

const H = 3_600;

/**
 * IB-112 / IB-115 / IB-116 — the alert store in memory, for the loop's and the backfill's specs. It enforces the
 * once-keys and checks as the migrations do (025, 027, 028's `source` in every key plus the backfill check, and
 * 033's `kind` in the journal's and the near-misses' keys), so a spec that relies on the database refusing
 * something can fail here too.
 */
export class MemoryStore implements OiAlertStore {
  settingsRow: WebAlertSettings = { enabled: false, membersVisible: false, params: OI_DIVERGENCE_DEFAULT_PARAMS, updatedBy: null, updatedAt: 0 };
  symbols = ['ETHUSDT'];
  alerts: Array<NewOiAlert & { id: number; firedAt: number | null; recipients: number; priceAtFire: number | null; price4h: number | null; price24h: number | null; outcomeAt: number | null }> = [];
  skips: NewOiSkip[] = [];
  users: OiAlertRecipient[] = [{ userId: 1, chatId: 111, lang: 'ru' }, { userId: 2, chatId: 222, lang: 'en' }];
  async settings() { return this.settingsRow; }
  async enabledSymbols() { return this.symbols; }
  async insertAlert(x: NewOiAlert) {
    // migration 033's once-key: (source, symbol, tf, kind, direction, a_time, b_time); 028's backfill check
    if (x.source === 'backfill' && x.late) throw new Error('violates check constraint "oi_divergence_alerts_backfill_unsent"');
    if (x.kind !== 'regular' && x.kind !== 'hidden') throw new Error('null value in column "kind" violates not-null constraint');
    if (this.alerts.some((a) => a.source === x.source && a.symbol === x.symbol && a.tf === x.tf && a.kind === x.kind && a.direction === x.direction && a.a.time === x.a.time && a.b.time === x.b.time)) return null;
    const id = this.alerts.length + 1;
    this.alerts.push({ ...x, id, firedAt: null, recipients: 0, priceAtFire: null, price4h: null, price24h: null, outcomeAt: null });
    return id;
  }
  async runFirstId(source: OiJournalSource, symbol: string, tf: OiDivergenceTf, kind: OiDivergenceKind, direction: OiDivergenceDirection, bTime: number) {
    return this.alerts.find((a) => a.source === source && a.symbol === symbol && a.tf === tf && a.kind === kind && a.direction === direction && a.b.time === bTime)?.id ?? null;
  }
  async markFired(id: number, firedAt: number, recipients: number, priceAtFire: number | null) {
    if (this.alerts[id - 1]?.source === 'backfill') throw new Error('violates check constraint "oi_divergence_alerts_backfill_unsent"');
    Object.assign(this.alerts[id - 1] as object, { firedAt, recipients, priceAtFire });
  }
  async insertSkip(x: NewOiSkip) {
    if (this.skips.some((s) => s.symbol === x.symbol && s.tf === x.tf && s.barTime === x.barTime)) return false;
    this.skips.push(x);
    return true;
  }
  async recipients() { return this.users; }
  async outcomesDue(now: number): Promise<OutcomeDue[]> {
    return this.alerts.filter((a) => a.firedAt !== null && a.outcomeAt === null && ((a.price4h === null && a.firedAt + 4 * H <= now) || (a.price24h === null && a.firedAt + 24 * H <= now)))
      .map((a) => ({ id: a.id, symbol: a.symbol, firedAt: a.firedAt as number, price4h: a.price4h, price24h: a.price24h }));
  }
  async setOutcome(id: number, field: 'price_4h' | 'price_24h', price: number, completeAt: number | null) {
    const a = this.alerts[id - 1] as (typeof this.alerts)[number];
    if (field === 'price_4h') a.price4h = price; else a.price24h = price;
    if (completeAt !== null) a.outcomeAt = completeAt;
  }
  // IB-115 — migration 027's once-keys, enforced as the database does
  controls: Array<NewOiControl & { id: number }> = [];
  nearMisses: Array<NewOiNearMiss & { id: number }> = [];
  paths: Array<NewPaths & { id: number; subject: PathSubjectRef; win: (typeof OI_RESEARCH_WINDOWS)[number]; m: PathMeasurement | null; triedAt: number | null }> = [];
  async hasAlert(source: OiJournalSource, symbol: string, tf: OiDivergenceTf, kind: OiDivergenceKind, direction: OiDivergenceDirection, bTime: number) {
    return this.alerts.some((a) => a.source === source && a.symbol === symbol && a.tf === tf && a.kind === kind && a.direction === direction && a.b.time === bTime);
  }
  async insertControl(x: NewOiControl) {
    if (this.controls.some((c) => c.source === x.source && c.symbol === x.symbol && c.tf === x.tf && c.kind === x.kind && c.direction === x.direction && c.barTime === x.barTime)) return null;
    const id = this.controls.length + 1;
    this.controls.push({ ...x, id });
    return id;
  }
  async insertNearMiss(x: NewOiNearMiss) {
    if (x.kind !== 'regular' && x.kind !== 'hidden') throw new Error('null value in column "kind" violates not-null constraint');
    if (this.nearMisses.some((c) => c.source === x.source && c.symbol === x.symbol && c.tf === x.tf && c.kind === x.kind && c.direction === x.direction && c.b.time === x.b.time)) return null;
    const id = this.nearMisses.length + 1;
    this.nearMisses.push({ ...x, id });
    return id;
  }
  async insertPaths(subject: PathSubjectRef, x: NewPaths) {
    for (const win of OI_RESEARCH_WINDOWS) {
      if (this.paths.some((p) => JSON.stringify(p.subject) === JSON.stringify(subject) && p.win === win)) continue;
      this.paths.push({ ...x, id: this.paths.length + 1, subject, win, m: null, triedAt: null });
    }
  }
  /** The subject's source, as 028's join reads it. */
  sourceOf(subject: PathSubjectRef): OiJournalSource | undefined {
    if ('alertId' in subject) return this.alerts[subject.alertId - 1]?.source;
    if ('controlId' in subject) return this.controls[subject.controlId - 1]?.source;
    return this.nearMisses[subject.nearMissId - 1]?.source;
  }
  async pathsDue(source: OiJournalSource, now: number, limit: number, retry: number): Promise<PathDue[]> {
    return this.paths.filter((p) => p.m === null && this.sourceOf(p.subject) === source && p.t0 + OI_RESEARCH_WINDOW_SEC[p.win] + 60 <= now && (p.triedAt === null || p.triedAt + retry <= now))
      .sort((a, b) => (a.triedAt ?? -1) - (b.triedAt ?? -1) || a.t0 - b.t0 || a.id - b.id).slice(0, limit)
      .map((p) => ({ id: p.id, symbol: p.symbol, win: p.win, direction: p.direction, t0: p.t0, atr14: p.atr14, stopPrice: p.stopPrice }));
  }
  async setPath(id: number, m: PathMeasurement) { (this.paths[id - 1] as (typeof this.paths)[number]).m = m; }
  async pathFailed(id: number, at: number) { (this.paths[id - 1] as (typeof this.paths)[number]).triedAt = at; }
}
