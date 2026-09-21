import { DbHandle } from '../../db/db.port';
import { OpsRepository } from '../ops.repository.port';

/** `backtest_ops` (D9). The response is stored as jsonb and returned parsed. */
export class PgOpsRepository implements OpsRepository {
  constructor(private readonly db: DbHandle) {}

  async find(sessionId: string, opId: string): Promise<unknown | null> {
    const [row] = await this.db.query<{ response: unknown }>(
      `select response from backtest_ops where session_id = $1 and op_id = $2`,
      [sessionId, opId],
    );
    return row ? row.response : null;
  }

  async save(sessionId: string, opId: string, response: unknown): Promise<void> {
    await this.db.query(`insert into backtest_ops (session_id, op_id, response) values ($1, $2, $3)`, [
      sessionId,
      opId,
      JSON.stringify(response),
    ]);
  }
}
