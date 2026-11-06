/**
 * IB-152 (owner ruling A): every time a Telegram message prints carries its zone. The bot runs in UTC
 * (main.ts refuses any other zone), so every time it prints is UTC, and says so with this label.
 * A per-member zone is out of scope (a follow-up); until then the label is the whole rule.
 *
 * Templates build their own digits (each keeps its established format); the label comes from here, so
 * a message with a time and no zone is one that did not call `utc()`, and `utc-label.spec.ts` lists
 * the templates that must.
 */
export const UTC_LABEL = 'UTC';

/** `15:06` → `15:06 UTC`. */
export function utc(text: string): string {
  return `${text} ${UTC_LABEL}`;
}
