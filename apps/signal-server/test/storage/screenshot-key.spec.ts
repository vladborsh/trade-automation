import { assertScreenshotPrefix, screenshotKey, sessionScreenshotPrefix } from '../../src/storage/screenshot-store.port';

const U = '00000000-0000-4000-8000-00000000000a';
const S = '00000000-0000-4000-8000-00000000000b';
const O = '00000000-0000-4000-8000-00000000000c';

describe('screenshot keys (design §9.2)', () => {
  it('follows backtest/screenshots/user=/session=/order=/<kind>.png', () => {
    expect(screenshotKey(U, S, O, 'entry')).toBe(`backtest/screenshots/user=${U}/session=${S}/order=${O}/entry.png`);
    expect(sessionScreenshotPrefix(U, S)).toBe(`backtest/screenshots/user=${U}/session=${S}/`);
    expect(screenshotKey(U, S, O, 'exit').startsWith(sessionScreenshotPrefix(U, S))).toBe(true);
  });

  it('accepts only uuids and entry|exit, so no client string can shape a key', () => {
    expect(() => screenshotKey('../../etc', S, O, 'entry')).toThrow(/userId must be a uuid/);
    expect(() => screenshotKey(U, `${S}/..`, O, 'entry')).toThrow(/sessionId/);
    expect(() => screenshotKey(U, S, 'x', 'entry')).toThrow(/orderId/);
    expect(() => screenshotKey(U, S, O, 'thumb' as never)).toThrow(/kind/);
  });

  it('assertScreenshotPrefix refuses empty, root and non-directory prefixes, and any ..', () => {
    for (const bad of ['', '/', 'backtest/', 'backtest/screenshots/', 'backtest/screenshots/user=/', `backtest/screenshots/user=${U}`, `backtest/screenshots/user=${U}/../`, `/backtest/screenshots/user=${U}/`, 'candles/']) {
      expect(() => assertScreenshotPrefix(bad)).toThrow(/refusing/);
    }
    expect(() => assertScreenshotPrefix(sessionScreenshotPrefix(U, S))).not.toThrow();
    expect(() => assertScreenshotPrefix(`backtest/screenshots/user=${U}/`)).not.toThrow(); // a user's footprint
  });
});
