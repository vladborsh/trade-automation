import type { Db } from '../db.port';

/**
 * IB-030 — the reads the web dashboard's health page needs (SQL stays in `src/db/pg/`, IB-004's
 * rule). WD-009 removed the gap-report grid reads with the candle tape they reported on.
 */

export interface DatabaseHealth {
  sizeBytes: number;
  partitionHorizon: string | null;
  partitionCount: number;
}

/**
 * Size and partition horizon. The horizon is the furthest month a partition exists for — the
 * number that matters, because there is no DEFAULT partition (§3.1, D7): a write past the horizon
 * fails outright rather than landing somewhere harmless.
 */
export async function databaseHealth(db: Db): Promise<DatabaseHealth> {
  const [size] = await db.query<{ size: string }>('select pg_database_size(current_database())::text as size');
  const partitions = await db.query<{ relname: string }>(
    `select c.relname from pg_class c
       join pg_inherits i on i.inhrelid = c.oid
      where c.relkind = 'r' and c.relname ~ '_[0-9]{4}_[0-9]{2}$'
      order by c.relname`,
  );
  const months = partitions
    .map((p) => /_(\d{4})_(\d{2})$/.exec(p.relname))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}-${m[2]}`);

  return {
    sizeBytes: Number(size?.size ?? 0),
    partitionHorizon: months.length > 0 ? months.sort()[months.length - 1] : null,
    partitionCount: partitions.length,
  };
}
