import { liqAlert, liqAlertLink, liqContinuation, ruLiquidations, usd, venueLine } from '../../src/delivery/templates/liq-alerts.texts';

/** IB-122 (L2, L3; C3) — the messages: numbers, the venue split, a silent venue named, no forecast. */
const AT = Date.UTC(2026, 10, 5, 14, 7, 31, 250);
const BASE = 'https://insight.example/';
const alert = {
  symbol: 'BTCUSDT', base: 'BTC', side: 'long' as const, atMs: AT, sumUsd: 7.4e6,
  byVenue: { binance: 3.1e6, bybit: 2.9e6, okx: 1.4e6 }, count: 12, largest: { usd: 1.2e6, venue: 'bybit' as const },
  silentVenues: [], binanceFootnote: false,
};

describe('liquidation alert texts', () => {
  it('L3: the owner\'s three lines, ru and en, and the link at the crossing on 5m', () => {
    const t = liqAlert(alert, BASE);
    expect(t.ru).toBe([
      'Крупные ликвидации лонгов BTC: $7.4M за 5 мин',
      'Binance $3.1M · Bybit $2.9M · OKX $1.4M',
      '12 ликвидаций, крупнейшая $1.2M (Bybit)',
      `https://insight.example/instrument/BTCUSDT?at=${Math.floor(AT / 1000)}&tf=5m`,
    ].join('\n'));
    expect(t.en.split('\n').slice(0, 3)).toEqual(['Large BTC long liquidations: $7.4M in 5 min', 'Binance $3.1M · Bybit $2.9M · OKX $1.4M', '12 liquidations, largest $1.2M (Bybit)']);
  });

  it('a silent venue is named, never shown as $0', () => {
    expect(venueLine({ binance: 3e5, bybit: 0, okx: 0 }, [{ venue: 'okx', reason: 'stream_silent' }], 'ru')).toBe('Binance $300k · Bybit $0 · нет данных с OKX');
    expect(venueLine({ binance: 3e5, bybit: 0, okx: 0 }, [{ venue: 'bybit', reason: 'not_collected' }, { venue: 'okx', reason: 'not_collected' }], 'en'))
      .toBe('Binance $300k · no data from Bybit · no data from OKX');
  });

  it('the Binance footnote only when asked (the first message of the day)', () => {
    expect(liqAlert({ ...alert, binanceFootnote: true }, BASE).ru).toContain('Binance публикует не больше одной ликвидации в секунду');
    expect(liqAlert(alert, BASE).ru).not.toContain('Binance публикует');
  });

  it('L2: «продолжается: уже $X» with the window start', () => {
    const c = liqContinuation({ symbol: 'BTCUSDT', base: 'BTC', side: 'short', atMs: AT, sumUsd: 10.25e6, windowStartMs: AT - 300_000 }, BASE);
    expect(c.ru.split('\n')[0]).toBe('Ликвидации шортов BTC — продолжается: уже $10M с 14:02 UTC');
    expect(c.en.split('\n')[0]).toBe('BTC short liquidations — continuing: $10M so far since 14:02 UTC');
  });

  it('money and plurals', () => {
    expect([950, 300_000, 1_250_000, 7_440_000, 12_600_000, 2.5e9].map(usd)).toEqual(['$950', '$300k', '$1.3M', '$7.4M', '$13M', '$2.5B']);
    expect([1, 2, 5, 11, 21, 22, 112].map(ruLiquidations)).toEqual(['1 ликвидация', '2 ликвидации', '5 ликвидаций', '11 ликвидаций', '21 ликвидация', '22 ликвидации', '112 ликвидаций']);
    expect(liqAlertLink('https://x/', 'TRXUSDT', 1_000_999)).toBe('https://x/instrument/TRXUSDT?at=1000&tf=5m');
  });

  it('no forecast in any variant (D20)', () => {
    const FORECAST = [/будет/i, /вырастет/i, /упад[её]т/i, /разворот/i, /вероятн/i, /отскок/i, /\bwill\b/i, /\bexpect/i, /\breversal\b/i, /\bprobab/i, /\bbounce/i];
    const all = [false, true].flatMap((binanceFootnote) => (['long', 'short'] as const).map((side) => liqAlert({ ...alert, side, binanceFootnote, silentVenues: [{ venue: 'okx', reason: 'stream_silent' }] }, BASE)))
      .concat((['long', 'short'] as const).map((side) => liqContinuation({ symbol: 'BTCUSDT', base: 'BTC', side, atMs: AT, sumUsd: 1e7, windowStartMs: AT }, BASE)))
      .flatMap((t) => [t.ru, t.en]);
    expect(all).toHaveLength(12);
    expect(all.filter((s) => FORECAST.some((re) => re.test(s)))).toEqual([]);
  });
});
