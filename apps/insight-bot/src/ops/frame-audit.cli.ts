import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { DB, type Db } from '../db/db.port';
import { DbModule } from '../db/db.module';
import { HEAL_LOOKBACK_MS } from '../features/input-completeness';
import { expectedFrames } from '../features/frame-coverage';
import { frameCounts } from '../features/pg/frames.repo';
import { FRAME_TIMEFRAMES } from '../features/recheck-schedule';

/**
 * IB-015 — `npm run audit:frames [-- --days 7] [--fail-on-unhealed]`
 *
 * Reports what the coverage page's frame block shows, from a terminal: how many frames each
 * timeframe should hold, how many it holds, and how many still refuse with something chaseable
 * after the heal window has closed.
 *
 * **The exit code reports the JOB, not the findings.** It is 0 whenever the audit ran, even with
 * unhealed frames to report, because a cron that treats "I found something" as "I failed" either
 * gets silenced or gets re-run — and re-running this one re-reads thirty days of frames to
 * produce the same answer. `--fail-on-unhealed` is the opt-in for a caller that genuinely wants
 * to gate on the finding; without it, the finding is output.
 */
@Module({ imports: [AppConfigModule, DbModule] })
class FrameAuditCliModule {}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main(): Promise<void> {
  const daysArg = arg('days');
  const days = daysArg === null ? 7 : Number(daysArg);
  if (!Number.isFinite(days) || days <= 0) throw new Error(`--days must be a positive number: ${daysArg}`);
  const failOnUnhealed = process.argv.includes('--fail-on-unhealed');

  const app = await NestFactory.createApplicationContext(FrameAuditCliModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get<Db | null>(DB);
    if (!db) throw new Error('DATABASE_URL is not set: nothing to audit');

    const now = Date.now();
    const from = now - days * 86_400_000;
    // Past this instant, no heal pass reaches back any further, so an incomplete frame is not
    // young any more. Derived from derive's own lookback rather than restated.
    const healDeadline = now - HEAL_LOOKBACK_MS;

    const rows = await frameCounts(db, from, now, healDeadline);
    let unhealed = 0;

    process.stdout.write(`feature frames, last ${days} day(s), to ${new Date(now).toISOString()}\n\n`);
    for (const tf of FRAME_TIMEFRAMES) {
      const row = rows.find((r) => r.tf === tf);
      const expected = expectedFrames(tf, from, now);
      const written = row?.written ?? 0;
      process.stdout.write(`${tf}\n`);
      process.stdout.write(`  written        ${written} of ${expected} expected\n`);
      process.stdout.write(`  incomplete     ${row?.incomplete ?? 0} (a chaseable refusal)\n`);
      process.stdout.write(`  explained      ${row?.explainedOnly ?? 0} (permanent — nothing to chase)\n`);
      process.stdout.write(`  UNHEALED       ${row?.unhealed ?? 0} (past the heal window)\n`);
      if (row?.oldestUnhealedMs != null) {
        process.stdout.write(`  oldest unhealed ${new Date(row.oldestUnhealedMs).toISOString()}\n`);
      }
      if (written < expected) {
        // Not the same finding as an incomplete frame, and worth its own line: a frame that was
        // never written is invisible to every count of frames (IB-BUG-010 one layer up).
        process.stdout.write(`  MISSING        ${expected - written} frames were never written\n`);
      }
      process.stdout.write('\n');
      unhealed += row?.unhealed ?? 0;
    }

    if (unhealed === 0) process.stdout.write('no unhealed frames.\n');
    if (unhealed > 0 && failOnUnhealed) {
      process.stderr.write(`${unhealed} unhealed frame(s); --fail-on-unhealed was set\n`);
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
