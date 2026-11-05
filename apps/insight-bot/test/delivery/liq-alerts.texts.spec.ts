import type { LiqEventContinuingDetails, LiqEventDetails } from '@trade-automation/contracts';
import { eventMinutes, liqAlertLink, liqEvent, liqEventContinuation, ruLiquidations, usd, venueLine } from '../../src/delivery/templates/liq-alerts.texts';

/** IB-122 / IB-143 (L3, L12, L13; C3) — the messages: one per market event, the venue split, a silent venue named, no forecast. */
const T0 = Date.UTC(2026, 10, 5, 14, 7, 31, 250);
const MIN = 60_000;
const BASE = 'https://insight.example/';
const baseOf = (s: string) => s.replace(/USDT$/, '');
const btc = {
  symbol: 'BTCUSDT', crossedAt: T0, windowStartMs: T0 - 5 * MIN, sumUsd: 7.4e6, thresholdUsd: 5e6,
  byVenue: { binance: 3.1e6, bybit: 2.9e6, okx: 1.4e6 }, count: 12, largest: { usd: 1.2e6, venue: 'bybit' as const }, silentVenues: [],
};
const eth = {
  ...btc, symbol: 'ETHUSDT', crossedAt: T0 + 40_000, windowStartMs: T0 + 40_000 - 5 * MIN, sumUsd: 3.2e6, thresholdUsd: 3e6,
  byVenue: { binance: 3.2e6, bybit: 0, okx: 0 }, count: 4, largest: { usd: 2e6, venue: 'binance' as const }, silentVenues: [{ venue: 'okx' as const, reason: 'stream_silent' as const }],
};
const one: LiqEventDetails = {
  side: 'long', eventAt: T0, sentAt: T0 + 100_000, settled: 'quiet', coins: [btc], totalUsd: 7.4e6, count: 12,
  largest: { usd: 1.2e6, venue: 'bybit', symbol: 'BTCUSDT' }, binanceFootnote: false,
};
const two: LiqEventDetails = { ...one, coins: [btc, eth], totalUsd: 10.6e6, count: 16, largest: { usd: 2e6, venue: 'binance', symbol: 'ETHUSDT' } };
const link = `https://insight.example/instrument/BTCUSDT?at=${Math.floor(T0 / 1000)}&tf=5m`;

