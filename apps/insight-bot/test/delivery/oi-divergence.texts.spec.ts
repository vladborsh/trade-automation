import { alertLink, oiDivergenceAlert, ordinal, signedPct, type OiDivergenceAlertText } from '../../src/delivery/templates/oi-divergence.texts';

/**
 * IB-112 (V14) — the alert text, rendered from a fixture divergence: the owner's wording verbatim in
 * both languages, the repeat suffix, the link, and no forecast anywhere.
 */
const BASE = 'https://35-74-48-140.sslip.io';
// A bullish TRX 1h divergence: price lower low −2.35 % (shown −2.4 %), OI higher low +6.8 %, B at 2026-11-04 12:00 UTC.
const bull: OiDivergenceAlertText = { symbol: 'TRXUSDT', base: 'TRX', tf: '1h', direction: 'bullish', pricePct: -2.35, oiPct: 6.8, runLength: 2, bTime: 1_793_793_600 };
const bear: OiDivergenceAlertText = { ...bull, symbol: 'BTCUSDT', base: 'BTC', tf: '4h', direction: 'bearish', pricePct: 1.2, oiPct: -3.4 };

describe('V14: the OI divergence alert text', () => {
  it('bullish, ru and en, as the owner worded it, then the link', () => {
    const t = oiDivergenceAlert(bull, BASE);
    expect(t.ru).toBe('TRX 1h: цена обновила минимум (−2.4 %), OI — нет (+6.8 %). Набирают позиции на падении.\nhttps://35-74-48-140.sslip.io/instrument/TRXUSDT?at=1793793600&tf=1h');
    expect(t.en).toBe('TRX 1h: price made a lower low (−2.4 %), OI did not (+6.8 %). Positions are being opened into the drop.\nhttps://35-74-48-140.sslip.io/instrument/TRXUSDT?at=1793793600&tf=1h');
  });

  it('bearish mirrors it', () => {
    const t = oiDivergenceAlert(bear, BASE);
    expect(t.ru).toMatch(/^BTC 4h: цена обновила максимум \(\+1.2 %\), OI — нет \(−3.4 %\)\. Рост идёт без новых позиций\.\n/);
    expect(t.en).toMatch(/^BTC 4h: price made a higher high \(\+1.2 %\), OI did not \(−3.4 %\)\. The rise comes without new positions\.\n/);
  });

  it('a repeat says so, with the run length in words (V8); a first alert says nothing of it', () => {
    expect(oiDivergenceAlert({ ...bull, runLength: 3 }, BASE).ru).toContain('Набирают позиции на падении. · повторное: третий минимум подряд\n');
    expect(oiDivergenceAlert({ ...bear, runLength: 4 }, BASE).ru).toContain('· повторное: четвёртый максимум подряд\n');
    expect(oiDivergenceAlert({ ...bull, runLength: 3 }, BASE).en).toContain('· repeat: third lower low in a row\n');
    expect(oiDivergenceAlert({ ...bear, runLength: 3 }, BASE).en).toContain('· repeat: third higher high in a row\n');
    expect(oiDivergenceAlert(bull, BASE).ru).not.toContain('повторное');
  });

  it('the link opens the instrument at B on the alert\'s TF, whatever the base URL\'s trailing slash', () => {
    expect(alertLink(`${BASE}/`, bull)).toBe(`${BASE}/instrument/TRXUSDT?at=1793793600&tf=1h`);
  });

  it('numbers: the page\'s minus sign, precision by size, no «−0.00»', () => {
    expect([-2.345, 6.8, 12.4, 0.004, -0.004].map(signedPct)).toEqual(['−2.3 %', '+6.8 %', '+12 %', '0.00 %', '0.00 %']);
  });

  it('ordinals: words to ten, then numbers', () => {
    expect([3, 10, 11].map((n) => ordinal(n, 'ru'))).toEqual(['третий', 'десятый', '11-й']);
    expect([3, 11, 21, 22].map((n) => ordinal(n, 'en'))).toEqual(['third', '11th', '21st', '22nd']);
  });

  it('no forecast and no hit rate, in any variant (owner, D20)', () => {
    const FORECAST = [/будет/i, /вырастет/i, /упад[её]т/i, /разворот/i, /вероятн/i, /\bwill\b/i, /\bexpect/i, /\breversal\b/i, /\bprobab/i, /\d+\s?% (случаев|of the time)/i];
    const all = [bull, bear].flatMap((d) => [2, 3].map((runLength) => oiDivergenceAlert({ ...d, runLength }, BASE))).flatMap((t) => [t.ru, t.en]);
    expect(all).toHaveLength(8);
    expect(all.filter((s) => FORECAST.some((re) => re.test(s)))).toEqual([]);
  });
});
