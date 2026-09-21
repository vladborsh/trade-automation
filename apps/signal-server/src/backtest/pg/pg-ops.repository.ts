import { DbHandle } from '../../db/db.port';
import type { OpKind } from '../op-fingerprint';
import { OpsRepository, StoredOp } from '../ops.repository.port';

/** `backtest_ops` (D9, BUG-004). The response is stored as jsonb and returned parsed. */
export class PgOpsRepository implements OpsRepository {
  constructor(private readonly db: DbHandle) {}

  async find(sessionId: string, opId: string): Promise<StoredOp | null> {
    const [row] = await this.db.query<{ response: unknown; kind: OpKind | null; fingerprint: string | null }>(
      `select response, kind, fingerprint from backtest_ops where session_id = $1 and op_id = $2`,
      [sessionId, opId],
    );
    return row ? { response: row.response, kind: row.kind, fingerprint: row.fingerprint } : null;
  }

  async save(sessionId: string, opId: string, op: { kind: OpKind; fingerprint: string }, response: unknown): Promise<void> {
    await this.db.query(
      `insert into backtest_ops (session_id, op_id, response, kind, fingerprint) values ($1, $2, $3, $4, $5)`,
      [sessionId, opId, JSON.stringify(response), op.kind, op.fingerprint],
    );
  }
}
