/**
 * IB-035 — the decisions behind the admin's members page and a member's settings on the site. Pure;
 * the SQL is in `pg/users.repo.ts`, the wiring in `users.service.ts`.
 */
import type { WebMemberRefusal } from '@trade-automation/contracts';
import { generateInviteCode } from './invite-code';
import type { SettingsPatch } from './pg/users.repo';
import { parseLang, parseOnOff } from './settings';
import { INVITE_TTL_MS, type User } from './user.model';

/**
 * The site's settings PATCH, through the bot's OWN parsers (`/lang`, `/calendar on|off`). A value
 * is accepted or refused the same way on both paths: `' EN '` is English in both, `'de'` is refused
 * in both, and `'вкл'`/`'off'`/`true` mean the same thing. A boolean is passed as its string, which
 * `parseOnOff` already knows (`'true'`/`'false'`).
 */
export function settingsPatchFromWeb(
  body: { lang?: string; calendarAlerts?: boolean | string; oiAlerts?: boolean | string; liqAlerts?: boolean | string },
): { ok: true; patch: SettingsPatch } | { ok: false; field: 'lang' | 'calendarAlerts' | 'oiAlerts' | 'liqAlerts' } {
  const patch: SettingsPatch = {};
  if (body.lang !== undefined) {
    const lang = parseLang(body.lang);
    if (!lang.ok) return { ok: false, field: 'lang' };
    patch.lang = lang.value;
  }
  if (body.calendarAlerts !== undefined) {
    const on = parseOnOff(String(body.calendarAlerts));
    if (!on.ok) return { ok: false, field: 'calendarAlerts' };
    patch.calendarAlerts = on.value;
  }
  if (body.oiAlerts !== undefined) {
    const on = parseOnOff(String(body.oiAlerts));
    if (!on.ok) return { ok: false, field: 'oiAlerts' };
    patch.oiAlerts = on.value;
  }
  if (body.liqAlerts !== undefined) {
    const on = parseOnOff(String(body.liqAlerts));
    if (!on.ok) return { ok: false, field: 'liqAlerts' };
    patch.liqAlerts = on.value;
  }
  return { ok: true, patch };
}

/**
 * Why disabling `target` must be refused (409), or null when it may go ahead.
 * - **Yourself:** an admin who disables themselves has locked the door from outside.
 * - **The last active admin:** nobody could enable anyone again without SQL.
 * Enabling is never refused: it only clears the flag, and the password stays as it was.
 */
export function disableRefusal(actorId: number, target: Pick<User, 'id' | 'role' | 'disabled'>, activeAdmins: number): WebMemberRefusal | null {
  if (target.id === actorId) return 'CANNOT_DISABLE_SELF';
  if (target.role === 'admin' && !target.disabled && activeAdmins <= 1) return 'LAST_ADMIN';
  return null;
}

/** A new invite's code and expiry, the same for the bot's `/invite` and the site's button. */
export function newInvite(now: Date, ttlMs = INVITE_TTL_MS): { code: string; expiresAt: Date } {
  return { code: generateInviteCode(), expiresAt: new Date(now.getTime() + ttlMs) };
}

/**
 * IB-112 (OI divergence design V13): who may see and change the OI alerts toggle — an admin always,
 * a member only while the admin page's `members_visible` is on. The same rule on the site and in the bot.
 */
export function oiAlertsVisible(user: Pick<User, 'role'>, membersVisible: boolean): boolean {
  return user.role === 'admin' || membersVisible;
}
