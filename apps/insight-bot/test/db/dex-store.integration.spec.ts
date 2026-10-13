import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { noteToken, tokensDueSecurity, writePools, writeTokenSecurity } from '../../src/db/pg/dex-store';
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

  it('keeps the whole raw response, so an unmodelled field is not lost', async () => {
    const [{ raw }] = await db.query<{ raw: Record<string, unknown> }>(
      `select raw from dex_token_security where token_id = $1 and at_stage = 'h6'`, [TOKEN.tokenId],
    );
    expect(Object.keys(raw).length).toBeGreaterThan(10);
  });
});
