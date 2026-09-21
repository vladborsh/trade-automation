/**
 * architecture/backtest-app-system-design.md §7.1 — GET /auth/invites/:token answers 404
 * `INVITE_UNKNOWN`, 410 `INVITE_USED` or 410 `INVITE_EXPIRED`. Used wins over expired: an invite
 * that was accepted and has since passed its expiry is reported as used, which is what happened.
 */
export type InviteStatus = 'valid' | 'unknown' | 'used' | 'expired';

export function inviteStatus(
  invite: { usedAtMs: number | null; expiresAtMs: number } | null,
  nowMs: number,
): InviteStatus {
  if (!invite) return 'unknown';
  if (invite.usedAtMs !== null) return 'used';
  if (invite.expiresAtMs <= nowMs) return 'expired';
  return 'valid';
}
