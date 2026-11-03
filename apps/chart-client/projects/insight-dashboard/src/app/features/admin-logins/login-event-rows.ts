import type { WebLoginEvent } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { outcomeKey } from '../auth/auth-messages';

/** IB-079 — one journal row as the table shows it. Pure, so the mapping has its own spec. */
export interface LoginEventRow {
  id: number;
  /** UTC, `YYYY-MM-DD HH:MM:SS` — the journal is read against server logs, which are UTC. */
  time: string;
  login: string;
  outcome: StringKey;
  /** A failure is what an admin scans for. */
  failed: boolean;
  ip: string;
  device: string;
}

const FAILED = new Set(['bad_credentials', 'throttled']);

export function toLoginEventRow(e: WebLoginEvent): LoginEventRow {
  return {
    id: e.id,
    time: new Date(e.at).toISOString().replace('T', ' ').slice(0, 19),
    login: e.loginAttempted ?? '—',
    outcome: outcomeKey(e.outcome),
    failed: FAILED.has(e.outcome),
    ip: e.ip ?? '—',
    device: shortDevice(e.userAgent),
  };
}

/**
 * The user agent reduced to what an admin recognises: the browser and the platform. The full string
 * is kept as the cell's title. Unknown shapes fall back to the first 40 characters, never to nothing.
 */
export function shortDevice(ua: string | null): string {
  if (!ua) return '—';
  // checked in PRIORITY order, not string order: Edge and Opera also say "Chrome", Chrome also says
  // "Safari", and Android also says "Linux"
  const browser = BROWSERS.find(([token]) => ua.includes(token))?.[1];
  const platform = PLATFORMS.find(([token]) => ua.includes(token))?.[1];
  if (browser && platform) return `${browser} · ${platform}`;
  return ua.slice(0, 40);
}

const BROWSERS: ReadonlyArray<readonly [string, string]> = [
  ['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari'],
];
const PLATFORMS: ReadonlyArray<readonly [string, string]> = [
  ['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Android', 'Android'], ['Windows', 'Windows'], ['Mac OS X', 'macOS'], ['Linux', 'Linux'],
];
