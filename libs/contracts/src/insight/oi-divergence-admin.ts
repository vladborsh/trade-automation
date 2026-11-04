import { z } from 'zod';
import { OiDivergenceParamsSchema } from './oi-divergence';

/**
 * IB-112 — the admin page's WRITES (architecture/oi-divergence-design-2026-11-04.md V2, V13, V17).
 * Its read is `WebAlertsAdminResponse` (IB-109, `oi-divergence.ts`); every write below answers with
 * that same whole-page state, so the page never stitches a partial reply into what it shows.
 *
 * - `POST   /api/web/admin/alerts/symbols`          {symbol}   add a coin, checked against Binance
 * - `PATCH  /api/web/admin/alerts/symbols/:symbol`  {enabled}  stop / resume evaluating it
 * - `DELETE /api/web/admin/alerts/symbols/:symbol`             remove it (its OI rows and journal stay)
 * - `PATCH  /api/web/admin/alerts/settings`         {enabled?, membersVisible?, params?}
 *
 * All four are admin only. A params change applies from the next evaluation; journal rows keep the
 * params they were made with (V17).
 */

/** A Binance USD-M symbol as the venue spells it. The page upper-cases what the admin types. */
export const AlertSymbolSchema = z.string().regex(/^[A-Z0-9]{2,30}$/);

/** `POST /admin/alerts/symbols`. Strict: anything else is refused, not ignored. */
export const WebAlertSymbolAddSchema = z.object({ symbol: AlertSymbolSchema }).strict();
export type WebAlertSymbolAdd = z.infer<typeof WebAlertSymbolAddSchema>;

/** `PATCH /admin/alerts/symbols/:symbol`. */
export const WebAlertSymbolPatchSchema = z.object({ enabled: z.boolean() }).strict();
export type WebAlertSymbolPatch = z.infer<typeof WebAlertSymbolPatchSchema>;

/** `PATCH /admin/alerts/settings`: any of the three, at least one. */
export const WebAlertSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  membersVisible: z.boolean().optional(),
  params: OiDivergenceParamsSchema.optional(),
}).strict().refine((p) => p.enabled !== undefined || p.membersVisible !== undefined || p.params !== undefined, {
  message: 'nothing to change',
});
export type WebAlertSettingsPatch = z.infer<typeof WebAlertSettingsPatchSchema>;

/**
 * Why adding a coin was refused (409 `{ code, message }`), checked against Binance USD-M
 * `exchangeInfo` (V17: a perpetual that is trading):
 * - `not_found`: no such symbol on Binance USD-M futures;
 * - `not_perpetual`: it exists but is a delivery (quarterly) contract;
 * - `not_trading`: a perpetual whose status is not TRADING (settling, delisted, pre-launch);
 * - `already_listed`: it is on the list already;
 * - `venue_unavailable`: exchangeInfo did not answer, so nothing was checked and nothing added.
 * A coin quoted in USDC is allowed: the OI and klines endpoints serve it the same way.
 */
export const WEB_ALERT_SYMBOL_REFUSALS = ['not_found', 'not_perpetual', 'not_trading', 'already_listed', 'venue_unavailable'] as const;
export const WebAlertSymbolRefusalSchema = z.enum(WEB_ALERT_SYMBOL_REFUSALS);
export type WebAlertSymbolRefusal = z.infer<typeof WebAlertSymbolRefusalSchema>;
