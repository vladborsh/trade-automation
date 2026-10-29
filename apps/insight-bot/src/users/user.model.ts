/**
 * IB-021 — the bot's people (design §3.5).
 */

export type UserRole = 'admin' | 'member';
export type Lang = 'ru' | 'en';

export interface User {
  id: number;
  tgUserId: number;
  chatId: number | null;
  role: UserRole;
  lang: Lang;
  deposit: number | null;
  riskPct: number;
  dailyLossLimitPct: number | null;
  dexAlerts: boolean;
  /** IB-062: calendar digest and pre-event reminders in the member's DM. */
  calendarAlerts: boolean;
  invitedBy: number | null;
  disabled: boolean;
  createdAt: Date;
}

export interface Invite {
  code: string;
  createdBy: number;
  createdAt: Date;
  expiresAt: Date;
  usedBy: number | null;
  usedAt: Date | null;
}

/** §3.5: invites last a week. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