describe('liquidation event texts', () => {
  it('L12, one coin: reads like the old single-coin alert — the coin in the title, its venue line, the count, the link', () => {
    const t = liqEvent({ side: 'long', details: one, baseOf }, BASE);
    expect(t.ru).toBe([
      'Крупные ликвидации лонгов BTC: $7.4M за 7 мин',
      'Binance $3.1M · Bybit $2.9M · OKX $1.4M',
      '12 ликвидаций, крупнейшая $1.2M (Bybit)',
      link,
    ].join('\n'));
    expect(t.en.split('\n').slice(0, 3)).toEqual(['Large BTC long liquidations: $7.4M in 7 min', 'Binance $3.1M · Bybit $2.9M · OKX $1.4M', '12 liquidations, largest $1.2M (Bybit)']);
  });

  it('L12, several coins: the side and the total, a line per coin largest first, the largest print with its coin; the link is the first coin', () => {
    const t = liqEvent({ side: 'short', details: { ...two, side: 'short' }, baseOf }, BASE);
    expect(t.ru).toBe([
      'Крупные ликвидации шортов: $11M за 7 мин',
      'BTC $7.4M — Binance $3.1M · Bybit $2.9M · OKX $1.4M',
      'ETH $3.2M — Binance $3.2M · Bybit $0 · нет данных с OKX',
      '16 ликвидаций, крупнейшая $2M (ETH, Binance)',
      link,
    ].join('\n'));
    expect(t.en.split('\n')[0]).toBe('Large short liquidations: $11M in 7 min');
    expect(t.en.split('\n')[3]).toBe('16 liquidations, largest $2M (ETH, Binance)');
  });

  it('{m}: from the earliest window start to the moment, rounded up to whole minutes', () => {
    expect(eventMinutes([{ windowStartMs: 0 }, { windowStartMs: 30_000 }], 5 * MIN)).toBe(5);
    expect(eventMinutes([{ windowStartMs: 0 }], 5 * MIN + 1)).toBe(6);
  });

  it('L13: «продолжаются: уже $X за {m} мин», new coins marked «+»', () => {
    const cont: LiqEventContinuingDetails = {
      ...two, sentAt: T0 + 180_000, closedAt: T0 + 9 * MIN, closedBy: 'quiet', firstMessageId: 3, newCoins: ['ETHUSDT'], addedCoins: [], news: true,
    };
    const t = liqEventContinuation({ side: 'long', details: cont, baseOf }, BASE);
    expect(t.ru.split('\n').slice(0, 3)).toEqual([
      'Ликвидации лонгов продолжаются: уже $11M за 14 мин',
      'BTC $7.4M — Binance $3.1M · Bybit $2.9M · OKX $1.4M',
      '+ETH $3.2M — Binance $3.2M · Bybit $0 · нет данных с OKX',
    ]);
    expect(t.en.split('\n')[0]).toBe('Long liquidations continuing: $11M so far in 14 min');
    const solo = liqEventContinuation({ side: 'short', details: { ...cont, coins: [btc], newCoins: [], addedCoins: ['BTCUSDT'] }, baseOf }, BASE);
    expect([solo.ru.split('\n')[0], solo.en.split('\n')[0]]).toEqual(['Ликвидации шортов BTC продолжаются: уже $11M за 14 мин', 'BTC short liquidations continuing: $11M so far in 14 min']);
  });

  it('a silent venue is named, never shown as $0', () => {
    expect(venueLine({ binance: 3e5, bybit: 0, okx: 0 }, [{ venue: 'okx', reason: 'stream_silent' }], 'ru')).toBe('Binance $300k · Bybit $0 · нет данных с OKX');
    expect(venueLine({ binance: 3e5, bybit: 0, okx: 0 }, [{ venue: 'bybit', reason: 'not_collected' }, { venue: 'okx', reason: 'not_collected' }], 'en'))
      .toBe('Binance $300k · no data from Bybit · no data from OKX');
  });

  it('the Binance footnote only when asked (the first message of the day)', () => {
    expect(liqEvent({ side: 'long', details: { ...one, binanceFootnote: true }, baseOf }, BASE).ru).toContain('Binance публикует не больше одной ликвидации в секунду');
    expect(liqEvent({ side: 'long', details: one, baseOf }, BASE).ru).not.toContain('Binance публикует');
  });

  it('money and plurals', () => {
    expect([950, 300_000, 1_250_000, 7_440_000, 12_600_000, 2.5e9].map(usd)).toEqual(['$950', '$300k', '$1.3M', '$7.4M', '$13M', '$2.5B']);
    expect([1, 2, 5, 11, 21, 22, 112].map(ruLiquidations)).toEqual(['1 ликвидация', '2 ликвидации', '5 ликвидаций', '11 ликвидаций', '21 ликвидация', '22 ликвидации', '112 ликвидаций']);
    expect(liqAlertLink('https://x/', 'TRXUSDT', 1_000_999)).toBe('https://x/instrument/TRXUSDT?at=1000&tf=5m');
  });

  it('no forecast in any variant (D20)', () => {
    const FORECAST = [/будет/i, /вырастет/i, /упад[её]т/i, /разворот/i, /вероятн/i, /отскок/i, /\bwill\b/i, /\bexpect/i, /\breversal\b/i, /\bprobab/i, /\bbounce/i];
    const cont: LiqEventContinuingDetails = { ...two, closedAt: T0 + 9 * MIN, closedBy: 'max', firstMessageId: 3, newCoins: ['ETHUSDT'], addedCoins: [], news: true };
    const all = [false, true].flatMap((binanceFootnote) => (['long', 'short'] as const).flatMap((side) => [
      liqEvent({ side, details: { ...one, binanceFootnote }, baseOf }, BASE),
      liqEvent({ side, details: { ...two, binanceFootnote }, baseOf }, BASE),
      liqEventContinuation({ side, details: { ...cont, binanceFootnote }, baseOf }, BASE),
    ])).flatMap((t) => [t.ru, t.en]);
    expect(all).toHaveLength(24);
    expect(all.filter((s) => FORECAST.some((re) => re.test(s)))).toEqual([]);
  });
});
