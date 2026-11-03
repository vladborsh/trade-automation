/**
 * IB-021 — parsing what a member types into `/lang` and `/calendar` (design §8.6), and the command
 * line itself. Pure. WD-013 removed the number parsers of `/deposit`, `/risk` and `/limit` with
 * those commands: they configured position sizing for signals the bot no longer sends.
 */

import type { Lang } from './user.model';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'missing' | 'not_a_number' | 'out_of_range'; min?: number; max?: number };

export function parseLang(raw: string | undefined): ParseResult<Lang> {
  const text = (raw ?? '').trim().toLowerCase();
  if (text.length === 0) return { ok: false, reason: 'missing' };
  return text === 'ru' || text === 'en' ? { ok: true, value: text } : { ok: false, reason: 'not_a_number' };
}

export function parseOnOff(raw: string | undefined): ParseResult<boolean> {
  const text = (raw ?? '').trim().toLowerCase();
  if (text.length === 0) return { ok: false, reason: 'missing' };
  if (['on', 'вкл', 'да', 'yes', '1', 'true'].includes(text)) return { ok: true, value: true };
  if (['off', 'выкл', 'нет', 'no', '0', 'false'].includes(text)) return { ok: true, value: false };
  return { ok: false, reason: 'not_a_number' };
}

/** `/lang en` → `['lang', 'en']`; tolerant of `/lang@botname`. */
export function parseCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head, ...args] = trimmed.slice(1).split(/\s+/);
  const command = (head ?? '').split('@')[0].toLowerCase();
  return command.length > 0 ? { command, args } : null;
}
