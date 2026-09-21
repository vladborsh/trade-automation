import { ApiError, buildUrl, isApiError, toApiError } from './api-error';

describe('toApiError', () => {
  it('reads the contract code and message from the error envelope', () => {
    const err = toApiError('POST', '/auth/login', 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong email or password' } });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('INVALID_CREDENTIALS');
    expect(err.message).toBe('Wrong email or password');
  });

  it('leaves code null for a body without a contract code (guard 401, validation 400, non-JSON)', () => {
    expect(toApiError('GET', '/auth/me', 401, { statusCode: 401, message: 'Unauthorized' }).code).toBeNull();
    expect(toApiError('GET', '/x', 400, { error: { code: 'NOT_A_CODE', message: 'm' } }).code).toBeNull();
    const nonJson = toApiError('GET', '/candles', 502, null);
    expect(nonJson.code).toBeNull();
    expect(nonJson.message).toBe('GET /candles failed: HTTP 502');
  });
});

describe('isApiError', () => {
  it('matches ApiError instances, optionally by status', () => {
    const err = new ApiError(410, 'INVITE_USED', 'used');
    expect(isApiError(err)).toBe(true);
    expect(isApiError(err, 410)).toBe(true);
    expect(isApiError(err, 404)).toBe(false);
    expect(isApiError(new Error('x'))).toBe(false);
  });
});

describe('buildUrl', () => {
  it('joins base and path, resolves a relative base against the origin, drops undefined params', () => {
    expect(buildUrl('http://localhost:4300/api/', '/candles', 'http://localhost:4200', { a: 1, b: undefined, c: 'x' })).toBe(
      'http://localhost:4300/api/candles?a=1&c=x',
    );
    expect(buildUrl('/api', '/auth/me', 'http://localhost:4200')).toBe('http://localhost:4200/api/auth/me');
  });
});
