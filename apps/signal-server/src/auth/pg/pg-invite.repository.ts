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

/** Never `token_hash`: nothing read through this repository carries it back out. */
const COLUMNS = 'id, email, created_by, created_at, expires_at, used_at, used_by';

function toInviteRecord(row: InviteRow): InviteRecord {
  return {
    id: row.id,
    email: row.email,
    createdBy: row.created_by,
    createdAtMs: row.created_at.getTime(),
    expiresAtMs: row.expires_at.getTime(),
    usedAtMs: row.used_at ? row.used_at.getTime() : null,
    usedBy: row.used_by,
  };
}

export class PgInviteRepository implements InviteRepository {
  constructor(private readonly db: DbHandle) {}

  async findByTokenHash(tokenHash: string): Promise<InviteRecord | null> {
    const [row] = await this.db.query<InviteRow>(`select ${COLUMNS} from invites where token_hash = $1`, [tokenHash]);
    return row ? toInviteRecord(row) : null;
  }

  async create(invite: {
    tokenHash: string;
    email: string | null;
    createdBy: string;
    nowMs: number;
    expiresAtMs: number;
  }): Promise<InviteRecord> {
    const [row] = await this.db.query<InviteRow>(
      `insert into invites (token_hash, email, created_by, created_at, expires_at)
       values ($1, $2, $3, to_timestamp($4::double precision / 1000), to_timestamp($5::double precision / 1000))
       returning ${COLUMNS}`,
      [invite.tokenHash, invite.email, invite.createdBy, invite.nowMs, invite.expiresAtMs],
    );
    return toInviteRecord(row);
  }

  async listAll(): Promise<InviteRecord[]> {
    const rows = await this.db.query<InviteRow>(`select ${COLUMNS} from invites order by created_at desc, id`);
    return rows.map(toInviteRecord);
  }

  async deleteUnused(id: string): Promise<'deleted' | 'used' | 'missing'> {
    const deleted = await this.db.query(`delete from invites where id = $1 and used_at is null returning id`, [id]);
    if (deleted.length > 0) return 'deleted';
    const exists = await this.db.query(`select id from invites where id = $1`, [id]);
    return exists.length > 0 ? 'used' : 'missing';
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
