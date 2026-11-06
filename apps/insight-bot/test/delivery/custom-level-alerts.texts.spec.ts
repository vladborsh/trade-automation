import { CUSTOM_LEVEL_EVENTS, type CustomLevelAlertDetails } from '@trade-automation/contracts';
import { CUSTOM_LEVEL_ERRORS, customLevelAlert, customLevelList } from '../../src/delivery/templates/custom-level-alerts.texts';

/** IB-128 (P9, P6, C3) — a custom level's message: what the bar did at the owner's level, the prices, the note, the link. */
const OPEN = Date.UTC(2026, 10, 6, 14, 45);
const d = (over: Partial<CustomLevelAlertDetails> = {}): CustomLevelAlertDetails => ({
  kind: 'custom', levelId: 7, price: 72_000, note: 'range high', dayStartMs: Date.UTC(2026, 10, 6),
  bar: { openMs: OPEN, open: 71_900, high: 72_300, low: 71_600, close: 72_140 }, prevClose: 71_900, ...over,
});
const t = { base: 'BTC', symbol: 'BTCUSDT' };
const NB = ' ';

describe('IB-128 custom level texts', () => {
  it('breakouts say the direction (an open\'s rule); the note in brackets; the link at the bar\'s open on 15m', () => {
    const up = customLevelAlert(t, 'breakout_up', d(), 'https://x.example/');
    expect(up.ru).toBe(`BTC: пробой вверх своего уровня 72${NB}000 (range high) — 15m закрылась на 72${NB}140\nhttps://x.example/instrument/BTCUSDT?at=${OPEN / 1000}&tf=15m`);
    expect(up.en).toBe(`BTC: breakout above custom level 72,000 (range high) — 15m closed at 72,140\nhttps://x.example/instrument/BTCUSDT?at=${OPEN / 1000}&tf=15m`);
    expect(customLevelAlert(t, 'breakout_down', d({ note: null }), '').en.split('\n')[0]).toBe('BTC: breakdown below custom level 72,000 — 15m closed at 72,140');
  });

  it('sweeps name the wick and the close', () => {
    expect(customLevelAlert(t, 'sweep_above', d(), '').ru.split('\n')[0]).toBe(`BTC: снятие ликвидности над своим уровнем 72${NB}000 (range high) — хвост до 72${NB}300, закрытие 72${NB}140`);
    expect(customLevelAlert(t, 'sweep_below', d(), '').en.split('\n')[0]).toBe('BTC: liquidity sweep below custom level 72,000 (range high) — wick to 71,600, close 72,140');
  });

  it('a crossunder/crossover cannot be written for a custom level (P9)', () => {
    expect(() => customLevelAlert(t, 'crossunder', d(), '')).toThrow(/P9/);
    expect(() => customLevelAlert(t, 'crossover', d(), '')).toThrow(/P9/);
  });

  it('no forecast in any variant (D20), messages and bot replies', () => {
    const FORECAST = [/будет/i, /вырастет/i, /упад[её]т/i, /разворот/i, /вероятн/i, /отскок/i, /цель/i, /\bwill\b/i, /\bexpect/i, /\breversal\b/i, /\bprobab/i, /\bbounce/i, /\btarget/i];
    const all = [
      ...CUSTOM_LEVEL_EVENTS.flatMap((e) => Object.values(customLevelAlert(t, e, d(), ''))),
      ...Object.values(CUSTOM_LEVEL_ERRORS).flatMap((x) => Object.values(x)),
      ...Object.values(customLevelList([{ id: 1, base: 'BTC', price: 1, note: null }])),
    ];
    expect(all.length).toBe(CUSTOM_LEVEL_EVENTS.length * 2 + Object.keys(CUSTOM_LEVEL_ERRORS).length * 2 + 2);
    expect(all.filter((s) => FORECAST.some((re) => re.test(s)))).toEqual([]);
  });
});
