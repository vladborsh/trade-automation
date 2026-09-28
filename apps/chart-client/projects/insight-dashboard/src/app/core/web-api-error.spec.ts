import { ApiError } from '@backtest-core/api/api-error';
import { toWebApiError } from './web-api-error';

/**
 * IB-030 — why this parser exists at all: the backtest `toApiError` reads
 * `{ error: { code, message } }`, and every `/api/web` endpoint answers a flat `{ code }`. Without
 * its own parser the dashboard would see `code: null` for every failure and each page would take
 * its fallback branch for ever, looking like it worked.
 */
describe('toWebApiError', () => {
  it('reads the flat /api/web body the backtest envelope parser cannot', () => {
    const error = toWebApiError('GET', '/coverage', 401, { code: 'UNAUTHENTICATED' });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it("keeps the server's sentence when it sends one", () => {
    expect(toWebApiError('GET', '/x', 404, { code: 'NOT_FOUND', message: 'No such symbol.' }).message).toBe('No such symbol.');
  });

  it('carries maxDays into the message, so a retry can be correct', () => {
    const error = toWebApiError('GET', '/series', 400, { code: 'RANGE_TOO_WIDE', message: 'Range too wide.', maxDays: 90 });
    expect(error.code).toBe('RANGE_TOO_WIDE');
    expect(error.message).toBe('Range too wide. (at most 90 days)');
  });

  it('a body that is not the envelope (a proxy page, null) is a null code, never a throw', () => {
    for (const body of [null, undefined, '<html>502</html>', { error: { code: 'SL_ON_WRONG_SIDE' } }]) {
      const error = toWebApiError('GET', '/coverage', 502, body);
      expect(error.code).toBeNull();
      expect(error.message).toBe('GET /coverage failed: HTTP 502');
    }
  });
});
