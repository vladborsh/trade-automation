import { ApiError } from '../../core/api/api-error';
import { inviteStateFromError } from './invite-state';

describe('inviteStateFromError', () => {
  it('maps the §7.1 invite codes', () => {
    expect(inviteStateFromError(new ApiError(404, 'INVITE_UNKNOWN', 'x'))).toBe('unknown');
    expect(inviteStateFromError(new ApiError(410, 'INVITE_USED', 'x'))).toBe('used');
    expect(inviteStateFromError(new ApiError(410, 'INVITE_EXPIRED', 'x'))).toBe('expired');
  });

  it('treats a bare 404 as unknown and anything else as a retryable error', () => {
    expect(inviteStateFromError(new ApiError(404, null, 'x'))).toBe('unknown');
    expect(inviteStateFromError(new ApiError(500, null, 'x'))).toBe('error');
    expect(inviteStateFromError(new TypeError('Failed to fetch'))).toBe('error');
  });
});
