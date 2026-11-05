/**
 * IB-144 (architecture/oi-divergence-design-2026-11-04.md V47) — the hidden-send guard, run on the box with the
 * deployed image after the hidden dry run:
 *
 *   docker exec insight-bot-insight-bot-1 node dist/alerts/oi-divergence/backfill/hidden-guard.cli.js --dump /tmp/ib144-dry.jsonl
 *   docker exec insight-bot-insight-bot-1 node dist/alerts/oi-divergence/backfill/hidden-guard.cli.js --dump /tmp/ib144-dry.jsonl --enable
 *
 * Reads the dump `backfill.cli.js --dry-run --kinds hidden --dump …` wrote, the journal's backfill regular rows, the
 * number of `oi_alerts` users and today's switches; prints the per-TF PASS / FAIL table (`hidden-guard.ts`) and, with
 * `--json <file>`, the whole verdict with every violation. **Without `--enable` it changes nothing.**
 *
 * `--enable`: ONE guarded statement — in a transaction, `sendHidden = true` only on the TFs that passed, only where
 * it is still `false`, and only while exactly one user has `oi_alerts` (re-counted inside the statement). It prints
 * what the row says afterwards. `updated_by` / `updated_at` are left alone: they name the last PERSON (as 032 / 033).
 * Exit 0 when the guard ran (whatever it decided), 1 on a failure.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { OI_DIVERGENCE_TFS, OiDivergenceParamsSchema, type OiDivergenceTf } from '@trade-automation/contracts';
import { validateEnv } from '../../../config/env.schema';
import { PgDatabase } from '../../../db/pg/pg-database';
import { PgBackfillReads } from '../pg/backfill-reads';
import { evaluateGuard, verdictTable, type GuardVerdict } from './hidden-guard';
import type { Detection, HiddenDetection, KindCounts } from './history-backfill';

// eslint-disable-next-line no-console
const say = (line: string): void => console.log(line);

/** The dump: hidden lines with context, one summary line (the last). */
export function readDump(text: string): { hidden: HiddenDetection[]; detections: Detection[]; kinds: KindCounts[]; mode: string } {
  const hidden: HiddenDetection[] = [];
  let summary: { detections: Detection[]; kinds: KindCounts[]; mode: string } | null = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const o = JSON.parse(line) as { type: string } & Record<string, unknown>;
    if (o.type === 'hidden') hidden.push(o as unknown as HiddenDetection);
    else if (o.type === 'summary') summary = o as unknown as { detections: Detection[]; kinds: KindCounts[]; mode: string };
  }
  if (summary === null) throw new Error('the dump has no summary line: the run did not finish');
  return { hidden, detections: summary.detections, kinds: summary.kinds, mode: summary.mode };
}

async function main(argv: string[]): Promise<void> {
  const i = argv.indexOf('--dump');
  const file = i >= 0 ? argv[i + 1] : undefined;
  if (!file) throw new Error('usage: hidden-guard.cli.js --dump <file.jsonl> [--json <out.json>] [--enable]');
  const j = argv.indexOf('--json');
  const jsonOut = j >= 0 ? argv[j + 1] : undefined;
  const enable = argv.includes('--enable');
  const dump = readDump(readFileSync(file, 'utf8'));
  if (dump.mode !== 'dry-run') say(`note: the dump is from a ${dump.mode} run (V47 evaluates the dry run's)`);

  const env = validateEnv(process.env as Record<string, unknown>);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new PgDatabase(env.DATABASE_URL);
  try {
    const journal = await new PgBackfillReads(db).backfillAlertKeys();
    const [{ n }] = await db.query<{ n: string | number }>('select count(*) as n from users where oi_alerts', []);
    const [row] = await db.query<{ params: unknown }>('select params from alert_settings where id = 1', []);
    const params = OiDivergenceParamsSchema.parse(row?.params);
    const sendHidden = Object.fromEntries(OI_DIVERGENCE_TFS.map((tf) => [tf, params.perTf[tf].sendHidden])) as Record<OiDivergenceTf, boolean>;
    const verdict: GuardVerdict = evaluateGuard({
      hidden: dump.hidden, detections: dump.detections, kinds: dump.kinds,
      journalRegular: journal.filter((r) => r.kind === 'regular'), oiAlertUsers: Number(n), sendHidden,
    });
    for (const line of verdictTable(verdict)) say(line);
    for (const v of verdict.perTf) {
      for (const x of v.sanity.violations.slice(0, 10)) say(`  ${v.tf} violation ${x.check} ${x.key}: ${x.detail}`);
      if (v.regularUnchanged.missing.length + v.regularUnchanged.extra.length > 0) {
        say(`  ${v.tf} regular: in the journal, not the dry run ${JSON.stringify(v.regularUnchanged.missing.slice(0, 10))}; in the dry run, not the journal ${JSON.stringify(v.regularUnchanged.extra.slice(0, 10))}`);
      }
    }
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify(verdict, null, 2));
    if (!enable) { say('no --enable: nothing changed'); return; }
    if (verdict.enable.length === 0) { say('--enable: no TF to switch on; nothing changed'); return; }
    const after = await db.transaction(async (tx) => {
      const rows = await tx.query<{ params: unknown }>(
        `update alert_settings
            set params = jsonb_set(params, '{perTf}', (
                  select jsonb_object_agg(e.tf, case when e.tf = any($1::text[]) and e.v -> 'sendHidden' = 'false'::jsonb
                                                     then jsonb_set(e.v, '{sendHidden}', 'true'::jsonb) else e.v end)
                    from jsonb_each(params -> 'perTf') as e(tf, v)))
          where id = 1 and (select count(*) from users where oi_alerts) = 1
        returning params`, [verdict.enable]);
      return rows[0]?.params ?? null;
    });
    if (after === null) { say('--enable: refused inside the statement (oi_alerts users ≠ 1); nothing changed'); return; }
    const p = OiDivergenceParamsSchema.parse(after);
    say(`--enable: sendHidden now ${OI_DIVERGENCE_TFS.map((tf) => `${tf}=${p.perTf[tf].sendHidden}`).join(', ')}`);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`hidden guard failed: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
