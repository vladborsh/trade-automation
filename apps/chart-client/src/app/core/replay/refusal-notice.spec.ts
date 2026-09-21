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

  it('treats the codeless 409 (a reused opId) as being out of step', () => {
    expect(refusalNotice(new ApiError(409, null, 'opId already used for a different request'))).toMatch(/Out of step/);
  });

  it('quotes anything else', () => {
    expect(refusalNotice(new ApiError(400, null, 'toCursorMs must be on a minute boundary.'))).toBe(
      'The server refused a change (toCursorMs must be on a minute boundary.) — reloaded the session.',
    );
  });
});
