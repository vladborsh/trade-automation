import { z } from 'zod';

/**
 * IB-035 — the admin's members page and a member's own settings on the site.
 *
 * Admin-only: `GET /api/web/admin/members`, `POST /api/web/admin/invites`,
 * `POST /api/web/admin/members/:id/disable|enable` (a member gets 403).
 * Any member: `GET` / `PATCH /api/web/me/settings`.
 *
 * WD-013 removed the sizing settings (deposit, risk, daily loss limit, DEX alerts) with the signals
 * they configured, so a member's settings are the two the bot still has: `/lang` and `/calendar`.
 */

/**
 * One row of the members list. The Telegram name and @username are NOT here: the `users` table has
 * never stored them, only Telegram's numeric id (IB-035 report).
 */
export const WebMemberSchema = z.object({
  id: z.number().int(),
  tgUserId: z.number().int(),
  /** The site login, or null when the member has never set a password. */
  login: z.string().nullable(),
  role: z.enum(['admin', 'member']),
  disabled: z.boolean(),
  /** When the member joined, epoch ms. */
  createdAt: z.number(),
  /** The last `success` in the login journal (kept 90 days), epoch ms; null when none. */
  lastLoginAt: z.number().nullable(),
  /** Live web sessions right now. */
  activeSessions: z.number().int().nonnegative(),
});
export type WebMember = z.infer<typeof WebMemberSchema>;

export const WebMembersResponseSchema = z.object({ members: z.array(WebMemberSchema) });
export type WebMembersResponse = z.infer<typeof WebMembersResponseSchema>;

/** One member after disable/enable. */
export const WebMemberResponseSchema = z.object({ member: WebMemberSchema });
export type WebMemberResponse = z.infer<typeof WebMemberResponseSchema>;

/** A new invite: the link is shown ONCE, here, and never appears in the members list. */
export const WebInviteResponseSchema = z.object({
  link: z.string(),
  /** Epoch ms. */
  expiresAt: z.number(),
});
export type WebInviteResponse = z.infer<typeof WebInviteResponseSchema>;

/**
 * Why a disable or enable was refused (409), or why an invite could not be made (409: the bot's
 * username is not configured, so no deep link can be built).
 */
export const WEB_MEMBER_REFUSALS = ['CANNOT_DISABLE_SELF', 'LAST_ADMIN', 'BOT_NOT_CONFIGURED'] as const;
export type WebMemberRefusal = (typeof WEB_MEMBER_REFUSALS)[number];

/** A member's own settings: exactly what the bot's `/lang` and `/calendar` set. */
export const WebMemberSettingsSchema = z.object({
  lang: z.enum(['ru', 'en']),
  /** The calendar digest and pre-event reminders in Telegram. */
  calendarAlerts: z.boolean(),
  /** IB-112 (V13): OI divergence alerts in Telegram (`users.oi_alerts`). Admins start on, members off. */
  oiAlerts: z.boolean(),
  /**
   * Whether this member may see and change `oiAlerts`: always for an admin; for a member only while
   * the admin page's `members_visible` is on. Hidden is not refused silently: a PATCH of `oiAlerts`
   * while this is false answers 403 `{ code: 'SETTING_NOT_AVAILABLE', field: 'oiAlerts' }`.
   */
  oiAlertsVisible: z.boolean(),
  /** IB-122 (design §1 Recipients): large-liquidation alerts in Telegram (`users.liq_alerts`). Admins start on. */
  liqAlerts: z.boolean(),
  /** As `oiAlertsVisible`, for `liqAlerts`, behind `alert_type_settings('liq').members_visible`. */
  liqAlertsVisible: z.boolean(),
});
export type WebMemberSettings = z.infer<typeof WebMemberSettingsSchema>;

/**
 * `PATCH /api/web/me/settings`. **Strict**: any other field is refused, not ignored. The values
 * are deliberately loose in TYPE, because the server parses them with the bot's own parsers
 * (`parseLang`, `parseOnOff`). The same value is then accepted or refused the same way on both
 * paths. A refused value answers 400 `{ code: 'INVALID_SETTING', field }`.
 */
export const WebMemberSettingsPatchSchema = z.object({
  lang: z.string().optional(),
  calendarAlerts: z.union([z.boolean(), z.string()]).optional(),
  /** IB-112: parsed like `calendarAlerts` (the bot's `parseOnOff`). */
  oiAlerts: z.union([z.boolean(), z.string()]).optional(),
  /** IB-122: parsed like `calendarAlerts`; 403 `SETTING_NOT_AVAILABLE` while hidden. */
  liqAlerts: z.union([z.boolean(), z.string()]).optional(),
}).strict();
export type WebMemberSettingsPatch = z.infer<typeof WebMemberSettingsPatchSchema>;
