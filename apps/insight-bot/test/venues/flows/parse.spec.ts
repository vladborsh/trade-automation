import * as fs from 'fs';
import * as path from 'path';
import { parseCoinbaseCandles, parseDvol, parsePutCall, parseStablecoinTotals, premiumSeries } from '../../../src/venues/flows/parse';

/** IB-091 — the phase-2 sources' answers as captured (one probe each, 2026-11-04), parsed. */
const fx = (p: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', p), 'utf8'));

describe('the real answers parse, oldest first', () => {
  it('Deribit DVOL: closes of [ts, o, h, l, c] in ms', () => {
    const d = parseDvol(fx('deribit/dvol-btc-1h.json'));
    expect(d).toHaveLength(48);
    expect(d[0].timeSec).toBeLessThan(d[47].timeSec);
    expect(d[47]).toEqual({ timeSec: 1793761200, value: 39.74 });
  });

  it('OKX rubik put/call: [ts, oiRatio, volRatio] strings, newest first in the answer', () => {
    const p = parsePutCall(fx('okx/rubik-option-oi-volume-ratio-btc.json'));
    expect(p).toHaveLength(72);
    expect(p[71]).toEqual({ timeSec: 1793721600, oiRatio: 0.9924, volumeRatio: 1.7916 });
    expect(() => parsePutCall({ code: '50011', msg: 'Too Many Requests', data: [] })).toThrow('code "50011"');
  });

  it('DefiLlama: the USD-pegged total in USD, daily since 2017', () => {
    const s = parseStablecoinTotals(fx('defillama/stablecoincharts-all.json').rows);
    expect(s[0]).toEqual({ timeSec: 1511913600, value: 110105 });
    expect(s.at(-1)?.value).toBeCloseTo(295_076_471_836.72, 2);
  });

  it('Coinbase: [time, LOW, HIGH, OPEN, CLOSE, v] — and a swapped column throws instead of inverting', () => {
    const rows = fx('coinbase/candles-btc-usd-1m.json').rows as number[][];
    const c = parseCoinbaseCandles(rows);
    expect(c[c.length - 1]).toEqual({ timeSec: rows[0][0], value: rows[0][4] });
    const binanceOrder = rows.map(([t, low, high, open, close, v]) => [t, open, high, low, close, v]); // o h l c, as Binance
    expect(() => parseCoinbaseCandles(binanceOrder)).toThrow('the columns are not [time, low, high, open, close]');
  });
});

describe('premiumSeries — D18: against the dollar, USDT divided out, valid minutes only', () => {
  const t = (timeSec: number, value: number) => ({ timeSec, value });

  it('USDT at 0.9985 with BTC at the same DOLLAR price on both venues is a premium of ~0, not −0.15 %', () => {
    // BN BTCUSDT = 100 000 USDT = 99 850 USD; CB BTC-USD = 99 850
    const p = premiumSeries([t(60, 99_850)], [t(60, 0.9985)], [t(60, 100_000)]);
    expect(p[0].value).toBeCloseTo(0, 9);
    const raw = (99_850 - 100_000) / 100_000 * 100;
    expect(raw).toBeCloseTo(-0.15, 9); // what the raw difference would have said
  });

  it('a minute without USDT-USD is MISSING — not computed from the raw difference', () => {
    const p = premiumSeries([t(60, 99_850), t(120, 99_900)], [t(60, 0.9985)], [t(60, 100_000), t(120, 100_000)]);
    expect(p.map((x) => x.timeSec)).toEqual([60]);
  });

  it('on the captured hour (all three 1m series, same minutes): about −0.01 %, where the raw difference was −0.16 %', () => {
    const cb = parseCoinbaseCandles(fx('coinbase/candles-btc-usd-1m.json').rows);
    const usdt = parseCoinbaseCandles(fx('coinbase/candles-usdt-usd-1m.json').rows);
    const bn = (fx('binance/spot-btcusdt-1m-ib091.json').rows as Array<[number, string, string, string, string]>)
      .map((k) => ({ timeSec: Math.floor(k[0] / 1000), value: Number(k[4]) }));
    const p = premiumSeries(cb, usdt, bn);
    expect(p.length).toBeGreaterThanOrEqual(60);
    const mean = p.slice(-60).reduce((s, x) => s + x.value, 0) / 60;
    expect(Math.abs(mean)).toBeLessThan(0.05);
  });
});
