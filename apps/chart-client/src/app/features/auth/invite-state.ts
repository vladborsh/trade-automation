import { isApiError } from '../../core/api/api-error';

/** What the invite page shows for `GET /auth/invites/:token` (§7.1). */
export type InviteState = 'loading' | 'valid' | 'unknown' | 'used' | 'expired' | 'error';

/** The invite state a failed lookup means; 'error' is a transient failure worth retrying. */
export function inviteStateFromError(err: unknown): Exclude<InviteState, 'loading' | 'valid'> {
  if (!isApiError(err)) return 'error';
  switch (err.code) {
    case 'INVITE_UNKNOWN':
      return 'unknown';
    case 'INVITE_USED':
      return 'used';
    case 'INVITE_EXPIRED':
      return 'expired';
    default:
      return err.status === 404 ? 'unknown' : 'error';
  }
}
