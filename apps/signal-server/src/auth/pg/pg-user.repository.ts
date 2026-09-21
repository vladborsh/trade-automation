import { UserRole } from '@trade-automation/contracts';
import { DbHandle } from '../../db/db.port';
import { EmailTakenError, UserRecord, UserRepository } from '../user.repository.port';

const UNIQUE_VIOLATION = '23505';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  disabled_at: Date | null;
  created_at: Date;
}

const COLUMNS = 'id, email, password_hash, role, disabled_at, created_at';

export function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    disabledAtMs: row.disabled_at ? row.disabled_at.getTime() : null,
    createdAtMs: row.created_at.getTime(),
  };
}

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: DbHandle) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db.query<UserRow>(`select ${COLUMNS} from users where email = $1`, [email]);
    return row ? toUserRecord(row) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.query<UserRow>(`select ${COLUMNS} from users where id = $1`, [id]);
    return row ? toUserRecord(row) : null;
  }

  async insert(user: { email: string; passwordHash: string; role: UserRole }): Promise<UserRecord> {
    try {
      const [row] = await this.db.query<UserRow>(
        `insert into users (email, password_hash, role) values ($1, $2, $3) returning ${COLUMNS}`,
        [user.email, user.passwordHash, user.role],
      );
      return toUserRecord(row);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new EmailTakenError(user.email);
      throw err;
    }
  }

  async listAll(): Promise<UserRecord[]> {
    const rows = await this.db.query<UserRow>(`select ${COLUMNS} from users order by created_at, id`);
    return rows.map(toUserRecord);
  }

  async setDisabledAt(id: string, disabledAtMs: number | null): Promise<UserRecord | null> {
    const [row] = await this.db.query<UserRow>(
      `update users set disabled_at = case when $2::double precision is null then null
                                           else to_timestamp($2::double precision / 1000) end
        where id = $1 returning ${COLUMNS}`,
      [id, disabledAtMs],
    );
    return row ? toUserRecord(row) : null;
  }

  async upsertAdmin(email: string, passwordHash: string): Promise<UserRecord> {
    const [row] = await this.db.query<UserRow>(
      `insert into users (email, password_hash, role) values ($1, $2, 'admin')
       on conflict (email) do update
         set password_hash = excluded.password_hash, role = 'admin', disabled_at = null
       returning ${COLUMNS}`,
      [email, passwordHash],
    );
    return toUserRecord(row);
  }
}
