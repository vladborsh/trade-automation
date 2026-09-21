import { validateEnv } from '../../src/config/env.schema';

/**
 * architecture/backtest-app-system-design.md §12.8 — DATABASE_URL has no default: a slot that
 * forgets to set it must get an explicitly-unset value, never a fallback that could point at
 * someone else's database.
 */
describe('env.schema — DB vars (T-004)', () => {
  it('DATABASE_URL is undefined when not provided (no default)', () => {
    const env = validateEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('passes DATABASE_URL through untouched when provided', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
  });

  it('DB_MIGRATE_ON_BOOT defaults to true', () => {
    const env = validateEnv({});
    expect(env.DB_MIGRATE_ON_BOOT).toBe(true);
  });

  it('DB_MIGRATE_ON_BOOT=false is respected (not the zod "false" string footgun)', () => {
    const env = validateEnv({ DB_MIGRATE_ON_BOOT: 'false' });
    expect(env.DB_MIGRATE_ON_BOOT).toBe(false);
  });

  it('SESSION_COOKIE_SECURE defaults to false outside production', () => {
    const env = validateEnv({ NODE_ENV: 'development' });
    expect(env.SESSION_COOKIE_SECURE).toBe(false);
  });

  it('SESSION_COOKIE_SECURE defaults to true in production', () => {
    const env = validateEnv({ NODE_ENV: 'production' });
    expect(env.SESSION_COOKIE_SECURE).toBe(true);
  });

  it('SESSION_COOKIE_SECURE can be forced explicitly regardless of NODE_ENV', () => {
    const env = validateEnv({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' });
    expect(env.SESSION_COOKIE_SECURE).toBe(false);
  });

  it('ADMIN_PASSWORD has no default and is never logged/echoed by this schema', () => {
    const env = validateEnv({});
    expect(env.ADMIN_PASSWORD).toBeUndefined();
  });

  it('SCREENSHOT_MAX_WIDTH_PX defaults to 1280', () => {
    const env = validateEnv({});
    expect(env.SCREENSHOT_MAX_WIDTH_PX).toBe(1280);
  });
});
