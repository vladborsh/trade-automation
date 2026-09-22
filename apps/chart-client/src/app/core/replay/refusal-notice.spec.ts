import { ApiError } from '../api/api-error';
import { refusalNotice } from './refusal-notice';

describe('refusalNotice', () => {
  it('explains the second-tab guard', () => {
    expect(refusalNotice(new ApiError(409, 'CURSOR_BACKWARDS', 'x'))).toMatch(/another tab/);
    expect(refusalNotice(new ApiError(409, 'CURSOR_MISMATCH', 'x'))).toMatch(/another tab/);
  });

  it('names a session completed elsewhere', () => {
    expect(refusalNotice(new ApiError(409, 'SESSION_COMPLETE', 'x'))).toMatch(/already complete/);
  });

  it('a reused opId (409 OP_ID_REUSED, T-055) is out of step, with the server message', () => {
    expect(refusalNotice(new ApiError(409, 'OP_ID_REUSED', 'opId already used for a different request'))).toBe(
      'Out of step with the server (opId already used for a different request) — reloaded the session.',
    );
  });

  it('quotes anything else, e.g. 400 CURSOR_OFF_MINUTE (T-055)', () => {
    expect(refusalNotice(new ApiError(400, 'CURSOR_OFF_MINUTE', 'toCursorMs must be on a minute boundary.'))).toBe(
      'The server refused a change (toCursorMs must be on a minute boundary.) — reloaded the session.',
    );
  });
});
