/**
 * IB-012 — the historical backfill job (design §5):
 *
 *   npm run backfill -- --symbols BTCUSDT,ETHUSDT,SOLUSDT [--from 2024-01] [--force] [--out results/coverage.md]
 *
 * Defaults to the universe's `signal_set`, and to each symbol's `listed_perp` as the start —
 * which is what the archive can actually serve, not when the contract was created.
 *
 * Like the gap-report CLI, this boots config + database only: booting `AppModule` would open
 * every venue socket and start a second set of collectors writing into the same tables.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { DbModule } from '../db/db.module';
import { DB, type Db } from '../db/db.port';
import { PartitionMaintenanceService } from '../db/partitions.service';
import { monthOf } from './calendar-range';
import { renderCoverageMarkdown, type SeriesCoverage } from './coverage';
import { BackfillRunner, type SymbolPlan } from './backfill.runner';

@Module({ imports: [AppConfigModule, DbModule], providers: [PartitionMaintenanceService] })
class BackfillCliModule {}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(BackfillCliModule, { logger: ['log', 'warn', 'error'] });
  try {
    const config = app.get(AppConfigService);
    const db = app.get<Db | null>(DB);
    if (!db) {
      console.error('DATABASE_URL is not set — the backfill has nowhere to write.');
      process.exit(2);
    }

    const requested = (arg('symbols') ?? config.signalSet.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
    const from = arg('from');
    const out = arg('out') ?? 'results/coverage.md';
    const force = process.argv.includes('--force');

    const plans: SymbolPlan[] = [];
    for (const id of requested) {
      const symbol = config.symbols.find((s) => s.id === id);
      if (!symbol) {
        console.error(`'${id}' is not in config/universe.yaml — refusing to guess its listing date.`);
        process.exit(2);
      }
      const listed = monthOf(symbol.listed_perp);
      plans.push({
        symbol: symbol.binance_perp,
        perpFrom: from ?? listed,
        spotFrom: symbol.binance_spot ? (from ?? listed) : null,
        fundingFrom: from ?? listed,
        bybitLinear: symbol.bybit_linear ?? null,
        okxSwap: symbol.okx_swap ?? null,
      });
    }

    const runner = new BackfillRunner({
      db,
      partitions: app.get(PartitionMaintenanceService),
      force,
      fetchImpl: ((url, init) => fetch(url, init)) as never,
      logger: { log: (m) => console.log(m), warn: (m) => console.warn(m) },
    });

    const started = Date.now();
    const coverage: SeriesCoverage[] = [];
    for (const plan of plans) {
      console.log(`\n=== ${plan.symbol} from ${plan.perpFrom} ===`);
      coverage.push(...(await runner.runSymbol(plan)));
    }

    const markdown = renderCoverageMarkdown(coverage, new Date());
    const path = resolve(process.cwd(), out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${markdown}\n`);

    const holes = coverage.filter((c) => !c.complete);
    console.log(`\n${coverage.length} series in ${Math.round((Date.now() - started) / 1000)} s — ${holes.length} with real holes.`);
    console.log(`coverage written to ${path}`);
    for (const hole of holes) console.log(`  hole: ${hole.symbol}/${hole.series} — months ${hole.missingMonths.join(', ')}`);

    // A finished run exits 0 even when the coverage report lists holes: the exit code says
    // whether the JOB worked, and a cron or systemd unit acts on it. Conflating "I ran and found
    // gaps" with "I failed" gets a 20-million-row backfill rerun for nothing. `--fail-on-holes`
    // is for a CI job that genuinely wants coverage to gate the build.
    process.exitCode = holes.length > 0 && process.argv.includes('--fail-on-holes') ? 1 : 0;
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
