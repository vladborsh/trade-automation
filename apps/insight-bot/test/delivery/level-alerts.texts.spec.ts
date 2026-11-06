import { LEVEL_EVENTS, LEVEL_KINDS, levelKindEvents, type LevelAlertDetails } from '@trade-automation/contracts';
import { levelAlert, price, utcTime } from '../../src/delivery/templates/level-alerts.texts';

/** IB-126 (P6, C3) — the level messages: what the bar did at the level, the prices, P10's time, the link; no forecast. */
const OPEN = Date.UTC(2026, 10, 6, 14, 45);
const d = (over: Partial<LevelAlertDetails> = {}): LevelAlertDetails => ({
  kind: 'PWH', price: 71_850, periodStartMs: 0, periodEndMs: 1, bar: { openMs: OPEN, open: 71_700, high: 72_300, low: 71_600, close: 72_140 },
  prevClose: 71_700, firstBeyondAtMs: null, ...over,
});
const t = { base: 'BTC', symbol: 'BTCUSDT' };
const first = (s: string) => s.split('\n')[0];

describe('IB-126 level texts (P6, C3)', () => {
  it('P6\'s examples, word for word (with the non-breaking thousands space)', () => {
    expect(first(levelAlert(t, 'breakout_up', d(), '').ru)).toBe('BTC: пробой PWH 71 850 — 15m закрылась на 72 140');
    expect(first(levelAlert(t, 'sweep_above', d({ bar: { openMs: OPEN, open: 71_700, high: 72_300, low: 71_600, close: 71_700 } }), '').ru))
      .toBe('BTC: снятие ликвидности над PWH 71 850 — хвост до 72 300, закрытие 71 700');
    const cu = d({ bar: { openMs: OPEN, open: 72_000, high: 72_050, low: 71_500, close: 71_600 }, firstBeyondAtMs: Date.UTC(2026, 10, 4, 15, 0) });
    expect(first(levelAlert(t, 'crossunder', cu, '').ru)).toBe('BTC: возврат под PWH 71 850 — 15m закрылась на 71 600; выше уровня закрывалась с 4 ноя 15:00 UTC');
    expect(first(levelAlert(t, 'crossover', { ...cu, kind: 'PWL' }, '').ru)).toMatch(/^BTC: возврат над PWL 71 850 — .*; ниже уровня закрывалась с 4 ноя 15:00 UTC$/);
  });

  it('English: the same facts, comma thousands, level names as they are', () => {
    expect(first(levelAlert(t, 'breakout_up', d(), '').en)).toBe('BTC: breakout above PWH 71,850 — 15m closed at 72,140');
    expect(first(levelAlert(t, 'breakout_down', d({ kind: 'MO' }), '').en)).toBe('BTC: breakdown below monthly open 71,850 — 15m closed at 72,140');
    expect(first(levelAlert(t, 'sweep_below', d({ kind: 'WO' }), '').en)).toBe('BTC: liquidity sweep below weekly open 71,850 — wick to 71,600, close 72,140');
  });

  it('an open says which way it broke; a high or low level does not need to', () => {
    expect(first(levelAlert(t, 'breakout_up', d({ kind: 'WO' }), '').ru)).toBe('BTC: пробой вверх weekly open 71 850 — 15m закрылась на 72 140');
    expect(first(levelAlert(t, 'breakout_down', d({ kind: 'WO' }), '').ru)).toContain('пробой вниз weekly open');
    expect(first(levelAlert(t, 'breakout_down', d({ kind: 'PML' }), '').ru)).toContain('BTC: пробой PML');
  });

  it('the link is the bar\'s open on 15m, base URL trimmed', () => {
    expect(levelAlert(t, 'breakout_up', d(), 'https://insight.example/').ru.split('\n')[1]).toBe(`https://insight.example/instrument/BTCUSDT?at=${OPEN / 1000}&tf=15m`);
  });

  it('price: every figure at the level\'s precision; small coins keep their decimals', () => {
    expect([price(99, 'en', 100), price(100, 'en'), price(3512.44, 'ru'), price(0.312456, 'en'), price(1_234_567, 'en')])
      .toEqual(['99.00', '100.00', '3 512.4', '0.31246', '1,234,567']);
  });

  it('utcTime: day, month, hour in UTC', () => {
    expect(utcTime(Date.UTC(2027, 0, 1, 0, 5), 'ru')).toBe('1 янв 00:05 UTC');
    expect(utcTime(Date.UTC(2026, 4, 9, 23, 0), 'en')).toBe('9 May 23:00 UTC');
  });

  it('no forecast in any variant of any kind and event (D20)', () => {
    const FORECAST = [/будет/i, /вырастет/i, /упад[её]т/i, /разворот/i, /вероятн/i, /отскок/i, /цель/i, /\bwill\b/i, /\bexpect/i, /\breversal\b/i, /\bprobab/i, /\bbounce/i, /\btarget/i];
    const all = LEVEL_KINDS.flatMap((kind) => levelKindEvents(kind).flatMap((e) => Object.values(levelAlert(t, e, d({ kind, firstBeyondAtMs: OPEN }), ''))));
    expect(all.length).toBe(LEVEL_KINDS.reduce((n, k) => n + levelKindEvents(k).length, 0) * 2);
    expect(all.filter((s) => FORECAST.some((re) => re.test(s)))).toEqual([]);
    expect(new Set(LEVEL_EVENTS).size).toBe(6);
  });
});
