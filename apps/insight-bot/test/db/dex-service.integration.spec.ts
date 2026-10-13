import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import type { DexClient, Fetched } from '../../src/dex/dex.client';
import { DexService } from '../../src/dex/dex.service';
import { CALL_SPACING_MS } from '../../src/dex/schedule';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-028 — the collector loop against a real database and a stubbed venue.
 *
 * The venue is stubbed and the DATABASE is real, which is the only split that can test the thing
 * most likely to break: the re-queue. A fake store would be written to agree with the query.
 *
 * **The positive controls that matter here are both directions of "is this token still due".** A
 * regression in either direction is expensive and silent: one burns the GoPlus budget for ever, the
 * other leaves us permanently ignorant about a token's security.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('dex-service.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DIR = join(__dirname, '..', 'fixtures', 'dex');
const POOLS = readFileSync(join(DIR, 'geckoterminal-new-pools-solana.json'), 'utf8');
/**
 * DexScreener's answer for the pool addresses of the GeckoTerminal fixture above — recorded for
 * THAT page, not a different one. The first run of this spec used an unrelated recording and the
 * service logged `20/20 not known to the venue` and stored nothing: the join is by address, so a
 * mismatched pair fixture makes the end-to-end control vacuous in exactly the way a real coverage
 * gap would look. The log line is the one that would say so in production too.
 */
const PAIRS = readFileSync(join(DIR, 'dexscreener-pairs-for-gecko-page.json'), 'utf8');
const GOPLUS = readFileSync(join(DIR, 'goplus-solana-token-security.json'), 'utf8');

const ok = (body: string): Fetched => ({ ok: true, body, status: 200 });
const fail = (reason: string): Fetched => ({ ok: false, status: null, reason });

/** Counts every call and answers from a script, so the rate claims are assertions not comments. */
class StubClient {
  gecko = 0;
  screener = 0;
  goplus = 0;
  goplusFor: string[] = [];
  geckoAnswer: Fetched = ok(POOLS);
  screenerAnswer: Fetched = ok(PAIRS);
  goplusAnswer: Fetched = ok(GOPLUS);

  geckoTerminal(): Promise<Fetched> {
    this.gecko += 1;
    return Promise.resolve(this.geckoAnswer);
  }

  dexScreener(): Promise<Fetched> {
    this.screener += 1;
    return Promise.resolve(this.screenerAnswer);
  }

  goPlus(_network: string, address: string): Promise<Fetched> {
    this.goplus += 1;
    this.goplusFor.push(address);
    return Promise.resolve(this.goplusAnswer);
  }
}

const serviceWith = (db: PgDatabase, stub: StubClient) =>
  new DexService(db, stub as unknown as DexClient);

const T0 = Date.UTC(2026, 9, 12, 22, 0, 0);

