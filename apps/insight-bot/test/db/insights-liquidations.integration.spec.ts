import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { R1 } from '../../src/insights/rules';
import { isRefusal, type InsightSnapshot } from '../../src/insights/types';
import { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';
import { stubClassifier } from '../web/liquidations-test-classifier';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-086 — the liquidation rules see CRYPTO only, through the real read path (IB-084's class keys
 * against Postgres): a TradFi-only spike must leave R1 silent, the same spike on BTC must not.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('insights-liquidations.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const H = 3_600_000;
const NOW = Date.UTC(2026, 5, 20, 12);
const universe = (['BTC', 'XAU'] as const).map((base) => ({
  id: `${base}USDT`, base, asset_class: base === 'XAU' ? 'tradfi' as const : 'crypto' as const, quote: 'USDT',
  binance_perp: `${base}USDT`, bybit_linear: `${base}USDT`, listed_perp: '2020-01-01',
}));

maybeDescribe('IB-086 liquidation rules on the crypto-only read path', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  const liq = () => new BatchWriter<t.LiquidationRow>(db, t.LIQUIDATIONS, t.liquidationTuple);
  const r1 = async () => {
    const svc = new LiquidationsOverviewService(db, stubClassifier(universe), () => NOW);
    const m = await svc.marketSamples('24h');
    const snap = { period: '24h', nowMs: NOW, liquidations: { ...m, coins: new Map(), large: [], bars: [] }, positioning: null, positioningSeries: null, breadth: null, fng: null, flows: null } as InsightSnapshot;
    const out = R1.run(snap);
    return out && !isRefusal(out) && out.rarity >= 0.9 ? out : null;
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_insliq', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 40 * 24 * H), new Date(NOW + H));
    // 20 days of ordinary crypto: one $1 000 BTC long an hour
    const rows: t.LiquidationRow[] = [];
    for (let h = 20 * 24; h >= 1; h--) rows.push({ venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(NOW - h * H + 60_000), side: 'long', price: 1, qty: 1000, notional: 1000, source: 'ws' });
    // today: a $50M GOLD spike
    rows.push({ venue: 'bybit', symbol: 'XAUUSDT', ts: new Date(NOW - 2 * H), side: 'long', price: 4000, qty: 12_500, notional: 50_000_000, source: 'ws' });
    await liq().write(rows);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a TradFi-only spike: R1 stays silent (crypto was an ordinary day)', async () => {
    expect(await r1()).toBeNull();
  });

  it('the same spike on BTC: R1 speaks', async () => {
    await liq().write([{ venue: 'bybit', symbol: 'BTCUSDT', ts: new Date(NOW - 2 * H + 1), side: 'long', price: 1, qty: 50_000_000, notional: 50_000_000, source: 'ws' }]);
    expect(await r1()).toMatchObject({ key: 'insight.liq_surge', params: { side: 'long' } });
  });
});
