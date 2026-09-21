import { isApiError } from '../../core/api/api-error';

const UNREACHABLE = 'Cannot reach the server. Check your connection and try again.';

/** What the login form says for a failed sign-in (§7.1 error codes). */
export function loginErrorMessage(err: unknown): string {
  if (!isApiError(err)) return UNREACHABLE;
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'Wrong email or password.';
    case 'USER_DISABLED':
      return 'This account is disabled. Ask the administrator.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many failed attempts. Wait 15 minutes and try again.';
    default:
      return err.status >= 500 ? 'The server failed to sign you in. Try again.' : 'Sign-in failed. Check your email and password.';
  }
}

/** What the set-password form says when accepting the invite fails (§7.1 error codes). */
export function acceptErrorMessage(err: unknown): string {
  if (!isApiError(err)) return UNREACHABLE;
  switch (err.code) {
    case 'EMAIL_TAKEN':
      return 'An account with this email already exists. Sign in instead.';
    case 'INVITE_USED':
      return 'This invite has already been used.';
    case 'INVITE_EXPIRED':
      return 'This invite has expired. Ask the administrator for a new one.';
    case 'INVITE_UNKNOWN':
      return 'This invite link is not valid.';
    default:
      return err.status === 400 ? 'Check the email and password and try again.' : 'Could not create the account. Try again.';
  }
}
