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
  CALENDAR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  CALENDAR_POLL_HOT_INTERVAL_MS: z.coerce.number().int().positive().default(120_000),
  // How far back the collector seeds its diff picture from calendar_events at boot.
  CALENDAR_CACHE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),

  // §6.2 — the watchdog alerts once when a stream has been silent for this many minutes.
  WATCHDOG_SILENCE_MIN: z.coerce.number().int().positive().default(3),
  // brief §1 — the per-user daily alert budget the gate enforces (§8.5).
  ALERTS_PER_DAY: z.coerce.number().int().positive().default(3),
});
export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  return result.data;
}
