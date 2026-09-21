import { UserRole } from '@trade-automation/contracts';
import { DbHandle } from '../../db/db.port';
import { AuthSessionRepository, AuthSessionWithUser } from '../auth-session.repository.port';
import { toUserRecord } from './pg-user.repository';

const TS = (param: string) => `to_timestamp(${param}::double precision / 1000)`;

interface SessionUserRow {
  session_id: string;
  expires_at: Date;
  last_seen_at: Date;
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  disabled_at: Date | null;
  created_at: Date;
}

export class PgAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly db: DbHandle) {}

  async insert(session: {
    id: string;
    userId: string;
    expiresAtMs: number;
    nowMs: number;
    userAgent: string | null;
  }): Promise<void> {
    await this.db.query(
      `insert into auth_sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent)
       values ($1, $2, ${TS('$4')}, ${TS('$3')}, ${TS('$4')}, $5)`,
      [session.id, session.userId, session.expiresAtMs, session.nowMs, session.userAgent],
    );
  }

  async findWithUser(id: string): Promise<AuthSessionWithUser | null> {
    const [row] = await this.db.query<SessionUserRow>(
      `select s.id as session_id, s.expires_at, s.last_seen_at,
              u.id, u.email, u.password_hash, u.role, u.disabled_at, u.created_at
         from auth_sessions s join users u on u.id = s.user_id
        where s.id = $1`,
      [id],
    );
    return row
      ? {
          id: row.session_id,
          expiresAtMs: row.expires_at.getTime(),
          lastSeenAtMs: row.last_seen_at.getTime(),
          user: toUserRecord(row),
        }
      : null;
  }

  async touch(id: string, nowMs: number, expiresAtMs: number): Promise<void> {
    await this.db.query(
      `update auth_sessions set last_seen_at = ${TS('$2')}, expires_at = ${TS('$3')} where id = $1`,
      [id, nowMs, expiresAtMs],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`delete from auth_sessions where id = $1`, [id]);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.query(`delete from auth_sessions where user_id = $1`, [userId]);
  }

  async deleteExpiredForUser(userId: string, nowMs: number): Promise<void> {
    await this.db.query(`delete from auth_sessions where user_id = $1 and expires_at <= ${TS('$2')}`, [
      userId,
      nowMs,
    ]);
  }
}
