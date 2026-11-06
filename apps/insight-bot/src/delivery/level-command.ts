import { CustomLevelError, parseLevelCommand, type CustomLevels } from '../alerts/levels/custom-levels';
import {
  CUSTOM_LEVEL_ERRORS, customLevelAdded, customLevelDeleted, customLevelList, type CustomLevelLine,
} from './templates/custom-level-alerts.texts';
import type { Texts } from './templates/texts';

/**
 * IB-128 (design §4 P9) — the bot's `/level` for an ADMIN (the role is checked by the caller, `bot-handlers.ts`):
 * `/level BTC 72000 [note]` adds and answers with the level and its id; `/level del <id>` deletes (softly);
 * a bare `/level` lists the active ones. The ticker is the coin's base or its symbol, as listed on `alert_symbols`.
 */
export type CustomLevelsPort = Pick<CustomLevels, 'add' | 'remove' | 'list' | 'resolveSymbol'>;

export async function handleLevelCommand(levels: CustomLevelsPort, args: readonly string[], userId: number): Promise<Texts> {
  const cmd = parseLevelCommand(args);
  try {
    switch (cmd.kind) {
      case 'error':
        return CUSTOM_LEVEL_ERRORS[cmd.reason];
      case 'list':
        return customLevelList((await levels.list()).levels);
      case 'del': {
        const l = await levels.remove(cmd.id, userId);
        return customLevelDeleted(await lineOf(levels, l));
      }
      case 'add': {
        const coin = await levels.resolveSymbol(cmd.ticker);
        if (!coin) return CUSTOM_LEVEL_ERRORS.not_listed;
        const l = await levels.add({ symbol: coin.symbol, price: cmd.price, ...(cmd.note ? { note: cmd.note } : {}) }, userId);
        return customLevelAdded({ id: l.id, base: coin.base, price: l.price, note: l.note });
      }
    }
  } catch (error) {
    if (error instanceof CustomLevelError) return CUSTOM_LEVEL_ERRORS[error.reason];
    throw error;
  }
}

async function lineOf(levels: CustomLevelsPort, l: { id: number; symbol: string; price: number; note: string | null }): Promise<CustomLevelLine> {
  const coin = await levels.resolveSymbol(l.symbol);
  return { id: l.id, base: coin?.base ?? l.symbol, price: l.price, note: l.note };
}
