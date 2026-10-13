import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import {
  MAX_SECURITY_ATTEMPTS, noteToken, tokensDueSecurity, writePairSnapshots, writePools,
  writeSecurityFailure, writeTokenSecurity,
} from '../../src/db/pg/dex-store';
import { mapPairs } from '../../src/dex/dexscreener';
import { mapTokenSecurity } from '../../src/dex/goplus';
import { mapPools } from '../../src/dex/mappers';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-028 — the DEX snapshot writes against a real Postgres.
 *
 * **Positive control:** the first test must store rows from the recorded page. A store that writes
 * nothing passes every "does not duplicate" test there is.
 *
 * The claims that need real SQL rather than a fake: that `dex_pools` is append-only across polls,
 * that `noteToken` reports first sight exactly once, and that "not yet asked" is the ABSENCE of a
 * security row — which the schema comment asserts in prose and this asserts in behaviour.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('dex-store.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const POOLS = readFileSync(join(__dirname, '..', 'fixtures', 'dex', 'geckoterminal-new-pools-solana.json'), 'utf8');
const GOPLUS_SOL = readFileSync(join(__dirname, '..', 'fixtures', 'dex', 'goplus-solana-token-security.json'), 'utf8');
const T0 = new Date('2026-10-12T22:00:00Z');

maybeDescribe('IB-028 dex snapshots against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_dex', DATABASE_URL as string);
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

  it('stores a whole page — the positive control', async () => {
    const { rows } = mapPools(POOLS, 'solana', 'new_pools', T0);
    expect(rows).toHaveLength(20);
    expect(await writePools(db, rows)).toBe(20);
  });

  it('keeps a LATER poll as a separate observation, because it is one', async () => {
    // the same pools ten minutes on: different prices, same ids. Append-only is the point — a
    // snapshot history that collapsed repeats would lose the series it exists to be.
    const later = mapPools(POOLS, 'solana', 'new_pools', new Date(T0.getTime() + 600_000));
    expect(await writePools(db, later.rows)).toBe(20);
    const [{ n }] = await db.query<{ n: string }>(`select count(*) n from dex_pools`, []);
    expect(Number(n)).toBe(40);
  });

  it('does not duplicate the SAME observation if a pass is retried', async () => {
    const again = mapPools(POOLS, 'solana', 'new_pools', T0);
    expect(await writePools(db, again.rows)).toBe(0);
  });

  it('records the same pool under both listings, because they are different facts', async () => {
    const trending = mapPools(POOLS, 'solana', 'trending_pools', T0);
    expect(await writePools(db, trending.rows)).toBe(20);
  });

  it('stores DexScreener\'s EVM pairs with the CANONICAL address, not the venue\'s spelling', async () => {
    // the Base fixture is the one that actually contains EIP-55 spellings, so this is the write
    // path where a non-canonical value would have arrived — and the constraint would refuse it
    const body = readFileSync(join(__dirname, '..', 'fixtures', 'dex', 'dexscreener-pairs-base.json'), 'utf8');
    const requested = (JSON.parse(
      readFileSync(join(__dirname, '..', 'fixtures', 'dex', 'dexscreener-requested-base.json'), 'utf8'),
    ) as { requested: string[] }).requested;
    const venueSpellings = (JSON.parse(body).pairs as Array<{ pairAddress: string }>).map((p) => p.pairAddress);
    expect(venueSpellings.some((a) => a !== a.toLowerCase())).toBe(true); // the premise

    const { rows } = mapPairs(body, 'base', requested, T0);
    expect(await writePairSnapshots(db, rows)).toBe(rows.length);
    const stored = await db.query<{ address: string; pool_id: string }>(
      `select address, pool_id from dex_pair_snapshots where network = 'base'`, [],
    );
    expect(stored).toHaveLength(rows.length);
    for (const row of stored) {
      expect(row.address).toBe(row.address.toLowerCase());
      expect(row.pool_id).toBe(row.pool_id.toLowerCase());
    }
  });

  it('stores a null market cap as NULL, end to end', async () => {
    // all 20 carry market_cap_usd: null; a 0 here would be twenty measurements never made
    const [{ n }] = await db.query<{ n: string }>(
      `select count(*) n from dex_pools where market_cap_usd is not null`, [],
    );
    expect(Number(n)).toBe(0);
    const [{ f }] = await db.query<{ f: string }>(
      `select count(*) f from dex_pools where fdv_usd is not null`, [],
    );
    expect(Number(f)).toBeGreaterThan(0); // and the values it DID give are stored
  });
});

