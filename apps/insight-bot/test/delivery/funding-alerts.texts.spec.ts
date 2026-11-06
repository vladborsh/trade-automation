import type { FundingEnterDetails, FundingFlipDetails } from '@trade-automation/contracts';
import { fundingEnter, fundingFlip, pct } from '../../src/delivery/templates/funding-alerts.texts';

/** IB-124 (F2, F4, F5; C3) — the funding messages: the venue's own rate and interval, who pays, the basis, the link, no forecast. */
const facts = { rate: 0.0002, intervalH: 4, ratePer8h: 0.0004, rarity: 0.97, band: { lo: 0.00001, hi: 0.00009 }, sample: 180, floorPer8h: 0.0003, rateTimeMs: 0, nextFundingTimeMs: 0 };
const AT = Date.UTC(2026, 10, 6, 1, 0);
const enter: FundingEnterDetails = { ...facts, side: 'high', episodeStartMs: AT };
const flip: FundingFlipDetails = { ...facts, rate: -0.00005, ratePer8h: -0.0001, side: 'high', episodeStartMs: AT, episodeEndMs: AT + 31.5 * 3_600_000, episodeHours: 31.5, flipSinceMs: AT + 32 * 3_600_000 };
const t = { base: 'BTC', symbol: 'BTCUSDT' };

describe('IB-124 funding texts (F2, F4, F5, C3)', () => {
  it('enter: who pays, the venue rate per its own interval and per 8 h, the band and floor, the link on 1h', () => {
    const m = fundingEnter(t, enter, 'https://insight.example/');
    expect(m.ru.split('\n')).toEqual([
      'Фандинг BTC в экстремуме: лонги платят шортам',
      'Ставка Binance +0.0200 % за 4 ч (+0.0400 % за 8 ч)',
      'Необычно для BTC: полоса 30 дней +0.0010 % … +0.0090 % за 4 ч, порог ±0.03 % за 8 ч',
      `https://insight.example/instrument/BTCUSDT?at=${AT / 1000}&tf=1h`,
    ]);
    expect(m.en.split('\n').slice(0, 3)).toEqual([
      'BTC funding at an extreme: longs pay shorts',
      'Binance rate +0.0200% per 4h (+0.0400% per 8h)',
      'Unusual for BTC: 30-day band +0.0010% … +0.0090% per 4h, floor ±0.03% per 8h',
    ]);
  });

  it('an 8 h coin prints one figure; an unknown interval is said, never hidden', () => {
    expect(fundingEnter(t, { ...enter, intervalH: 8, ratePer8h: 0.0002 }, '').ru).toContain('Ставка Binance +0.0200 % за 8 ч\n');
    expect(fundingEnter(t, { ...enter, intervalH: 8, ratePer8h: 0.0002 }, '').en).toContain('Binance rate +0.0200% per 8h\n');
    expect(fundingEnter(t, { ...enter, intervalH: null, ratePer8h: 0.0002 }, '').en).toContain('settlement interval unknown, counted as 8h');
  });

  it('flip: the episode length in whole hours (never rounded up), who pays NOW, the link at the first opposite check', () => {
    const m = fundingFlip(t, flip, 'https://insight.example');
    expect(m.ru.split('\n')[0]).toBe('Фандинг BTC сменил знак после 31 ч экстремума: теперь шорты платят лонгам');
    expect(m.en.split('\n')[0]).toBe('BTC funding changed sign after 31h at an extreme: now shorts pay longs');
    expect(m.ru).toContain('Ставка Binance −0.0050 % за 4 ч (−0.0100 % за 8 ч)');
    expect(m.ru).toContain(`?at=${(AT + 32 * 3_600_000) / 1000}&tf=1h`);
  });

  it('pct: signed, 4 decimals, a real minus sign', () => {
    expect([pct(0.000412, 'ru'), pct(-0.0001, 'en'), pct(0, 'en')]).toEqual(['+0.0412 %', '−0.0100%', '0.0000%']);
  });

  it('no forecast in any variant (D20)', () => {
    const FORECAST = [/будет/i, /вырастет/i, /упад[её]т/i, /разворот/i, /вероятн/i, /отскок/i, /\bwill\b/i, /\bexpect/i, /\breversal\b/i, /\bprobab/i, /\bbounce/i];
    const all = [enter, { ...enter, side: 'low' as const }].flatMap((d) => Object.values(fundingEnter(t, d, '')))
      .concat([flip, { ...flip, side: 'low' as const }].flatMap((d) => Object.values(fundingFlip(t, d, ''))));
    expect(all.filter((s) => FORECAST.some((re) => re.test(s)))).toEqual([]);
  });
});
