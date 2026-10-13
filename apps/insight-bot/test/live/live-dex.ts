/** IB-028 live pass: the real three APIs, all four networks, into insight_dev3. */
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DexService, TICK_MS } from '../../src/dex/dex.service';

const url = process.env.DATABASE_URL as string;
const minutes = Number(process.env.LIVE_MINUTES ?? '25');

async function main(): Promise<void> {
  await runMigrations({ connectionString: url });
  const db = new PgDatabase(url);
  await new PartitionMaintenanceService(db).ensureRange(new Date('2026-10-01Z'), new Date('2026-12-01Z'));
  const service = new DexService(db);
  const until = Date.now() + minutes * 60_000;
  // drive tick() directly rather than onApplicationBootstrap, so the run ends on its own
  while (Date.now() < until) {
    await service.tick();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  await db.end();
  console.log('live pass finished');
}

void main().catch((e) => { console.error(e); process.exit(1); });
