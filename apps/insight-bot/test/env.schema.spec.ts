import { EnvSchema, validateEnv } from '../src/config/env.schema';

describe('validateEnv', () => {
  it('IB-078 H6: CLIENT_IP_HEADER has no default (socket address) and is kept as given when set', () => {
    expect(validateEnv({}).CLIENT_IP_HEADER).toBeUndefined();
    expect(validateEnv({ CLIENT_IP_HEADER: 'x-real-ip' }).CLIENT_IP_HEADER).toBe('x-real-ip');
  });

  it('defaults PORT to the coordinator slot 3005 and coerces a slot port from its string', () => {
    expect(validateEnv({}).PORT).toBe(3005);
    expect(validateEnv({ PORT: '3025' }).PORT).toBe(3025);
  });

  it('leaves DATABASE_URL undefined when unset — it has no default, so DbModule disables itself', () => {
    expect(validateEnv({}).DATABASE_URL).toBeUndefined();
    expect(validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/insight_dev2' }).DATABASE_URL).toBe(
      'postgresql://u:p@localhost:5432/insight_dev2',
    );
  });

  it("reads DB_MIGRATE_ON_BOOT='false' as false (z.coerce.boolean would say true)", () => {
    expect(validateEnv({}).DB_MIGRATE_ON_BOOT).toBe(true);
    expect(validateEnv({ DB_MIGRATE_ON_BOOT: 'false' }).DB_MIGRATE_ON_BOOT).toBe(false);
    expect(validateEnv({ DB_MIGRATE_ON_BOOT: 'true' }).DB_MIGRATE_ON_BOOT).toBe(true);
    expect(validateEnv({ DB_MIGRATE_ON_BOOT: '1' }).DB_MIGRATE_ON_BOOT).toBe(true);
    expect(validateEnv({ DB_MIGRATE_ON_BOOT: '0' }).DB_MIGRATE_ON_BOOT).toBe(false);
  });

  it('defaults the universe file, the venue endpoints and the watchdog threshold', () => {
    const env = validateEnv({});
    expect(env.UNIVERSE_FILE).toBe('config/universe.yaml');
    expect(env.BINANCE_FUTURES_WS_BASE_URL).toBe('wss://fstream.binance.com');
    expect(env.BINANCE_SPOT_REST_BASE_URL).toBe('https://api.binance.com');
    expect(env.BYBIT_WS_URL).toContain('bybit.com');
    expect(env.OKX_WS_URL).toContain('okx.com');
    expect(env.WATCHDOG_SILENCE_MIN).toBe(3);
  });

  /**
   * WD-014: three keys left the schema. A box or slot whose .env still sets them must boot, and Nest
   * hands validateEnv the whole process.env anyway (PATH, HOME, …): unknown keys are stripped, never
   * an error. Pinned, because `.strict()` here would turn a forgotten line into a failed deploy.
   */
  it('a key the schema dropped (or never knew) is stripped, not a boot failure', () => {
    const env = validateEnv({
      ALERTS_PER_DAY: '3',
      BINANCE_SPOT_WS_BASE_URL: 'wss://stream.binance.com:9443',
      BINANCE_ARCHIVE_BASE_URL: 'https://example.invalid',
      SOMETHING_ELSE_ENTIRELY: 'x',
      PORT: '3015',
    }) as Record<string, unknown>;
    expect(env.PORT).toBe(3015);
    for (const gone of ['ALERTS_PER_DAY', 'BINANCE_SPOT_WS_BASE_URL', 'BINANCE_ARCHIVE_BASE_URL', 'SOMETHING_ELSE_ENTIRELY']) {
      expect(gone in env).toBe(false);
    }
  });

  it('the three dropped keys are really gone from the schema', () => {
    const keys = Object.keys(EnvSchema.innerType().shape);
    for (const gone of ['ALERTS_PER_DAY', 'BINANCE_SPOT_WS_BASE_URL', 'BINANCE_ARCHIVE_BASE_URL']) expect(keys).not.toContain(gone);
  });

  it('leaves the Telegram keys optional — the app boots without a bot token', () => {
    const env = validateEnv({});
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(env.TELEGRAM_SERVICE_CHAT_ID).toBeUndefined();
  });

  it('fails the boot on an invalid value rather than warning', () => {
    expect(() => validateEnv({ LOG_LEVEL: 'verbose' })).toThrow(/Invalid environment configuration/);
    expect(() => validateEnv({ PORT: 'nope' })).toThrow(/Invalid environment configuration/);
    expect(() => validateEnv({ WATCHDOG_SILENCE_MIN: '0' })).toThrow(/Invalid environment configuration/);
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/Invalid environment configuration/);
  });

  it('IB-069: the VAPID keys are all three or none — a partial set is a boot failure', () => {
    expect(validateEnv({}).WEB_PUSH_VAPID_PUBLIC).toBeUndefined();
    const all = { WEB_PUSH_VAPID_PUBLIC: 'pub', WEB_PUSH_VAPID_PRIVATE: 'priv', WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.com' };
    expect(validateEnv(all).WEB_PUSH_VAPID_SUBJECT).toBe('mailto:ops@example.com');
    expect(() => validateEnv({ WEB_PUSH_VAPID_PUBLIC: 'pub' })).toThrow(/set together or not at all/);
    expect(() => validateEnv({ ...all, WEB_PUSH_VAPID_SUBJECT: 'ops@example.com' })).toThrow(/mailto/);
    // an empty line in .env (`WEB_PUSH_VAPID_SUBJECT=`) is "not set", not a malformed subject
    expect(validateEnv({ WEB_PUSH_VAPID_SUBJECT: '' }).WEB_PUSH_VAPID_PUBLIC).toBeUndefined();
  });

  it('IB-115 (V27): BUILD_SHA — production refuses to boot without it; a slot without it is «dev»', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/BUILD_SHA is required in production/);
    expect(() => validateEnv({ NODE_ENV: 'production', BUILD_SHA: '' })).toThrow(/BUILD_SHA is required in production/); // a build without the arg
    expect(() => validateEnv({ NODE_ENV: 'production', BUILD_SHA: 'dev' })).toThrow(/BUILD_SHA is required in production/);
    expect(validateEnv({ NODE_ENV: 'production', BUILD_SHA: 'b49cd48d4ab4' }).BUILD_SHA).toBe('b49cd48d4ab4');
    expect(validateEnv({}).BUILD_SHA).toBe('dev');
    expect(validateEnv({ BUILD_SHA: '' }).BUILD_SHA).toBe('dev');
    expect(() => validateEnv({ BUILD_SHA: 'sha-b49cd48d4ab4' })).toThrow(/12 hex/); // the tag, not the commit
    expect(() => validateEnv({ BUILD_SHA: 'b49cd48d4ab4a78f' })).toThrow(/12 hex/);
  });
});
