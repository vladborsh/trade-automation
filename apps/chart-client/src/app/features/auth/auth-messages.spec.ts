import { ApiError } from '../../core/api/api-error';
import { acceptErrorMessage, loginErrorMessage } from './auth-messages';

describe('loginErrorMessage', () => {
  it('names each §7.1 login failure', () => {
    expect(loginErrorMessage(new ApiError(401, 'INVALID_CREDENTIALS', 'x'))).toBe('Wrong email or password.');
    expect(loginErrorMessage(new ApiError(403, 'USER_DISABLED', 'x'))).toMatch(/disabled/);
    expect(loginErrorMessage(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'x'))).toMatch(/15 minutes/);
  });

  it('separates server failures, bad input and an unreachable server', () => {
    expect(loginErrorMessage(new ApiError(500, null, 'x'))).toMatch(/server failed/);
    expect(loginErrorMessage(new ApiError(400, null, 'x'))).toMatch(/Check your email/);
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Cannot reach/);
  });
});

describe('acceptErrorMessage', () => {
  it('names each §7.1 accept failure', () => {
    expect(acceptErrorMessage(new ApiError(409, 'EMAIL_TAKEN', 'x'))).toMatch(/already exists/);
    expect(acceptErrorMessage(new ApiError(410, 'INVITE_USED', 'x'))).toMatch(/already been used/);
    expect(acceptErrorMessage(new ApiError(410, 'INVITE_EXPIRED', 'x'))).toMatch(/expired/);
    expect(acceptErrorMessage(new ApiError(404, 'INVITE_UNKNOWN', 'x'))).toMatch(/not valid/);
  });

  it('falls back sensibly for validation, other and network errors', () => {
    expect(acceptErrorMessage(new ApiError(400, null, 'x'))).toMatch(/Check the email/);
    expect(acceptErrorMessage(new ApiError(503, null, 'x'))).toMatch(/Could not create/);
    expect(acceptErrorMessage(new Error('boom'))).toMatch(/Cannot reach/);
  });
});
