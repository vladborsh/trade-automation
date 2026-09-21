import { Db, DbHandle } from '../../db/db.port';
import { AuthRepositories } from '../auth-repositories.port';
import { PgAuthSessionRepository } from './pg-auth-session.repository';
import { PgInviteRepository } from './pg-invite.repository';
import { PgUserRepository } from './pg-user.repository';

type BoundRepositories = Omit<AuthRepositories, 'transaction'>;

function bind(handle: DbHandle): BoundRepositories {
  return {
    users: new PgUserRepository(handle),
    invites: new PgInviteRepository(handle),
    sessions: new PgAuthSessionRepository(handle),
  };
}

/** PostgreSQL implementation of `AuthRepositories` over the `Db` port. */
export class PgAuthRepositories implements AuthRepositories {
  readonly users: PgUserRepository;
  readonly invites: PgInviteRepository;
  readonly sessions: PgAuthSessionRepository;

  constructor(private readonly db: Db) {
    this.users = new PgUserRepository(db);
    this.invites = new PgInviteRepository(db);
    this.sessions = new PgAuthSessionRepository(db);
  }

  transaction<T>(fn: (repos: BoundRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(bind(tx)));
  }
}
