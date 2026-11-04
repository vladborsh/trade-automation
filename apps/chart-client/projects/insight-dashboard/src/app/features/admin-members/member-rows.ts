import type { WebMember, WebMemberRefusal } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/** IB-035 — one row of the members table as it is shown. Pure, so the mapping has its own spec. */
export interface MemberRow {
  id: number;
  tgUserId: number;
  login: string;
  role: StringKey;
  disabled: boolean;
  /** UTC day, `YYYY-MM-DD`. */
  joined: string;
  /** UTC, `YYYY-MM-DD HH:MM`, or a dash. */
  lastLogin: string;
  sessions: number;
  /** What the row's button does; null on the admin's own row (the server refuses it: 409). */
  action: 'disable' | 'enable' | null;
}

export function toMemberRow(m: WebMember, selfId: number | null): MemberRow {
  return {
    id: m.id,
    tgUserId: m.tgUserId,
    login: m.login ?? '—',
    role: m.role === 'admin' ? 'members.role.admin' : 'members.role.member',
    disabled: m.disabled,
    joined: new Date(m.createdAt).toISOString().slice(0, 10),
    lastLogin: m.lastLoginAt === null ? '—' : new Date(m.lastLoginAt).toISOString().replace('T', ' ').slice(0, 16),
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
