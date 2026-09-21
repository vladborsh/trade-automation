import { isApiError } from '../../core/api/api-error';

const UNREACHABLE = 'Cannot reach the server. Check your connection and try again.';

/** What the create form says when POST /backtest/sessions fails (§7.2 422 codes). */
export function createSessionErrorMessage(err: unknown): string {
  if (!isApiError(err)) return UNREACHABLE;
  switch (err.code) {
    case 'LAYOUT_TOO_MANY_PANELS':
      return 'A session holds at most 4 instruments.';
    case 'LAYOUT_NOT_CANDLES':
      return 'A session layout holds candle panels only.';
    case 'MIXED_SESSION_CURRENCY':
      return 'All instruments must share one session currency.';
    case 'INSTRUMENT_NOT_AVAILABLE':
      return 'One of the instruments has no stored 1m history on the server.';
    case 'PERIOD_OUTSIDE_COVERAGE':
      return 'The period does not overlap the stored history of every instrument.';
    default:
      if (err.status === 400) return 'The server refused the form. Check every field and try again.';
      return err.status >= 500 ? 'The server failed to create the session. Try again.' : 'Could not create the session. Try again.';
  }
}

/** What the list says when a delete fails. A 404 means it is already gone. */
export function deleteSessionErrorMessage(err: unknown): string {
  if (!isApiError(err)) return UNREACHABLE;
  if (err.status === 404) return 'This session no longer exists.';
  return 'Could not delete the session. Try again.';
}

/** What a screen says when its data does not load. */
export function loadErrorMessage(err: unknown, what: string): string {
  if (!isApiError(err)) return UNREACHABLE;
  if (err.status === 503) return `The server has no database configured, so ${what} are unavailable.`;
  return `Could not load ${what}. Try again.`;
}
