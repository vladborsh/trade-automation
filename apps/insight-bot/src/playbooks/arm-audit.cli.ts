import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  assertSingleComputedMode, canArm, type WebFeatureFrame, type WebFrameTimeframe,
} from '@trade-automation/contracts';
import { AppConfigModule } from '../config/config.module';
import { DB, type Db } from '../db/db.port';
import { DbModule } from '../db/db.module';
import { publishedFramesBetween } from '../features/pg/frames.repo';
import { buildRegistry } from './registry';

/**
 * IB-018 — **why a playbook did not arm, per close, in its own words.**
 *
 * `npm run audit:arming -- --playbook P3 --symbol BTCUSDT --tf 15m --from 2026-10-08 --to 2026-10-13`
 *
 * This is the acceptance artefact for a playbook that cannot arm yet, and that is not a
 * consolation prize: a run of refusals, each naming the key that refused and the reason it gave,
 * demonstrates the engine declining to decide for stated reasons on real data. A screenshot of a
 * trade would demonstrate less, because a trade only shows the path where everything was available.
 *
 * It reads **stored frames**, never raw tables, so it audits exactly what a playbook would have
 * been handed — including the refusals the frame itself recorded.
 *
 * Read-only: it opens no sockets, writes nothing, and takes the registry the runner takes, so a
 * key list that drifts from the playbook's own `armKeys` is not possible.
 */

@Module({ imports: [AppConfigModule, DbModule] })
class ArmAuditCliModule {}

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function parseBound(value: string, what: string): number {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) throw new Error(`--${what} is not a date: ${value}`);
  return ms;
}

/** One key's verdict on one frame: available, or refusing with the frame's own reason. */
export interface KeyVerdict {
  key: string;
  ok: boolean;
  /** The frame's reason, or `absent` when the key is not in the frame at all. */
  why: string | null;
}

/**
 * Why this frame could not arm this playbook — every required key, not just the first failure.
 *
 * Reporting only the first would make the audit a function of key ORDER: a fortnight of
 * `not_recorded` would hide behind an `insufficient_history` that happened to be listed earlier,
 * and the count of reasons — which is the number that says when the playbook can first arm —
 * would be wrong in a way nobody could see.
 */
export function armKeyVerdicts(frame: WebFeatureFrame, armKeys: readonly string[]): KeyVerdict[] {
  return armKeys.map((key) => {
    const value = frame.keys[key];
    if (value === undefined) return { key, ok: false, why: 'absent' };
    return value.ok ? { key, ok: true, why: null } : { key, ok: false, why: value.why };
  });
}

async function main(): Promise<void> {
  const playbookId = arg('playbook', 'P3') as string;
  const symbol = arg('symbol', 'BTCUSDT') as string;
  const tf = (arg('tf', '15m') as string) as WebFrameTimeframe;
  const fromMs = parseBound(arg('from') ?? '', 'from');
  const toMs = parseBound(arg('to') ?? '', 'to');
  const showRows = Number(arg('rows', '10'));

  const playbook = buildRegistry().get(playbookId);
  if (!playbook) throw new Error(`no playbook ${playbookId} in the registry`);

  const app = await NestFactory.createApplicationContext(ArmAuditCliModule, { logger: ['warn', 'error'] });
  const db = app.get<Db>(DB);
  try {
    const all = await publishedFramesBetween(db, tf, fromMs, toMs);
    const frames = all.filter((f) => f.symbol === symbol);
    // The audit must not straddle live and backfilled frames: a backfilled frame saw buckets that
    // derive healed after the close, so its refusals are a LOWER bound on what the live pass
    // refused. Mixing the two would produce a count that is neither.
    assertSingleComputedMode(frames);
    console.log(
      `${playbookId} arming audit — ${symbol} ${tf}, ${new Date(fromMs).toISOString().slice(0, 10)} … ` +
        `${new Date(toMs).toISOString().slice(0, 10)}: ${frames.length} stored frames`,
    );
    console.log(`armKeys: ${playbook.keys.armKeys.join(', ')}`);
    console.log(`computed mode: ${frames[0]?.computedMode ?? 'n/a'} (uniform — assertSingleComputedMode passed)`);

    const reasonCounts = new Map<string, number>();
    let armable = 0;
    const rows: string[] = [];

    for (const frame of frames) {
      const verdicts = armKeyVerdicts(frame, playbook.keys.armKeys);
      const refusing = verdicts.filter((v) => !v.ok);
      if (refusing.length === 0) {
        armable += 1;
        continue;
      }
      for (const v of refusing) {
        const label = `${v.key}: ${v.why}`;
        reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
      }
      if (rows.length < showRows) {
        rows.push(
          `${new Date(frame.closeTime * 1000).toISOString().slice(0, 16)}Z  rev${frame.revision}  ` +
            refusing.map((v) => `${v.key}=${v.why}`).join('  '),
        );
      }
    }

    console.log(`\nframes where every armKey was available: ${armable} of ${frames.length}`);
    console.log(`(canArm agrees: ${frames.filter((f) => canArm(f, [...playbook.keys.armKeys])).length})`);

    console.log(`\nfirst ${rows.length} refusing closes:`);
    for (const row of rows) console.log(`  ${row}`);

    console.log('\nrefusal count by key and reason, across the window:');
    for (const [label, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(5)}  ${label}`);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
