import { CreateInviteRequestSchema, type AdminInvite, type AdminUser } from '@trade-automation/contracts';
import { isApiError } from '../../core/api/api-error';

/** Pure helpers for the admin users/invites page (§7.1, decision 30). */

export type InviteStatus = 'open' | 'used' | 'expired';

export function inviteStatus(invite: AdminInvite, now: number): InviteStatus {
  if (invite.usedAt !== null) return 'used';
  return invite.expiresAt <= now ? 'expired' : 'open';
}

/** The server revokes any unused invite, expired ones included; a used one is kept for the record. */
export function canRevoke(invite: AdminInvite): boolean {
  return invite.usedAt === null;
}

/** An admin cannot disable their own account (the server answers 409). */
export function canDisable(user: AdminUser, currentUserId: string | null): boolean {
  return user.id !== currentUserId && user.disabledAt === null;
}

/** The email of the user who accepted an invite, when that user is in the list. */
export function usedByEmail(invite: AdminInvite, users: readonly AdminUser[]): string | null {
  return invite.usedBy === null ? null : (users.find((u) => u.id === invite.usedBy)?.email ?? null);
}

/** `YYYY-MM-DD HH:mm UTC` — the app runs on UTC throughout. */
export function formatUtc(ms: number | null): string {
  return ms === null ? '—' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The optional invite email as the request wants it: blank → no email; otherwise it must pass the
 * contract's own email rule (the server validates with the same schema and answers 400).
 */
export function parseInviteEmail(raw: string): { ok: true; email?: string } | { ok: false } {
  const email = raw.trim();
  if (email === '') return { ok: true };
  return CreateInviteRequestSchema.safeParse({ email }).success ? { ok: true, email } : { ok: false };
}

export type AdminAction = 'load' | 'disable' | 'enable' | 'create' | 'revoke';

const UNREACHABLE = 'Cannot reach the server. Check your connection and try again.';

/** What the page says when an admin action fails. */
export function adminErrorMessage(action: AdminAction, err: unknown): string {
  if (!isApiError(err)) return UNREACHABLE;
  if (err.status === 403) return 'Only an administrator can do this.';
  switch (action) {
    case 'disable':
      if (err.status === 409) return 'You cannot disable your own account.';
      if (err.status === 404) return 'That user no longer exists.';
      return 'Could not disable the user. Try again.';
    case 'enable':
      return err.status === 404 ? 'That user no longer exists.' : 'Could not enable the user. Try again.';
    case 'create':
      return err.status === 400 ? 'That email address is not valid.' : 'Could not create the invite. Try again.';
    case 'revoke':
      if (err.code === 'INVITE_USED') return 'This invite has already been used, so it cannot be revoked.';
      if (err.status === 404) return 'That invite no longer exists.';
      return 'Could not revoke the invite. Try again.';
    default:
      return 'Could not load users and invites. Try again.';
  }
}
