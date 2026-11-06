import { CUSTOM_LEVELS_PER_COIN_MAX, type CustomLevelEventSwitches } from '@trade-automation/contracts';
import type { CustomLevel, CustomLevelAddResult } from '../../../src/alerts/levels/pg/custom-levels.repo';

/** IB-128 — `PgCustomLevelStore` in memory, with its rules (listed coin, cap, soft delete), for the specs. */
export class MemoryCustomLevels {
  rows: Array<CustomLevel & { deleted: boolean }> = [];
  listed = new Map([['BTCUSDT', 'BTC'], ['TRXUSDT', 'TRX']]);
  private id = 0;
  async active() { return this.rows.filter((r) => !r.deleted).map(({ deleted: _d, ...r }) => r); }
  async activeFor(symbol: string) { return (await this.active()).filter((r) => r.symbol === symbol); }
  async bases() { return this.listed; }
  async resolveSymbol(t: string) {
    const u = t.toUpperCase();
    for (const [symbol, base] of this.listed) if (symbol === u || base === u) return { symbol, base };
    return null;
  }
  async add(x: { symbol: string; price: number; note: string | null; events: CustomLevelEventSwitches; by: number }): Promise<CustomLevelAddResult> {
    if (!this.listed.has(x.symbol)) return { ok: false, reason: 'not_listed' };
    if ((await this.activeFor(x.symbol)).length >= CUSTOM_LEVELS_PER_COIN_MAX) return { ok: false, reason: 'too_many' };
    const level = { id: ++this.id, symbol: x.symbol, price: x.price, note: x.note, events: x.events, createdBy: x.by, createdAtMs: 1_000 };
    this.rows.push({ ...level, deleted: false });
    return { ok: true, level };
  }
  async remove(id: number) {
    const r = this.rows.find((x) => x.id === id && !x.deleted);
    if (!r) return null;
    r.deleted = true;
    return r;
  }
  async get(id: number) { return (await this.active()).find((r) => r.id === id) ?? null; }
  async setEvents(id: number, events: CustomLevelEventSwitches) {
    const r = this.rows.find((x) => x.id === id && !x.deleted);
    if (!r) return null;
    r.events = events;
    return r;
  }
}
