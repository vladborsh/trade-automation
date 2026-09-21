/** An `invites` row at the JS boundary (architecture/backtest-app-system-design.md §3). */
export interface InviteRecord {
  id: string;
  email: string | null;
  createdBy: string;
  createdAtMs: number;
  expiresAtMs: number;
  usedAtMs: number | null;
  usedBy: string | null;
}

export interface InviteRepository {
  findByTokenHash(tokenHash: string): Promise<InviteRecord | null>;
  /**
   * §7.1 single-use: the conditional `UPDATE ... WHERE token_hash=$h AND used_at IS NULL AND
   * expires_at > $now`. Returns the invite id when this call claimed it, null when it did not
   * (unknown, already used, or expired). Of N concurrent callers at most one gets an id.
   */
  claim(tokenHash: string, nowMs: number): Promise<string | null>;
  /** Records who accepted a claimed invite (same transaction as `claim`). */
  setUsedBy(inviteId: string, userId: string): Promise<void>;
  /** POST /admin/invites (T-008): stores only the token's hash; the token itself is never stored. */
  create(invite: { tokenHash: string; email: string | null; createdBy: string; nowMs: number; expiresAtMs: number }): Promise<InviteRecord>;
  /** GET /admin/invites (T-008): every invite, newest first. Never the token or its hash. */
  listAll(): Promise<InviteRecord[]>;
  /**
   * DELETE /admin/invites/:id (T-008): deletes the invite only if it is unused (expired or not).
   * 'deleted' when it was, 'used' when it exists but was accepted, 'missing' when there is none.
   */
  deleteUnused(id: string): Promise<'deleted' | 'used' | 'missing'>;
}
