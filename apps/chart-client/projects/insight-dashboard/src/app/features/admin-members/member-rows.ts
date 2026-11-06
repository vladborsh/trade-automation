import { dateTime, dayMonthYear, type Zone } from '../../shared/time-format';
import type { WebMember, WebMemberRefusal } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/** IB-035 — one row of the members table as it is shown. Pure, so the mapping has its own spec. */
export interface MemberRow {
  id: number;
  tgUserId: number;
  login: string;
  role: StringKey;
  disabled: boolean;
  /** `dd.MM.yyyy`, the viewer's zone (IB-152). */
  joined: string;
  /** `dd.MM HH:mm`, the viewer's zone, or a dash. */
  lastLogin: string;
  sessions: number;
  /** What the row's button does; null on the admin's own row (the server refuses it: 409). */
  action: 'disable' | 'enable' | null;
}

export function toMemberRow(m: WebMember, selfId: number | null, zone?: Zone): MemberRow {
  return {
    id: m.id,
    tgUserId: m.tgUserId,
    login: m.login ?? '—',
    role: m.role === 'admin' ? 'members.role.admin' : 'members.role.member',
    disabled: m.disabled,
    joined: dayMonthYear(m.createdAt / 1000, zone),
    lastLogin: m.lastLoginAt === null ? '—' : dateTime(m.lastLoginAt / 1000, zone),
    sessions: m.activeSessions,
    action: m.id === selfId ? null : m.disabled ? 'enable' : 'disable',
  };
}

/** The sentence for a refused disable (409), from the server's code. Anything else is the generic failure. */
export function refusalKey(code: unknown): StringKey {
  const known: Record<WebMemberRefusal, StringKey> = {
    CANNOT_DISABLE_SELF: 'members.refused.self',
    LAST_ADMIN: 'members.refused.lastAdmin',
    BOT_NOT_CONFIGURED: 'members.refused.noBot',
  };
  return typeof code === 'string' && code in known ? known[code as WebMemberRefusal] : 'members.failed';
}
