import { PgDatabase } from '../db/pg/pg-database';
import { dexFieldPresenceByDay } from '../db/pg/dex-store';
import { ALL_GOPLUS_FIELDS, BASELINE_DAYS_REQUIRED, baselineProgress } from '../web/dex-field-presence';
import { FIELD_CONTRACTS, type ChainFamily } from '../dex/goplus';

/**
 * IB-028 — GoPlus field presence per chain family per UTC day, from what is already stored.
 *
 * ## Why this exists rather than an alarm
 *
 * GoPlus's EVM payload has a per-token field set — three distinct shapes measured — so no field is
 * guaranteed and `ALWAYS_PRESENT.evm` is empty. That makes the **rate** the only thing that can ever
 * notice a field disappearing, and a detector whose only consumer is "somebody remembers to look" is
 * not a detector.
 *
 * An alarm needs a threshold, and a threshold needs a baseline. One window is not a baseline. So this
 * prints the series the stored history already contains, so that after enough days
 * *"below this field's own observed floor, over a population of at least N"* is a **measured**
 * threshold rather than a guessed one — the same order imposed on the GeckoTerminal ceiling and on
 * the feature warm-up.
 *
 * **"Enough" is `BASELINE_DAYS_REQUIRED` days per field per family, and this prints how far each
 * one has got.** A deferral with no stated horizon becomes permanent, and a deliberate absence with
 * no removal condition is indistinguishable from an omission six months later — the reader cannot
 * tell whether to act. So the condition is a number, it is measurable, and the output says which
 * fields have met it.
 *
 *   DATABASE_URL=postgres://localhost:5432/insight_dev3 \
 *     npx ts-node -P tsconfig.json src/ops/dex-field-presence.cli.ts [days]
 *
 * Read-only. Exits 0 on a completed run whatever it finds: the exit code reports the job, not the
 * findings, so a cron wrapping this cannot be made to look broken by a venue's shape.
 */
const DEFAULT_DAYS = 14;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }
  const days = Number(process.argv[2] ?? DEFAULT_DAYS);
  // the one clock read, at the entry point, with everything below taking the instant as a value —
  // `clock-threading.spec.ts` allow-lists it as an origin and would fail on a second one
  const now = Date.now();
  const db = new PgDatabase(url);
  try {
    const rows = await dexFieldPresenceByDay(db, ALL_GOPLUS_FIELDS, new Date(now - days * 86_400_000));
    if (rows.length === 0) {
      // not "all fields are missing": nothing has been asked yet, which is a different fact
      // eslint-disable-next-line no-console
      console.log(`no answered security asks in the last ${days} days — nothing to measure yet.`);
      return;
    }

    const classified = new Map<string, string>();
    for (const family of ['solana', 'evm'] as ChainFamily[]) {
      for (const contract of FIELD_CONTRACTS[family]) classified.set(`${family}:${contract.field}`, contract.presence);
    }

    // eslint-disable-next-line no-console
    console.log('day        family  field                      present/answered   rate   declared');
    for (const row of rows) {
      // the read already drops pairs that cannot exist, so a missing classification here would be
      // a real inconsistency rather than an expected cross-join artefact
      const presence = classified.get(`${row.chainFamily}:${row.field}`) ?? '(unclassified!)';
      const rate = row.answered === 0 ? '—' : `${Math.round((row.present / row.answered) * 100)}%`;
      // eslint-disable-next-line no-console
      console.log([
        row.day,
        row.chainFamily.padEnd(7),
        row.field.padEnd(26),
        `${row.present}/${row.answered}`.padEnd(18),
        rate.padEnd(6),
        presence,
      ].join(' '));
    }

    const progress = baselineProgress(rows);
    // eslint-disable-next-line no-console
    console.log(`\nbaseline progress (${BASELINE_DAYS_REQUIRED} days per field would justify an alarm):`);
    for (const row of progress) {
      const floor = row.floor === null ? '—' : `${Math.round(row.floor * 100)}%`;
      // eslint-disable-next-line no-console
      console.log(
        `  ${`${row.chainFamily}:${row.field}`.padEnd(34)} floor ${floor.padEnd(5)} `
        + `${String(row.days).padStart(2)}/${BASELINE_DAYS_REQUIRED} days  ${row.ready ? 'READY' : 'accumulating'}`,
      );
    }

    const ready = progress.filter((p) => p.ready).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n${ready} of ${progress.length} fields have ${BASELINE_DAYS_REQUIRED} days of history. `
      + 'No alarm is wired to these numbers, deliberately — the threshold would be "below this '
      + "field's own observed floor over a population of at least 5 answered asks\", and it is not "
      + 'wired because a floor from fewer days is a guess. When every field reads READY, that '
      + 'deferral has met its condition and the alarm should be built. The floor rather than the '
      + 'mean, because a mean hides a bad day and the question is whether a field ever stopped '
      + 'arriving at all.',
    );
  } finally {
    await db.end();
  }
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`dex-field-presence failed — ${(error as Error).message}`);
  process.exit(1);
});
