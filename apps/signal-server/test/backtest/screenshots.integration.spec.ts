import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { Readable } from 'stream';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { ScreenshotService } from '../../src/backtest/screenshot.service';
import { NewSession } from '../../src/backtest/session.repository.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FileScreenshotStore } from '../../src/storage/file/file-screenshot-store';
import { ScreenshotObject, ScreenshotStore, screenshotKey, sessionScreenshotPrefix } from '../../src/storage/screenshot-store.port';
import { DAY, T0, fakeStore, makeSessionService } from './fake-backtest';
import { makePng } from './png-fixture';
import { expectSameBytes } from '../bytes';
import { DB_HOOK_TIMEOUT_MS } from '../db/scratch-db';

/**
 * T-025 done-when against a real Postgres and a real file store in a tmp dir: write-once under a
 * concurrent race (the unique index is the gate), a failed store write rolls the claim back, and
 * a failed prefix delete leaves the session in place. Skipped (loudly) without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('screenshots.integration.spec.ts: DATABASE_URL not set — skipping the real-Postgres screenshot tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NEW_SESSION: NewSession = {
  name: 'screenshots',
  sessionCurrency: 'USD',
  timeframe: '15m',
  periodFromMs: T0 + 5 * DAY,
  periodToMs: T0 + 10 * DAY,
  initialBalance: 10_000,
  defaultRiskPct: 1,
  costs: { enabled: false, commissionPct: 0, spread: 0 },
  skipWeekends: true,
  notionalWarnMultiple: 5,
  layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
};

/** Wraps a real store: `put` can be held at a gate or made to fail once; calls are counted. */
class ControlledStore implements ScreenshotStore {
  puts = 0;
  failPut: Error | null = null;
  failDelete: Error | null = null;
  private gate: Promise<void> | null = null;
  private openGate: (() => void) | null = null;
  parked: Promise<void> = Promise.resolve();
  private markParked: (() => void) | null = null;

  constructor(private readonly inner: ScreenshotStore) {}

  hold(): void {
    this.gate = new Promise((resolve) => (this.openGate = resolve));
    this.parked = new Promise((resolve) => (this.markParked = resolve));
  }
  release(): void {
    this.openGate?.();
    this.gate = null;
  }
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.puts++;
    if (this.failPut) {
      const err = this.failPut;
      this.failPut = null;
      throw err;
    }
    if (this.gate) {
      this.markParked?.();
      await this.gate;
    }
    return this.inner.put(key, bytes, contentType);
  }
  get(key: string): Promise<ScreenshotObject | null> {
    return this.inner.get(key);
  }
  async deleteByPrefix(prefix: string): Promise<number> {
    if (this.failDelete) {
      const err = this.failDelete;
      this.failDelete = null;
      throw err;
    }
    return this.inner.deleteByPrefix(prefix);
  }
}

const config = { env: { get: (k: string) => (k === 'SCREENSHOT_MAX_WIDTH_PX' ? 1280 : undefined) } } as never;
const png = (w: number, h: number, seed: number) => {
  const bytes = makePng(w, h, seed);
  return { contentType: 'image/png', contentLength: String(bytes.length), body: Readable.from([bytes]), bytes };
};
const statusOf = (p: Promise<unknown>) => p.then(() => 201, (e: HttpException) => e.getStatus());

