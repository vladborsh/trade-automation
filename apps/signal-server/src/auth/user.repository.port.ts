import { UserRole } from '@trade-automation/contracts';

/** A `users` row at the JS boundary (architecture/backtest-app-system-design.md §3). */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  disabledAtMs: number | null;
  createdAtMs: number;
}

/** Thrown by `insert` when the (case-insensitive, citext) email already exists. */
export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`email already registered: ${email}`);
  }
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** @throws EmailTakenError */
  insert(user: { email: string; passwordHash: string; role: UserRole }): Promise<UserRecord>;
  /**
   * AdminBootstrap (§2.2): create the admin, or reset an existing row with that email to
   * `role='admin'`, the given hash and `disabled_at = null` — the environment is the source of
   * truth for the admin account.
   */
  upsertAdmin(email: string, passwordHash: string): Promise<UserRecord>;
}
