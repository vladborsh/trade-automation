import {
  CUSTOM_LEVEL_EVENTS, CUSTOM_LEVEL_NOTE_MAX, customLevelEventOn, type CustomLevelEventSwitches, type WebCustomLevel,
  type WebChartCustomLevelsResponse, type WebCustomLevelCreate, type WebCustomLevelsResponse,
} from '@trade-automation/contracts';
import type { CustomLevel, PgCustomLevelStore } from './pg/custom-levels.repo';

/**
 * IB-128 (design §4 P9) — the owner's custom levels as one service for both doors: `/admin/alerts` (the web routes)
 * and the bot's `/level` commands. Admin-only is checked by each door (the web guard, the bot's role check); this
 * owns the rules: the coin must be on the alert list, at most CUSTOM_LEVELS_PER_COIN_MAX active per coin, deleting
 * is soft, and switches are stored as the exceptions only (an event switched back on is removed, not stored `true`).
 */
export class CustomLevelError extends Error {
  constructor(readonly reason: 'not_listed' | 'too_many' | 'not_found', message: string) {
    super(message);
  }
}

type Store = Pick<PgCustomLevelStore, 'active' | 'activeFor' | 'add' | 'remove' | 'setEvents' | 'get' | 'bases' | 'resolveSymbol'>;

export class CustomLevels {
  constructor(private readonly store: Store) {}

  async list(): Promise<WebCustomLevelsResponse> {
    const [levels, bases] = await Promise.all([this.store.active(), this.store.bases()]);
    return { levels: levels.map((l) => customLevelView(l, bases.get(l.symbol) ?? l.symbol)) };
  }

  async add(x: WebCustomLevelCreate, by: number): Promise<CustomLevel> {
    const r = await this.store.add({
      symbol: x.symbol, price: x.price, note: x.note ? x.note : null, events: onlyExceptions({}, x.events ?? {}), by,
    });
    if (r.ok) return r.level;
    throw r.reason === 'not_listed'
      ? new CustomLevelError('not_listed', `not on the alert list: ${x.symbol}`)
      : new CustomLevelError('too_many', `${x.symbol} already has the most active levels allowed`);
  }

  async remove(id: number, by: number): Promise<CustomLevel> {
    const level = await this.store.remove(id, by);
    if (!level) throw new CustomLevelError('not_found', `no active custom level ${id}`);
    return level;
  }

  async setEvents(id: number, patch: CustomLevelEventSwitches): Promise<CustomLevel> {
    const current = await this.store.get(id);
    if (!current) throw new CustomLevelError('not_found', `no active custom level ${id}`);
    const level = await this.store.setEvents(id, onlyExceptions(current.events, patch));
    if (!level) throw new CustomLevelError('not_found', `no active custom level ${id}`);
    return level;
  }

  resolveSymbol(ticker: string): Promise<{ symbol: string; base: string } | null> {
    return this.store.resolveSymbol(ticker);
  }

  active(): Promise<CustomLevel[]> {
    return this.store.active();
  }

  /** The chart's lines: one coin's active levels. */
  async chart(symbol: string): Promise<WebChartCustomLevelsResponse> {
    return { symbol, levels: (await this.store.activeFor(symbol)).map((l) => ({ id: l.id, price: l.price, note: l.note })) };
  }
}

/** Merges a patch of switches: `false` is stored, `true` removes the exception. */
export function onlyExceptions(current: CustomLevelEventSwitches, patch: CustomLevelEventSwitches): CustomLevelEventSwitches {
  const out: CustomLevelEventSwitches = { ...current };
  for (const e of CUSTOM_LEVEL_EVENTS) {
    if (patch[e] === undefined) continue;
    if (patch[e]) delete out[e];
    else out[e] = false;
  }
  return out;
}

export function customLevelView(l: CustomLevel, base: string): WebCustomLevel {
  return {
    id: l.id, symbol: l.symbol, base, price: l.price, note: l.note,
    events: {
      breakout_up: customLevelEventOn(l.events, 'breakout_up'), breakout_down: customLevelEventOn(l.events, 'breakout_down'),
      sweep_above: customLevelEventOn(l.events, 'sweep_above'), sweep_below: customLevelEventOn(l.events, 'sweep_below'),
    },
    createdBy: l.createdBy, createdAt: Math.floor(l.createdAtMs / 1000),
  };
}

// ------------------------------------------------------------------------------------------------ the bot command

/**
 * `/level` arguments, as the row names them: `/level BTC 72000 [note…]` adds, `/level del <id>` deletes, a bare `/level`
 * lists. The price takes a DOT as its decimal point; a comma is refused rather than guessed at («72,000» is 72 000 to
 * one reader and 72 to another, and a level 1 000× off would simply never fire).
 */
export type LevelCommand =
  | { kind: 'list' }
  | { kind: 'add'; ticker: string; price: number; note: string | null }
  | { kind: 'del'; id: number }
  | { kind: 'error'; reason: 'usage' | 'bad_price' | 'comma' | 'bad_id' | 'note_too_long' };

const TICKER = /^[A-Za-z0-9]{2,30}$/;
const PRICE = /^\d+(\.\d+)?$/;

export function parseLevelCommand(args: readonly string[]): LevelCommand {
  if (args.length === 0) return { kind: 'list' };
  if (args[0].toLowerCase() === 'del') {
    if (args.length !== 2 || !/^\d{1,15}$/.test(args[1]) || Number(args[1]) < 1) return { kind: 'error', reason: 'bad_id' };
    return { kind: 'del', id: Number(args[1]) };
  }
  if (args.length < 2 || !TICKER.test(args[0])) return { kind: 'error', reason: 'usage' };
  const text = args[1];
  if (text.includes(',')) return { kind: 'error', reason: 'comma' };
  const price = Number(text);
  if (!PRICE.test(text) || !Number.isFinite(price) || price <= 0) return { kind: 'error', reason: 'bad_price' };
  const note = args.slice(2).join(' ').trim();
  if (note.length > CUSTOM_LEVEL_NOTE_MAX) return { kind: 'error', reason: 'note_too_long' };
  return { kind: 'add', ticker: args[0], price, note: note === '' ? null : note };
}
