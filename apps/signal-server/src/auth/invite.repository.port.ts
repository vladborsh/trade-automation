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
}
