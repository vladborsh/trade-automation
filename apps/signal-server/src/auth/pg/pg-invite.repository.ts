import { DbHandle } from '../../db/db.port';
import { InviteRecord, InviteRepository } from '../invite.repository.port';

interface InviteRow {
  id: string;
  email: string | null;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
}

export class PgInviteRepository implements InviteRepository {
  constructor(private readonly db: DbHandle) {}

  async findByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    const [row] = await this.db.query<InviteRow>(
      `select id, email, created_by, created_at, expires_at, used_at, used_by
         from invites where token_hash = $1`,
      [tokenHash],
    );
    return row
      ? {
          id: row.id,
          email: row.email,
          createdBy: row.created_by,
          createdAtMs: row.created_at.getTime(),
          expiresAtMs: row.expires_at.getTime(),
          usedAtMs: row.used_at ? row.used_at.getTime() : null,
          usedBy: row.used_by,
        }
      : null;
  }

  /**
   * §7.1 — the row lock taken by this UPDATE serialises concurrent claims: a second claimer
   * blocks until the first commits, then re-evaluates `used_at is null` and matches no row.
   */
  async claim(tokenHash: string, nowMs: number): Promise<string | null> {
    const [row] = await this.db.query<{ id: string }>(
      `update invites set used_at = to_timestamp($2::double precision / 1000)
        where token_hash = $1 and used_at is null
          and expires_at > to_timestamp($2::double precision / 1000)
       returning id`,
      [tokenHash, nowMs],
    );
    return row ? row.id : null;
  }

  async setUsedBy(inviteId: string, userId: string): Promise<void> {
    await this.db.query(`update invites set used_by = $2 where id = $1`, [inviteId, userId]);
  }
}
