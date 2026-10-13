import { PgDatabase } from '../db/pg/pg-database';
import { dexFieldPresenceByDay } from '../db/pg/dex-store';
import { ALL_GOPLUS_FIELDS, BASELINE_DAYS_REQUIRED, baselineProgress } from '../web/dex-field-presence';

/**
 * IB-028 — everything a DEX collection run concluded, in one output, **before the database that
 * holds it is made unusable**.
 *
 * ## Why this is a script and not a checklist item
 *
 * Renumbering this task's migration — which the merge-time numbering rule requires, and which the
 * uniqueness guard forces on the next rebase — invalidates any database that applied the old
 * number: postgrator stores an md5 of the FILE and refuses the **whole chain** on a mismatch. The
 * only way to make that slot boot again is to drop the tables and re-migrate, which destroys the
 * run's data.
 *
 * Two rules, each correct on its own, that collide whenever a migrated database has a measurement
 * in flight on it. So the sequence is: **run finishes -> extract -> renumber -> merge -> drop and
 * re-migrate the slot when it next needs to boot.**
 *
 * Step two is the one that is easy to skip **because nothing fails if you do**. That is exactly the
 * kind of step that should be one command rather than a line in a document somebody has to
 * remember to read:
 *
 *   DATABASE_URL=postgres://localhost:5432/insight_dev3 \
 *     npx ts-node -P tsconfig.json src/ops/dex-run-summary.cli.ts \
 *     > ~/.claude/jobs/0028abca/tmp/reports/dev-3-IB-028-run-findings.txt
 *
 * Read-only, and exits 0 on a completed run whatever it finds: the exit code reports the job, not
 * the findings.
 */
const DEFAULT_DAYS = 3;

interface NetworkRow { network: string; rows: string; distinct: string; first: string; last: string }

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  const days = Number(process.argv[2] ?? DEFAULT_DAYS);
  const now = Date.now();
  const db = new PgDatabase(url);
  const say = (line: string): void => {
    // eslint-disable-next-line no-console
    console.log(line);
  };

  try {
    say(`# IB-028 run findings — extracted ${new Date(now).toISOString()}, window ${days} day(s)`);

    for (const [label, table] of [['dex_pools', 'dex_pools'], ['dex_pair_snapshots', 'dex_pair_snapshots']] as const) {
      const rows = await db.query<NetworkRow>(
        `select network,
                count(*)::text as rows,
                count(distinct pool_id)::text as distinct,
                to_char(min(observed_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as first,
                to_char(max(observed_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as last
           from ${table}
          where observed_at >= $1
          group by 1 order by 1`,
        [new Date(now - days * 86_400_000)],
      );
      say(`\n## ${label} (UTC)`);
      say('network  observations  distinct pools  first             last');
      for (const r of rows) {
        say([r.network.padEnd(8), r.rows.padEnd(13), r.distinct.padEnd(15), r.first, r.last].join(' '));
      }
      if (rows.length === 0) say('(nothing in the window — not the same fact as a venue returning nothing)');
    }

    const [{ tokens }] = await db.query<{ tokens: string }>('select count(*)::text as tokens from dex_tokens', []);
    say(`\n## tokens seen: ${tokens}`);

    const security = await db.query<{ answered: boolean; stage: string; n: string; abandoned: string }>(
      `select s.answered, s.at_stage as stage, count(*)::text as n,
              count(*) filter (where not s.answered and s.attempts >= 5)::text as abandoned
         from dex_token_security s
        where s.checked_at >= $1
        group by 1, 2 order by 2, 1`,
      [new Date(now - days * 86_400_000)],
    );
    say('\n## security asks — the fourth state, in the field');
    say('answered  stage        rows   abandoned');
    for (const r of security) {
      say([String(r.answered).padEnd(9), r.stage.padEnd(12), r.n.padEnd(6), r.abandoned].join(' '));
    }
    say('A failed ask is answered=false; abandoned counts those that reached the attempt cap.');

    const absent = await db.query<{ chain_family: string; absent_fields: string[]; n: string }>(
      `select chain_family, absent_fields, count(*)::text as n
         from dex_token_security
        where answered and absent_fields <> '{}' and checked_at >= $1
        group by 1, 2 order by 3 desc`,
      [new Date(now - days * 86_400_000)],
    );
    say('\n## fields the venue said nothing about (recorded, not lost)');
    if (absent.length === 0) say('(none in the window)');
    for (const r of absent) say(`${r.chain_family.padEnd(7)} {${r.absent_fields.join(',')}} x ${r.n}`);

    const byDay = await dexFieldPresenceByDay(db, ALL_GOPLUS_FIELDS, new Date(now - days * 86_400_000));
    say('\n## field presence per UTC day');
    say('day        family  field                      present/answered');
    for (const r of byDay) {
      say([r.day, r.chainFamily.padEnd(7), r.field.padEnd(26), `${r.present}/${r.answered}`].join(' '));
    }

    say(`\n## baseline progress (${BASELINE_DAYS_REQUIRED} days per field would justify an alarm)`);
    for (const p of baselineProgress(byDay)) {
      const floor = p.floor === null ? '—' : `${Math.round(p.floor * 100)}%`;
      say(`${`${p.chainFamily}:${p.field}`.padEnd(34)} floor ${floor.padEnd(5)} ${p.days}/${BASELINE_DAYS_REQUIRED} ${p.ready ? 'READY' : 'accumulating'}`);
    }

    say(
      '\nThese numbers are the run\'s conclusions and now survive independently of the database. '
      + 'Renumbering the migration makes that slot unbootable until it is dropped and re-migrated, '
      + 'so this output is taken BEFORE the renumber, not after someone discovers they needed it.',
    );
  } finally {
    await db.end();
  }
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`dex-run-summary failed — ${(error as Error).message}`);
  process.exit(1);
});
