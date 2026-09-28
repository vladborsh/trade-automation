/**
 * IB-011 — re-run the daily gap report for one UTC day, outside the scheduler:
 *
 *   npm run report --workspace=@trade-automation/insight-bot -- --day 2026-09-27
 *
 * Why it exists: the report is the stage-0 evidence, and a day sometimes needs re-building —
 * after a backfill repaired it, or when the box was down at 00:10. It writes the same
 * `gap_reports` row and prints the same text, so the Tester's fourteen days can be rebuilt
 * from stored data rather than re-lived.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BinanceWeightTracker } from '../collectors/binance-perp/binance-weight.tracker';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { GapReportService } from './gap-report.service';
import { renderGapReport } from './gap-report';
import { TelegramSender } from './telegram-sender';

/**
 * Deliberately NOT `AppModule`: booting that here would open every venue socket and start a
 * second set of collectors writing into the same database. The report only needs config, the
 * database and the sender.
 */
@Module({
  imports: [AppConfigModule, DbModule],
  providers: [TelegramSender, BinanceWeightTracker, GapReportService],
})
class ReportCliModule {}

async function main(): Promise<void> {
  const index = process.argv.indexOf('--day');
  const day = index === -1 ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) : process.argv[index + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) {
    console.error('usage: npm run report -- --day YYYY-MM-DD');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(ReportCliModule, { logger: ['warn', 'error'] });
  try {
    const report = await app.get(GapReportService).runForDay(day);
    if (!report) {
      console.error('no report: is DATABASE_URL set?');
      process.exit(1);
    }
    console.log(renderGapReport(report));
    console.log(`\nclean=${report.clean}`);
  } finally {
    await app.close();
  }
}

void main();