maybeDescribe('IB-028 token first sight and the security schedule', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_dextok', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const due = (rows: readonly { tokenId: string }[], tokenId: string) => rows.some((r) => r.tokenId === tokenId);

  const TOKEN = { tokenId: 'solana_abc', network: 'solana', address: 'abc', symbol: 'ABC', name: 'Abc' };

  it('reports first sight exactly once', async () => {
    expect(await noteToken(db, TOKEN, T0)).toBe(true);
    expect(await noteToken(db, TOKEN, new Date(T0.getTime() + 600_000))).toBe(false);
  });

  it('does not move first_seen_at on a later sighting', async () => {
    // it is the instant we became responsible for the token; moving it would erase that
    const [{ first_seen_at }] = await db.query<{ first_seen_at: Date }>(
      `select first_seen_at from dex_tokens where token_id = $1`, [TOKEN.tokenId],
    );
    expect(new Date(first_seen_at).toISOString()).toBe(T0.toISOString());
  });

  it('"not yet asked" is the ABSENCE of a row, so the token is due', async () => {
    const due = await tokensDueSecurity(db, 'h6', new Date(T0.getTime() + 7 * 3_600_000));
    expect(due.map((d) => d.tokenId)).toContain(TOKEN.tokenId);
  });

  it('is NOT due before the stage offset has elapsed', async () => {
    const due = await tokensDueSecurity(db, 'h6', new Date(T0.getTime() + 5 * 3_600_000));
    expect(due).toEqual([]);
  });

  it('stops being due once asked — and an all-null answer still counts as asked', async () => {
    const mapped = mapTokenSecurity(GOPLUS_SOL, 'solana')!;
    await writeTokenSecurity(db, TOKEN.tokenId, 'h6', new Date(T0.getTime() + 7 * 3_600_000), mapped.row);

    const due = await tokensDueSecurity(db, 'h6', new Date(T0.getTime() + 8 * 3_600_000));
    expect(due.map((d) => d.tokenId)).not.toContain(TOKEN.tokenId);

    // the distinction the schema comment makes: asked-and-told-nothing is a ROW with nulls, which
    // must not re-queue the token for ever
    await writeTokenSecurity(db, TOKEN.tokenId, 'h24', new Date(T0.getTime() + 25 * 3_600_000), {
      ...mapped.row, mintable: null, freezable: null, closable: null,
      metadataMutable: null, balanceMutableAuthority: null, totalSupply: null,
    });
    const due24 = await tokensDueSecurity(db, 'h24', new Date(T0.getTime() + 26 * 3_600_000));
    expect(due24.map((d) => d.tokenId)).not.toContain(TOKEN.tokenId);
  });

  /*
   * The FOUR states, as behaviour. The expensive bug here is the infinite re-queue, so each of
   * these would fail LOUDLY if the `answered` key regressed to "a row exists" — and the failure
   * direction is asserted both ways, not just the safe one.
   */
  const T2 = { tokenId: 'solana_fourstate', network: 'solana', address: 'fourstate', symbol: 'FS', name: 'Four State' };

  it('a FAILED ask leaves the token due — the state that "a row exists" would lose', async () => {
    expect(await noteToken(db, T2, T0)).toBe(true);
    const asked = new Date(T0.getTime() + 7 * 3_600_000);
    await writeSecurityFailure(db, T2.tokenId, 'h6', asked, 'solana', 'timeout after 20000 ms');

    // the row EXISTS. If the predicate keyed on existence this would be empty and the token would
    // be permanently unasked — the mirror of the loop, and invisible.
    const [{ n }] = await db.query<{ n: string }>(
      `select count(*) n from dex_token_security where token_id = $1 and at_stage = 'h6'`, [T2.tokenId],
    );
    expect(Number(n)).toBe(1);

    const due = await tokensDueSecurity(db, 'h6', new Date(T0.getTime() + 8 * 3_600_000));
    expect(due.map((d) => d.tokenId)).toContain(T2.tokenId);
  });

  it('records the failure reason rather than an answer with null flags', async () => {
    const [row] = await db.query<{ answered: boolean; failure_reason: string; attempts: number }>(
      `select answered, failure_reason, attempts from dex_token_security
        where token_id = $1 and at_stage = 'h6'`, [T2.tokenId],
    );
    expect(row.answered).toBe(false);
    expect(row.failure_reason).toContain('timeout');
    expect(row.attempts).toBe(1);
  });

  it('counts attempts and ABANDONS the stage, so a never-answerable token stops costing budget', async () => {
    const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
    for (let i = 2; i <= MAX_SECURITY_ATTEMPTS; i += 1) {
      await writeSecurityFailure(db, T2.tokenId, 'h6', at(7 + i), 'solana', 'HTTP 500');
      const stillDue = await tokensDueSecurity(db, 'h6', at(8 + i));
      // due on every attempt UP TO the last — a failure must be retried, it may be a timeout
      expect(due(stillDue, T2.tokenId)).toBe(i < MAX_SECURITY_ATTEMPTS);
    }
    const [row] = await db.query<{ attempts: number; answered: boolean }>(
      `select attempts, answered from dex_token_security where token_id = $1 and at_stage = 'h6'`,
      [T2.tokenId],
    );
    expect(row.attempts).toBe(MAX_SECURITY_ATTEMPTS);
    expect(row.answered).toBe(false); // abandoned is recorded, not inferred from an absence
  });

  it('an answer AFTER failures clears the reason but KEEPS the attempt count', async () => {
    const mapped = mapTokenSecurity(GOPLUS_SOL, 'solana')!;
    await writeTokenSecurity(db, T2.tokenId, 'h6', new Date(T0.getTime() + 20 * 3_600_000), mapped.row);
    const [row] = await db.query<{ answered: boolean; failure_reason: string | null; attempts: number }>(
      `select answered, failure_reason, attempts from dex_token_security
        where token_id = $1 and at_stage = 'h6'`, [T2.tokenId],
    );
    expect(row.answered).toBe(true);
    expect(row.failure_reason).toBeNull();
    // `answered` alone stops the asking, so zeroing the count would buy nothing and erase a
    // measurement: this stage cost five calls, and that is worth knowing when the budget is argued
    expect(row.attempts).toBe(MAX_SECURITY_ATTEMPTS);
    expect(due(await tokensDueSecurity(db, 'h6', new Date(T0.getTime() + 21 * 3_600_000)), T2.tokenId)).toBe(false);
  });

  it('suppression is per STAGE: answering at first sight does not cancel +6 h and +24 h', async () => {
    // three looks is the point of the schedule; a token answered once must still be asked twice more
    const T3 = { tokenId: 'solana_perstage', network: 'solana', address: 'perstage', symbol: 'PS', name: 'Per Stage' };
    expect(await noteToken(db, T3, T0)).toBe(true);
    const mapped = mapTokenSecurity(GOPLUS_SOL, 'solana')!;
    await writeTokenSecurity(db, T3.tokenId, 'first_seen', T0, mapped.row);

    expect(due(await tokensDueSecurity(db, 'first_seen', new Date(T0.getTime() + 60_000)), T3.tokenId)).toBe(false);
    expect(due(await tokensDueSecurity(db, 'h6', new Date(T0.getTime() + 7 * 3_600_000)), T3.tokenId)).toBe(true);
    expect(due(await tokensDueSecurity(db, 'h24', new Date(T0.getTime() + 25 * 3_600_000)), T3.tokenId)).toBe(true);

    // and a FAILURE at one stage does not make another stage due early either
    await writeSecurityFailure(db, T3.tokenId, 'h6', new Date(T0.getTime() + 7 * 3_600_000), 'solana', 'HTTP 429');
    expect(due(await tokensDueSecurity(db, 'h24', new Date(T0.getTime() + 8 * 3_600_000)), T3.tokenId)).toBe(false);
  });

  /*
   * The canonical stored form, as the DATABASE refuses it rather than as a convention.
   *
   * Attempting the forbidden insert is the only way to know the constraint works and not merely
   * that it compiled — and `unique (network, address)` is the reason it matters: an index cannot
   * see case-equivalence, so without the check two spellings of one EVM address would be two
   * tokens, with two first_seen_at instants and two GoPlus budgets.
   */
  it('REFUSES a non-canonical EVM address, so the unique index means what it claims', async () => {
    await expect(noteToken(db, {
      tokenId: 'base_0xAbCd', network: 'base', address: '0xAbCd', symbol: null, name: null,
    }, T0)).rejects.toThrow(/dex_tokens_canonical_address/);
  });

  it('accepts the SAME address lower-cased — the positive control for that refusal', async () => {
    expect(await noteToken(db, {
      tokenId: 'base_0xabcd', network: 'base', address: '0xabcd', symbol: null, name: null,
    }, T0)).toBe(true);
  });

  it('accepts a mixed-case SOLANA address, because base58 case is meaningful', async () => {
    // folding here would merge two different addresses: the exemption is correctness, not laziness
    expect(await noteToken(db, {
      tokenId: 'solana_MiXeDcAsE', network: 'solana', address: 'MiXeDcAsE', symbol: null, name: null,
    }, T0)).toBe(true);
  });

  it('refuses a non-canonical ID even when the address column is canonical', async () => {
    // the id is what joins to dex_token_security, so canonicalising only the address would put the
    // inconsistency back in the column that actually joins
    await expect(noteToken(db, {
      tokenId: 'base_0xEEFF', network: 'base', address: '0xeeff', symbol: null, name: null,
    }, T0)).rejects.toThrow(/dex_tokens_canonical_address/);
  });

  it('stores the fields the venue said nothing about, so drift becomes a query', async () => {
    // if a name starts appearing here for EVERY token, that IS the shape change the earlier hard
    // failure was standing in for — and it is then answerable from stored rows, with no release
    const T4 = { tokenId: 'solana_absent', network: 'solana', address: 'absent', symbol: null, name: null };
    await noteToken(db, T4, T0);
    const mapped = mapTokenSecurity(GOPLUS_SOL, 'solana')!;
    await writeTokenSecurity(db, T4.tokenId, 'first_seen', T0, {
      ...mapped.row, metadataMutable: null, absentFields: ['metadata_mutable'],
    });
    const [row] = await db.query<{ absent_fields: string[]; answered: boolean }>(
      `select absent_fields, answered from dex_token_security where token_id = $1`, [T4.tokenId],
    );
    expect(row.absent_fields).toEqual(['metadata_mutable']);
    expect(row.answered).toBe(true); // an omitted field is an ANSWER, not a failed ask
  });

  it('keeps the whole raw response, so an unmodelled field is not lost', async () => {
    const [{ raw }] = await db.query<{ raw: Record<string, unknown> }>(
      `select raw from dex_token_security where token_id = $1 and at_stage = 'h6'`, [TOKEN.tokenId],
    );
    expect(Object.keys(raw).length).toBeGreaterThan(10);
  });
});