maybeDescribe('screenshots against a real Postgres + file store (T-025 done-when)', () => {
  const run = randomUUID().slice(0, 8);
  let db: PgDatabase;
  let repos: PgBacktestRepositories;
  let root: string;
  let store: ControlledStore;
  let screenshots: ScreenshotService;
  let alice: string;

  beforeAll(async () => {
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    repos = new PgBacktestRepositories(db);
    alice = (await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [`alice-${run}@shots-it.test`]))[0].id;
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: migrates the slot database (waits on other workers' migration lock)
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-it-'));
    store = new ControlledStore(new FileScreenshotStore(root));
    screenshots = new ScreenshotService(repos, store, config);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  afterAll(async () => {
    await db.query(`delete from users where email like $1`, [`%-${run}@shots-it.test`]);
    await db.end();
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this spec's users and everything they own

  async function sessionWithOrder() {
    const session = await repos.sessions.insert(alice, NEW_SESSION);
    const order = await repos.orders.insert({
      sessionId: session.id, seq: 1, panelId: 'btc', instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'open',
      placedAtMs: NEW_SESSION.periodFromMs, limitPrice: null, entryPrice: 100, entryTimeMs: NEW_SESSION.periodFromMs - 60_000, qty: 1,
      riskPct: 1, riskAmountCcy: 100, sl: 90, tp: null, fillResolution: '1m',
    });
    return { session, order };
  }

  it('two concurrent PUTs: exactly one 201 and one 409 SCREENSHOT_EXISTS; the store is written once, with the winner’s bytes', async () => {
    const { session, order } = await sessionWithOrder();
    const a = png(200, 100, 1);
    const b = png(300, 150, 2);

    store.hold();
    const first = statusOf(screenshots.put(alice, session.id, order.id, 'entry', a));
    await store.parked; // A has claimed the row (uncommitted) and is inside the store write
    let secondSettled = false;
    const second = statusOf(screenshots.put(alice, session.id, order.id, 'entry', b)).finally(() => (secondSettled = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(secondSettled).toBe(false); // B is blocked on the unique index behind A's open transaction
    store.release();

    expect(await Promise.all([first, second])).toEqual([201, 409]);
    expect(store.puts).toBe(1); // the loser never touched the store
    const key = screenshotKey(alice, session.id, order.id, 'entry');
    expectSameBytes(fs.readFileSync(path.join(root, key)), a.bytes);
    const rows = await db.query<{ width_px: number; height_px: number; bytes: number; store_key: string }>(
      `select width_px, height_px, bytes, store_key from screenshots where order_id = $1`,
      [order.id],
    );
    expect(rows).toEqual([{ width_px: 200, height_px: 100, bytes: a.bytes.length, store_key: key }]);
  });

  it('a failed store write rolls the claim back, so a retry succeeds', async () => {
    const { session, order } = await sessionWithOrder();
    store.failPut = new Error('disk full');
    expect(await statusOf(screenshots.put(alice, session.id, order.id, 'exit', png(64, 64, 3)))).toBe(500);
    expect(await db.query(`select id from screenshots where order_id = $1`, [order.id])).toHaveLength(0);
    expect(await statusOf(screenshots.put(alice, session.id, order.id, 'exit', png(64, 64, 4)))).toBe(201);
    expect(await db.query(`select id from screenshots where order_id = $1`, [order.id])).toHaveLength(1);
  });

  it('session delete: a failed prefix delete leaves everything in place; the retry removes files, then rows', async () => {
    const { session, order } = await sessionWithOrder();
    await screenshots.put(alice, session.id, order.id, 'entry', png(32, 32, 5));
    const file = path.join(root, screenshotKey(alice, session.id, order.id, 'entry'));
    const sessions = makeSessionService(repos as never, fakeStore(), store);

    store.failDelete = new Error('S3 unavailable');
    expect(await statusOf(sessions.delete(alice, session.id))).toBe(500);
    expect(await db.query(`select id from backtest_sessions where id = $1`, [session.id])).toHaveLength(1);
    expect(await db.query(`select id from screenshots where session_id = $1`, [session.id])).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(true);

    await sessions.delete(alice, session.id);
    expect(fs.existsSync(path.join(root, sessionScreenshotPrefix(alice, session.id)))).toBe(false);
    expect(await db.query(`select id from backtest_sessions where id = $1`, [session.id])).toHaveLength(0);
    expect(await db.query(`select id from screenshots where session_id = $1`, [session.id])).toHaveLength(0); // cascade
  });
});
