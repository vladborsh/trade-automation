import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OkxCollector, writeOkxDrain } from '../../src/collectors/okx/okx-collector';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { contractSpecs } from '../../src/venues/okx/contract-size';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-BUG-015 against a real Postgres, because the refusal IS Postgres's: `ON CONFLICT DO UPDATE
 * command cannot affect row a second time` is raised by the server for a statement that names one
 * key twice, and a fake would only re-assert what I believe the server does. On master (before the
 * fix) the first test fails with exactly that message — the line the coordinator saw 6 times.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('okx-flush.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const BTC = 'BTC-USDT-SWAP';
const MINUTE = Date.UTC(2026, 10, 3, 8, 0, 1);
const SETTLED = Date.UTC(2026, 10, 3, 8);

maybeDescribe('IB-BUG-015 OKX drain → real writers', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let writers: { markFunding: BatchWriter<t.MarkFundingRow>; liquidations: BatchWriter<t.LiquidationRow>; fundingSettlements: BatchWriter<t.FundingSettlementRow> };

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
    await new PartitionMaintenanceService(db).ensureRange(new Date(SETTLED - 86_400_000), new Date(SETTLED + 86_400_000));
    writers = {
      markFunding: new BatchWriter(db, t.MARK_FUNDING_1M, t.markFundingTuple),
      liquidations: new BatchWriter(db, t.LIQUIDATIONS, t.liquidationTuple),
      fundingSettlements: new BatchWriter(db, t.FUNDING_SETTLEMENTS, t.fundingSettlementTuple),
    };
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const collector = () => new OkxCollector({
    instIds: [BTC], signalSetInstIds: [BTC],
    contractSpecs: contractSpecs([{ instId: BTC, ctVal: '0.01', ctValCcy: 'BTC', ctMult: '1' }]),
  });
  const settledPush = (rate: string, ts: number) => ({
    instId: BTC, instType: 'SWAP', fundingRate: '0.0001', fundingTime: String(SETTLED + 8 * 3_600_000),
    nextFundingRate: '', nextFundingTime: String(SETTLED + 16 * 3_600_000),
    prevFundingTime: String(SETTLED), settFundingRate: rate, settState: 'settled', ts: String(ts),
  });

  it('two pushes of the same settlement in one drain write one row, the later one, and refuse nothing', async () => {
    const c = collector();
    c.acceptFundingRate(settledPush('0.00010', MINUTE));
    c.acceptFundingRate(settledPush('0.00012', MINUTE + 500));
    c.acceptLiquidation({
      instType: 'SWAP', instId: BTC,
      details: [{ bkLoss: '0', bkPx: '90000', ccy: '', posSide: 'long', side: 'sell', sz: '3', ts: String(MINUTE) }],
    });

    const failures = await writeOkxDrain(c.drain(), writers);

    expect(failures).toEqual([]);
    const settlements = await db.query<{ rate: string }>(
      `select rate::text from funding_settlements where venue = 'okx' and symbol = $1 and funding_time = $2`, [BTC, new Date(SETTLED)]);
    expect(settlements.map((r) => Number(r.rate))).toEqual([0.00012]);
    const liqs = await db.query<{ n: string }>(`select count(*)::text as n from liquidations where venue = 'okx' and symbol = $1`, [BTC]);
    expect(liqs[0].n).toBe('1');
  });

  it('a table Postgres refuses still lets the liquidations of the same drain land', async () => {
    await db.query(`delete from liquidations where venue = 'okx'`);
    const c = collector();
    c.acceptMarkPrice({ instId: BTC, instType: 'SWAP', markPx: '90000', ts: String(MINUTE) });
    c.sampleMinute(new Date(SETTLED + 60_000));
    c.acceptLiquidation({
      instType: 'SWAP', instId: BTC,
      details: [{ bkLoss: '0', bkPx: '90100', ccy: '', posSide: 'short', side: 'buy', sz: '2', ts: String(MINUTE + 1_000) }],
    });
    // a real refusal from the server, not a stub: this writer targets a table that does not exist
    const broken = new BatchWriter<t.MarkFundingRow>(db, { ...t.MARK_FUNDING_1M, table: 'mark_funding_missing' }, t.markFundingTuple);

    const failures = await writeOkxDrain(c.drain(), { ...writers, markFunding: broken });

    expect(failures).toEqual([expect.objectContaining({ table: 'mark_funding_1m', rows: 1 })]);
    expect(failures[0].message).toMatch(/^mark_funding_missing: write of 1 of 1 row\(s\) failed: relation "mark_funding_missing" does not exist/);
    const liqs = await db.query<{ n: string }>(`select count(*)::text as n from liquidations where venue = 'okx' and symbol = $1`, [BTC]);
    expect(liqs[0].n).toBe('1');
  });
});
