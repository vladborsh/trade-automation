import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OkxCollector, writeOkxDrain } from '../../src/collectors/okx/okx-collector';
import type { OkxLiquidation } from '../../src/collectors/okx/payloads';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { contractSpecs } from '../../src/venues/okx/contract-size';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-015 against a real Postgres, because the refusals are Postgres's. Since WD-010 the OKX
 * drain carries liquidations only (the funding table whose repeated key caused the bug is no longer
 * written); what must survive is: a repeated liquidation in one drain is harmless (the table is
 * `ON CONFLICT DO NOTHING`), and a refused write comes back as a named failure instead of a throw,
 * so the service logs it and the next drain still lands.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('okx-flush.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const BTC = 'BTC-USDT-SWAP';
const MINUTE = Date.UTC(2026, 10, 3, 8, 0, 1);
const DAY = Date.UTC(2026, 10, 3);

maybeDescribe('IB-BUG-015 OKX drain → real writers (WD-010: liquidations only)', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let writers: { liquidations: BatchWriter<t.LiquidationRow> };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_okxflush', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(DAY - 86_400_000), new Date(DAY + 2 * 86_400_000));
    writers = { liquidations: new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple) };
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const collector = () => new OkxCollector({
    instIds: [BTC],
    contractSpecs: contractSpecs([{ instId: BTC, ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1' }]),
  });
  const push = (sz: string, ts: number): OkxLiquidation => ({
    instType: 'SWAP', instId: BTC,
    details: [{ bkLoss: '0', bkPx: '90000', ccy: '', posSide: 'long', side: 'sell', sz, ts: String(ts) }],
  });
  const count = async () =>
    (await db.query<{ n: string }>(`select count(*)::text as n from liquidations where venue = 'okx' and symbol = $1`, [BTC]))[0].n;

  it('the same liquidation pushed twice in one drain lands once, and nothing is refused', async () => {
    const c = collector();
    c.acceptLiquidation(push('3', MINUTE));
    c.acceptLiquidation(push('3', MINUTE)); // the venue re-sending an event
    c.acceptLiquidation(push('1', MINUTE + 1_000));
    expect(await writeOkxDrain(c.drain(), writers)).toEqual([]);
    expect(await count()).toBe('2');
  });

  it('a write Postgres refuses comes back as a named failure, not a throw — and the next drain still lands', async () => {
    await db.query(`delete from liquidations where venue = 'okx'`);
    const c = collector();
    c.acceptLiquidation(push('2', MINUTE + 2_000));
    // a real refusal from the server, not a stub: this writer targets a table that does not exist
    const broken = new BatchWriter<t.LiquidationRow>(db, { ...t.LIQUIDATIONS, table: 'liquidations_missing' }, t.liquidationTuple);

    const failures = await writeOkxDrain(c.drain(), { liquidations: broken });
    expect(failures).toEqual([expect.objectContaining({ table: 'liquidations', rows: 1 })]);
    expect(failures[0].message).toMatch(/^liquidations_missing: write of 1 of 1 row\(s\) failed: relation "liquidations_missing" does not exist/);

    c.acceptLiquidation(push('4', MINUTE + 3_000));
    expect(await writeOkxDrain(c.drain(), writers)).toEqual([]);
    expect(await count()).toBe('1');
  });
});
