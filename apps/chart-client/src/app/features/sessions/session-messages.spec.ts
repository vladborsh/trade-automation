import { ApiError } from '../../core/api/api-error';
import { createSessionErrorMessage, deleteSessionErrorMessage, loadErrorMessage } from './session-messages';

describe('createSessionErrorMessage (§7.2 codes)', () => {
  it('names each 422 code the server sends on create', () => {
    expect(createSessionErrorMessage(new ApiError(422, 'LAYOUT_TOO_MANY_PANELS', 'x'))).toMatch(/at most 4/);
    expect(createSessionErrorMessage(new ApiError(422, 'LAYOUT_NOT_CANDLES', 'x'))).toMatch(/candle panels only/);
    expect(createSessionErrorMessage(new ApiError(422, 'MIXED_SESSION_CURRENCY', 'x'))).toMatch(/one session currency/);
    expect(createSessionErrorMessage(new ApiError(422, 'INSTRUMENT_NOT_AVAILABLE', 'x'))).toMatch(/no stored 1m/);
    expect(createSessionErrorMessage(new ApiError(422, 'PERIOD_OUTSIDE_COVERAGE', 'x'))).toMatch(/does not overlap/);
  });

  it('falls back for a 400, a server error and no connection', () => {
    expect(createSessionErrorMessage(new ApiError(400, null, 'x'))).toMatch(/refused the form/);
    expect(createSessionErrorMessage(new ApiError(503, null, 'x'))).toMatch(/server failed/);
    expect(createSessionErrorMessage(new ApiError(409, null, 'x'))).toMatch(/Could not create/);
    expect(createSessionErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Cannot reach/);
  });
});

describe('deleteSessionErrorMessage / loadErrorMessage', () => {
  it('says a 404 is already gone, other failures retry', () => {
    expect(deleteSessionErrorMessage(new ApiError(404, null, 'x'))).toMatch(/no longer exists/);
    expect(deleteSessionErrorMessage(new ApiError(500, null, 'x'))).toMatch(/Could not delete/);
    expect(deleteSessionErrorMessage(new Error('x'))).toMatch(/Cannot reach/);
  });

  it('explains a 503 (no database) apart from other load failures', () => {
    expect(loadErrorMessage(new ApiError(503, null, 'x'), 'sessions')).toMatch(/no database configured, so sessions are unavailable/);
    expect(loadErrorMessage(new ApiError(500, null, 'x'), 'sessions')).toBe('Could not load sessions. Try again.');
  });
});
