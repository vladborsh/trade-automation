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
  /** IB-112 (OI divergence design V13): OI divergence alerts in the DM. Migration 025: on for admins, off for members. */
  oiAlerts: boolean;
  /** IB-122 (liq design §1): large-liquidation alerts in the DM. Migration 031: on for admins, off for members. */
  liqAlerts: boolean;
  /** IB-124 (design §1 Recipients): funding alerts in the DM. Migration 034: on for admins, off for members. */
  fundingAlerts: boolean;
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
