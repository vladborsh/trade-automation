import { Logger } from '@nestjs/common';
import type { Db } from '../../src/db/db.port';
import { SESSION_SWEEP_MS, SessionSweeperService } from '../../src/web/auth/session-sweeper.service';
import { WebModule } from '../../src/web/web.module';

/**
 * IB-BUG-017 — `sweepExpired` was never called, so expired sessions, spent login tokens and the
 * login journal beyond its 90 days were never purged. These specs pin that something now calls it:
 * at boot, then every hour; that a failed pass neither rejects nor stops the schedule; and that it
 * is wired into the app at all (a scheduler nobody provides is the original bug again).
 */

const NOW = Date.UTC(2026, 10, 4, 12);

/** A Db that records the three deletes and answers with `rows` rows each; `failFirst` throws once. */
function fakeDb(rows = 0, failFirst = false) {
  const deletes: string[] = [];
  let failed = !failFirst;
  const db = {
    query: async (sql: string) => {
      if (!failed) { failed = true; throw new Error('connection terminated unexpectedly'); }
      if (sql.includes('web_sessions')) deletes.push('sessions');
      if (sql.includes('web_login_tokens')) deletes.push('tokens');
      if (sql.includes('web_login_events')) deletes.push('events');
      return Array.from({ length: rows }, (_, i) => ({ id: String(i), token_hash: String(i) }));
    },
    transaction: async () => { throw new Error('not used'); },
  };
  return { db: db as unknown as Db, deletes };
}

const passes = (deletes: string[]) => deletes.filter((d) => d === 'sessions').length;

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the schedule', () => {
  it('sweeps once at boot, then every hour', async () => {
    jest.useFakeTimers({ now: NOW });
    const { db, deletes } = fakeDb();
    const service = new SessionSweeperService(db);
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(passes(deletes)).toBe(1); // boot: a redeploy more often than hourly must still sweep
    expect(deletes).toEqual(['sessions', 'tokens', 'events']); // all three tables, every pass

    await jest.advanceTimersByTimeAsync(SESSION_SWEEP_MS - 1);
    expect(passes(deletes)).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(passes(deletes)).toBe(2);
    await jest.advanceTimersByTimeAsync(2 * SESSION_SWEEP_MS);
    expect(passes(deletes)).toBe(4);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5 * SESSION_SWEEP_MS);
    expect(passes(deletes)).toBe(4); // stopped with the module
  });

  it('a failed pass is a warning, never a rejection, and the next hour sweeps again', async () => {
    jest.useFakeTimers({ now: NOW });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { db, deletes } = fakeDb(0, true);
    const service = new SessionSweeperService(db);
    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(passes(deletes)).toBe(0); // the boot pass failed…
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session sweep failed'));
    await jest.advanceTimersByTimeAsync(SESSION_SWEEP_MS);
    expect(passes(deletes)).toBe(1); // …and the schedule carried on
    service.onModuleDestroy();
  });

  it('sweepOnce resolves null on failure instead of throwing', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { db } = fakeDb(0, true);
    await expect(new SessionSweeperService(db).sweepOnce(NOW)).resolves.toBeNull();
  });

  it('logs the rows purged per table at debug', async () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const { db } = fakeDb(2);
    await expect(new SessionSweeperService(db).sweepOnce(NOW)).resolves.toEqual({ sessions: 2, tokens: 2, loginEvents: 2 });
    expect(debug).toHaveBeenCalledWith('swept: 2 sessions, 2 login tokens, 2 login events');
  });

  it('two passes never overlap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const db = { query: async () => { await gate; return []; }, transaction: async () => undefined } as unknown as Db;
    const service = new SessionSweeperService(db);
    const first = service.sweepOnce(NOW);
    await expect(service.sweepOnce(NOW)).resolves.toBeNull(); // the second one is skipped
    release();
    await expect(first).resolves.toEqual({ sessions: 0, tokens: 0, loginEvents: 0 });
  });

  it('the timer is unref\'d: it never keeps the process alive on its own', () => {
    const { db } = fakeDb();
    const service = new SessionSweeperService(db);
    service.onApplicationBootstrap();
    try {
      const timer = (service as unknown as { timer: NodeJS.Timeout }).timer;
      expect(timer.hasRef()).toBe(false);
    } finally {
      service.onModuleDestroy(); // a ref'd timer left behind would hang the test run itself
    }
  });

  it('without a database there is no timer and nothing to sweep', async () => {
    const service = new SessionSweeperService(null);
    service.onApplicationBootstrap();
    expect((service as unknown as { timer: unknown }).timer).toBeNull();
    await expect(service.sweepOnce(NOW)).resolves.toBeNull();
  });
});

describe('the wiring', () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('WebModule provides the sweeper whenever it has a database — the gap was that nothing did', () => {
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/insight_test';
    expect(WebModule.register().providers ?? []).toContain(SessionSweeperService);
  });
});
