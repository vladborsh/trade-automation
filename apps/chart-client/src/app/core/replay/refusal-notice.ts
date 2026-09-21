import { isApiError } from '../api/api-error';

/**
 * The one line the workspace shows when the server refuses a queued mutation and the session is
 * reloaded from it (§5.5: the 409s are the guard against a second tab).
 */
export function refusalNotice(err: unknown): string {
  if (isApiError(err)) {
    switch (err.code) {
      case 'CURSOR_BACKWARDS':
      case 'CURSOR_MISMATCH':
        return 'This session moved on elsewhere (another tab?) — reloaded from the server.';
      case 'SESSION_COMPLETE':
        return 'This session is already complete — reloaded from the server.';
    }
    if (err.status === 409) return 'Out of step with the server — reloaded the session.'; // "opId already used…" (BUG-004): a client bug
  }
  const message = err instanceof Error ? err.message : String(err);
  return `The server refused a change (${message}) — reloaded the session.`;
}
