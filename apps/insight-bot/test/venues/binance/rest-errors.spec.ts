import { readFileSync } from 'fs';
import { join } from 'path';
import { PerpRest } from '../../../src/venues/binance/perp.rest';
import { BINANCE_INVALID_SYMBOL, BinanceRestError, isInvalidSymbol, parseBinanceErrorBody } from '../../../src/venues/binance/rest.base';
import { fakeFetch } from '../fake-fetch';

/**
 * IB-097 (Tech Lead review) — the one venue error that is a permanent answer: 400 with code -1121
 * "Invalid symbol". Pinned against the committed fixture of the venue's real body, so a change of
 * shape fails here instead of silently turning a delisted symbol back into an endless retry.
 * Everything else (another 400 code, a 5xx, a non-JSON body) must NOT be classified as it.
 */

const INVALID_SYMBOL_BODY = JSON.parse(readFileSync(join(__dirname, '../../fixtures/binance/fapi-klines-invalid-symbol.json'), 'utf8'));

const perpAnswering = (status: number, body: unknown) =>
  new PerpRest({ baseUrl: 'https://fapi.example', fetchImpl: fakeFetch([{ match: '/fapi/v1/klines', answer: { status, body } }]).impl });

const failure = async (rest: PerpRest): Promise<unknown> =>
  rest.klinesRange('NOPEUSDT', 0, 60_000, 2).then(() => { throw new Error('expected a failure'); }, (e: unknown) => e);

describe('the venue\'s invalid-symbol answer', () => {
  it('the fixture is the documented shape: {code: -1121, msg}', () => {
    expect(parseBinanceErrorBody(JSON.stringify(INVALID_SYMBOL_BODY))).toEqual({ code: BINANCE_INVALID_SYMBOL, msg: 'Invalid symbol.' });
  });

  it('400 + that body → a BinanceRestError carrying the code, classified as invalid symbol', async () => {
    const error = await failure(perpAnswering(400, INVALID_SYMBOL_BODY));
    expect(error).toBeInstanceOf(BinanceRestError);
    expect(error).toMatchObject({ status: 400, venueCode: -1121 });
    expect((error as Error).message).toMatch(/^Binance REST \/fapi\/v1\/klines\?.* failed: 400 .*\(code -1121: Invalid symbol\.\)$/);
    expect(isInvalidSymbol(error)).toBe(true);
  });

  it.each([
    ['another 400 code (-1100 illegal characters)', 400, { code: -1100, msg: 'Illegal characters found in parameter.' }],
    ['a 400 with no code', 400, { msg: 'Bad Request' }],
    ['-1121 under a status that is not 400', 404, INVALID_SYMBOL_BODY],
    ['a 5xx', 503, { code: -1001, msg: 'Internal error' }],
    ['a non-JSON body (a proxy page)', 502, '<html>Bad Gateway</html>'],
  ])('%s → NOT invalid symbol (retried, no row)', async (_label, status, body) => {
    const error = await failure(perpAnswering(status, body));
    expect(error).toBeInstanceOf(BinanceRestError);
    expect(isInvalidSymbol(error)).toBe(false);
  });

  it('a network error is not invalid symbol', () => {
    expect(isInvalidSymbol(new TypeError('fetch failed'))).toBe(false);
  });
});