maybeDescribe('IB-028 the DEX collector loop', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_dexsvc', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date('2026-10-01Z'), new Date('2026-12-01Z'));
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const counts = async () => {
    const [{ pools }] = await db.query<{ pools: string }>(`select count(*) pools from dex_pools`, []);
    const [{ pairs }] = await db.query<{ pairs: string }>(`select count(*) pairs from dex_pair_snapshots`, []);
    const [{ tokens }] = await db.query<{ tokens: string }>(`select count(*) tokens from dex_tokens`, []);
    const [{ sec }] = await db.query<{ sec: string }>(`select count(*) sec from dex_token_security`, []);
    return { pools: Number(pools), pairs: Number(pairs), tokens: Number(tokens), sec: Number(sec) };
  };

  it('one tick collects pools, pairs and tokens — the positive control', async () => {
    const stub = new StubClient();
    await serviceWith(db, stub).tick(T0);
    const after = await counts();
    expect(stub.gecko).toBe(1);
    expect(stub.screener).toBe(1); // ONE batched call for the whole page, not one per pool
    expect(after.pools).toBe(20);
    expect(after.pairs).toBe(20); // every pool of the page: the fixtures are the same page
    expect(after.tokens).toBeGreaterThan(0);
    // and the first tick already asks GoPlus, because first sight is offset 0
    expect(stub.goplus).toBe(1);
  });

  it('does NOT make a second GeckoTerminal call inside the measured spacing', async () => {
    // the burst limit is the reason: eight calls fired together take a 429 on the fourth
    const stub = new StubClient();
    const service = serviceWith(db, stub);
    await service.tick(T0);
    await service.tick(T0 + 1_000);
    await service.tick(T0 + CALL_SPACING_MS - 1);
    expect(stub.gecko).toBe(1);
    await service.tick(T0 + CALL_SPACING_MS);
    expect(stub.gecko).toBe(2);
  });

  it('asks GoPlus about at most ONE token per tick, however big the backlog', async () => {
    const stub = new StubClient();
    const service = serviceWith(db, stub);
    // 20 pools arrived in the first test, so the backlog is far larger than one
    for (let i = 0; i < 3; i += 1) await service.tick(T0 + i * 1_000);
    expect(stub.goplus).toBe(3);
    expect(new Set(stub.goplusFor).size).toBe(3); // three different tokens, not the same one thrice
  });

  it('a FAILED GoPlus ask leaves the token due, and the next tick tries it again', async () => {
    const stub = new StubClient();
    stub.goplusAnswer = fail('timeout after 20000 ms');
    const service = serviceWith(db, stub);
    await service.tick(T0 + 10_000);
    const asked = stub.goplusFor[0];

    const [row] = await db.query<{ answered: boolean; failure_reason: string; attempts: number }>(
      `select s.answered, s.failure_reason, s.attempts
         from dex_token_security s join dex_tokens t using (token_id)
        where t.address = $1`, [asked],
    );
    expect(row.answered).toBe(false);
    expect(row.failure_reason).toContain('timeout');

    // the row EXISTS and the token is STILL asked about: the loop keys on `answered`
    stub.goplusAnswer = ok(GOPLUS);
    await service.tick(T0 + 20_000);
    expect(stub.goplusFor).toContain(asked);
    const [after] = await db.query<{ answered: boolean }>(
      `select s.answered from dex_token_security s join dex_tokens t using (token_id)
        where t.address = $1`, [asked],
    );
    expect(after.answered).toBe(true);
  });

  it('an answer with NO DATA for the token still counts as asked — it must not loop', async () => {
    const stub = new StubClient();
    stub.goplusAnswer = ok(JSON.stringify({ code: 1, message: 'OK', result: {} }));
    const service = serviceWith(db, stub);
    await service.tick(T0 + 30_000);
    const asked = stub.goplusFor[0];
    const [row] = await db.query<{ answered: boolean; mintable: boolean | null }>(
      `select s.answered, s.mintable from dex_token_security s join dex_tokens t using (token_id)
        where t.address = $1`, [asked],
    );
    expect(row.answered).toBe(true);   // the venue answered
    expect(row.mintable).toBeNull();   // it just said nothing about this token

    // the loop control: the SAME token is not asked again
    for (let i = 0; i < 4; i += 1) await service.tick(T0 + 40_000 + i * 1_000);
    expect(stub.goplusFor.filter((a) => a === asked)).toHaveLength(1);
  });

  it('an unmappable 200 is recorded as a FAILURE, not as an empty answer', async () => {
    const stub = new StubClient();
    stub.goplusAnswer = ok('{not json');
    const service = serviceWith(db, stub);
    await service.tick(T0 + 60_000);
    const asked = stub.goplusFor[0];
    const [row] = await db.query<{ answered: boolean; failure_reason: string }>(
      `select s.answered, s.failure_reason from dex_token_security s join dex_tokens t using (token_id)
        where t.address = $1`, [asked],
    );
    expect(row.answered).toBe(false);
    expect(row.failure_reason).not.toBeNull();
  });

  it('a GeckoTerminal failure writes nothing and does not stop the security checks', async () => {
    const stub = new StubClient();
    stub.geckoAnswer = fail('HTTP 429');
    const before = await counts();
    await serviceWith(db, stub).tick(T0 + 10 * CALL_SPACING_MS);
    const after = await counts();
    expect(after.pools).toBe(before.pools);
    expect(stub.screener).toBe(0); // no page means no addresses to batch — not an empty batch call
    expect(stub.goplus).toBe(1);   // the GoPlus queue is independent of GeckoTerminal being up
  });

  it('a DexScreener failure keeps the GeckoTerminal snapshot — one venue down is not a lost cycle', async () => {
    const stub = new StubClient();
    stub.screenerAnswer = fail('HTTP 500');
    const before = await counts();
    await serviceWith(db, stub).tick(T0 + 20 * CALL_SPACING_MS);
    const after = await counts();
    expect(after.pools).toBeGreaterThan(before.pools); // the pools of this pass are still stored
    expect(after.pairs).toBe(before.pairs);
  });
});
