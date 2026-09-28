/**
 * IB-021 — parsing and validating what a member types into `/deposit`, `/risk`, `/limit`,
 * `/lang` and `/dex` (design §8.6). Pure, because these are the values position sizing and the
 * daily loss limit are computed from: a silently mis-parsed `1,5` would size every trade wrong.
 *
 * The rules are deliberately strict and the errors name the accepted range rather than just
 * saying "invalid" — the person is on a phone.
 */

import type { Lang } from './user.model';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'missing' | 'not_a_number' | 'out_of_range'; min?: number; max?: number };

/** Risk per trade, in percent of deposit. */
export const RISK_MIN = 0.1;
export const RISK_MAX = 10;
/** Daily loss limit, in percent of deposit. */
export const LIMIT_MIN = 0.5;
export const LIMIT_MAX = 50;
export const DEPOSIT_MIN = 1;
export const DEPOSIT_MAX = 100_000_000;

/**
 * Accepts `1234`, `1 234.5`, `1,5` (comma as the decimal separator — a Russian keyboard's
 * default) and `1_000`, and rejects anything else. It does NOT accept `1,234.5`: a string with
 * both separators is ambiguous between locales, and guessing would be a sizing error.
 */
export function parseNumber(raw: string | undefined): ParseResult<number> {
  const text = (raw ?? '').trim();
  if (text.length === 0) return { ok: false, reason: 'missing' };

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) return { ok: false, reason: 'not_a_number' };

  const normalised = text.replace(/[\s_]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return { ok: false, reason: 'not_a_number' };

  const value = Number(normalised);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'not_a_number' };
}

function inRange(result: ParseResult<number>, min: number, max: number): ParseResult<number> {
  if (!result.ok) return result;
  if (result.value < min || result.value > max) return { ok: false, reason: 'out_of_range', min, max };
  return result;
}

export function parseDeposit(raw: string | undefined): ParseResult<number> {
  return inRange(parseNumber(raw), DEPOSIT_MIN, DEPOSIT_MAX);
}

export function parseRiskPct(raw: string | undefined): ParseResult<number> {
  return inRange(parseNumber(raw), RISK_MIN, RISK_MAX);
}

export function parseLimitPct(raw: string | undefined): ParseResult<number> {
  return inRange(parseNumber(raw), LIMIT_MIN, LIMIT_MAX);
}

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

/** `/deposit 1000` → `['deposit', '1000']`; tolerant of `/deposit@botname`. */
export function parseCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head, ...args] = trimmed.slice(1).split(/\s+/);
  const command = (head ?? '').split('@')[0].toLowerCase();
  return command.length > 0 ? { command, args } : null;
}
