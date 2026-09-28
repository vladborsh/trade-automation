import { validateEnv } from '../src/config/env.schema';

describe('validateEnv', () => {
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

  it('defaults the universe file, the venue endpoints and the two operating limits', () => {
    const env = validateEnv({});
    expect(env.UNIVERSE_FILE).toBe('config/universe.yaml');
    expect(env.BINANCE_FUTURES_WS_BASE_URL).toBe('wss://fstream.binance.com');
    expect(env.BINANCE_SPOT_REST_BASE_URL).toBe('https://api.binance.com');
    expect(env.BYBIT_WS_URL).toContain('bybit.com');
    expect(env.OKX_WS_URL).toContain('okx.com');
    expect(env.WATCHDOG_SILENCE_MIN).toBe(3);
    expect(env.ALERTS_PER_DAY).toBe(3);
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
});
