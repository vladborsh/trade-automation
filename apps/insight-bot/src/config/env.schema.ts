import { z } from 'zod';

/**
 * architecture/insight-bot-system-design.md §2.1 — env, zod-validated at boot; an invalid
 * config is a boot failure, not a warning (the same rule as signal-server's `env.schema.ts`).
 */
// z.coerce.boolean() maps the string 'false' to `true` (Boolean('false') === true) — an explicit
// preprocess avoids that zod footgun. Lifted from signal-server, where it guards CALENDAR_ENABLED.
function booleanFlag(defaultValue: boolean) {
  return z.preprocess((v) => {
    if (v === undefined) return defaultValue;
    if (typeof v === 'boolean') return v;
    return String(v).toLowerCase() === 'true' || String(v) === '1';
  }, z.boolean());
}

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // AGENTS.md "Working in a worktree" — :3005 is the coordinator's slot; a dev slot overrides it
  // (dev-1 :3015, dev-2 :3025, dev-3 :3035, Tester :3045). See README.md.
  PORT: z.coerce.number().int().positive().default(3005),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // §2.3 — the hand-revised top-30 universe. Read and zod-validated at boot; a missing or
  // invalid file is a boot failure.
  UNIVERSE_FILE: z.string().default('config/universe.yaml'),

  // §7 (local development) — **no default**, exactly as in signal-server: a slot that forgets to
  // set it boots with DbModule disabled rather than falling through to another slot's database.
  // `db.module.ts` is the only reader of this being set or unset.
  DATABASE_URL: z.string().optional(),
  DB_MIGRATE_ON_BOOT: booleanFlag(true),

  // §8.6 — the tokens are the user's and live only in the slot's .env / SSM (§7). Optional so the
  // app boots without Telegram; the delivery module (IB-021) is what requires them.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_SERVICE_CHAT_ID: z.string().optional(),

  // §4.1–§4.3 — venue endpoints, overridable so a spec or a probe can point at a stand-in.
  BINANCE_FUTURES_REST_BASE_URL: z.string().default('https://fapi.binance.com'),
  // A HOST: the perp collector appends Binance's `/market` route itself (IB-BUG-012) and refuses a path.
  BINANCE_FUTURES_WS_BASE_URL: z.string().default('wss://fstream.binance.com'),
  BINANCE_SPOT_REST_BASE_URL: z.string().default('https://api.binance.com'),
  BINANCE_SPOT_WS_BASE_URL: z.string().default('wss://stream.binance.com:9443'),
  // §5 — data.binance.vision, served from the S3 bucket in ap-northeast-1.
  BINANCE_ARCHIVE_BASE_URL: z.string().default('https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'),
  BYBIT_WS_URL: z.string().default('wss://stream.bybit.com/v5/public/linear'),
  OKX_WS_URL: z.string().default('wss://ws.okx.com:8443/ws/v5/public'),
  // §4.3 — settled funding history (`/api/v5/public/funding-rate-history`), IB-009.
  OKX_REST_BASE_URL: z.string().default('https://www.okx.com'),

  // §2.1 collectors/calendar, §3.3 — the ForexFactory weekly feed (IB-010). The cadence is
  // signal-server's (architecture/economic-calendar.md §3.2): the default interval, the hot one
  // while a high-impact event is within ±20 min and through the Sunday feed rollover, and never
  // two requests less than 60 s apart.
  CALENDAR_ENABLED: booleanFlag(true),
  CALENDAR_FEED_BASE_URL: z.string().default('https://nfs.faireconomy.media/ff_calendar_thisweek'),
  // IB-058: how often the collector checks whether today's once-a-day fetch has happened. A
  // check makes no request on a collected day; it only bounds how late the day's fetch can be.
  CALENDAR_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  // IB-062: members' calendar DMs — the morning digest (UTC, HH:MM) and the reminder lead.
  CALENDAR_DIGEST_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, UTC').default('07:00'),
  CALENDAR_REMIND_LEAD_MIN: z.coerce.number().int().positive().max(24 * 60).default(15),
  // How far back the collector seeds its diff picture from calendar_events at boot.
  CALENDAR_CACHE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),

  // §10 (IB-036) — the two keyless market-context sources. No key is used or needed; the
  // endpoints that require one (/global/market_cap_chart, market_chart?days=max) are not called.
  FNG_BASE_URL: z.string().default('https://api.alternative.me'),
  COINGECKO_BASE_URL: z.string().default('https://api.coingecko.com'),

  // §6.2 — the watchdog alerts once when a stream has been silent for this many minutes.
  WATCHDOG_SILENCE_MIN: z.coerce.number().int().positive().default(3),
  // brief §1 — the per-user daily alert budget the gate enforces (§8.5).
  ALERTS_PER_DAY: z.coerce.number().int().positive().default(3),

  // IB-021, §8.6 — the member bot. Without a token the bot does not start at all (the app still
  // collects and serves /health); tokens are the user's to issue, never an agent's.
  // TELEGRAM_BOT_USERNAME only shapes the t.me/<bot>?start=<code> link text.
  TELEGRAM_BOT_USERNAME: z.string().default('insight_bot'),
  // The one account bootstrapped as admin on boot (§3.5). 0 means "no admin configured".
  ADMIN_TG_USER_ID: z.coerce.number().int().nonnegative().default(0),

  // IB-029, web dashboard §1 W3, §4 — where the dashboard is served. Empty means the dashboard
  // is not deployed: /web refuses rather than sending a link to nowhere.
  WEB_BASE_URL: z.string().default(''),
  // `Secure` on the ib_session cookie. Off only for local http development; IB-032 serves the
  // dashboard through a Cloudflare Tunnel (HTTPS), where this must be on.
  WEB_COOKIE_SECURE: booleanFlag(false),

  // IB-069 — browser Web Push for the calendar reminder (VAPID). Generate a pair with
  // `npx web-push generate-vapid-keys`; the keys live only in the slot's .env / SSM, never in git.
  // All three or none: without them the push channel is off (logged at boot), the bot still runs.
  // SUBJECT is the contact the push services see: `mailto:…` or an `https://` URL.
  WEB_PUSH_VAPID_PUBLIC: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE: z.string().optional(),
  WEB_PUSH_VAPID_SUBJECT: z.string().regex(/^$|^(mailto:|https:\/\/)/, 'mailto:… or https://…').optional(),
}).superRefine((env, ctx) => {
  const vapid = [env.WEB_PUSH_VAPID_PUBLIC, env.WEB_PUSH_VAPID_PRIVATE, env.WEB_PUSH_VAPID_SUBJECT];
  const set = vapid.filter((v) => typeof v === 'string' && v.length > 0).length;
  if (set !== 0 && set !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['WEB_PUSH_VAPID_PUBLIC'],
      message: 'WEB_PUSH_VAPID_PUBLIC, WEB_PUSH_VAPID_PRIVATE and WEB_PUSH_VAPID_SUBJECT are set together or not at all',
    });
  }
});
export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  return result.data;
}
