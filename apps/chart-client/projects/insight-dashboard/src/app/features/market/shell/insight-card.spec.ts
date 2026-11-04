import { describe, expect, it } from 'vitest';
import type { WebInsightStatement } from '@trade-automation/contracts';
import { en } from '../../../i18n/en';
import { fill } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { ru } from '../../../i18n/ru';
import { baseOf, basisOf, cardView, chipOf, figureRuns, linkLabel, ratioText, sparkScaleOf, whenOf, type Phrase } from './insight-card';
import { wordInsight } from './market-text';

/**
 * IB-107 (market-page design §7.3, §7.4, D20) — a card's words, against the design's worked examples:
 * the variant each rule chooses by sign and side, the «when», the link label, the basis and its
 * tooltip. Worded through the real ru/en tables, so a table that drifts from §7.4 fails here.
 */
const NOW = Date.UTC(2026, 10, 4, 14, 0) / 1000;
const TODAY_3AM = Date.UTC(2026, 10, 4, 3, 0) / 1000;
const say = (p: Phrase, lang: 'ru' | 'en' = 'ru') => {
  const table = lang === 'ru' ? ru : en;
  return wordInsight(p, (key: StringKey, params?: Record<string, string | number>) => fill(table[key], params));
};
const st = (o: Partial<WebInsightStatement> & Pick<WebInsightStatement, 'ruleId' | 'block' | 'key' | 'params'>): WebInsightStatement => ({
  rarity: 0.97, magnitude: 1, link: { anchor: o.block }, spark: null,
  basis: { window: '24h', venues: ['binance'], sampleWindows: 697, observedWindows: 697, from: Date.UTC(2026, 9, 5) / 1000 },
  ...o,
});
const words = (s: WebInsightStatement, lang: 'ru' | 'en' = 'ru') => {
  const v = cardView(s, NOW);
  return { title: say(v.title, lang), expl: v.explanation.map((p) => say(p, lang)).join(' '), when: say(v.when, lang), link: say(v.link.label, lang), basis: say(v.basis, lang), tip: say(v.basisTip, lang), chip: v.chip };
};

describe('R1 liq_surge — side picks the words; no ratio drops its clause', () => {
  const r1 = (side: string, ratio: number | null) => st({ ruleId: 'R1', block: 'liquidations', key: 'insight.liq_surge', params: { side, usd: 25_000_000, ratio }, basis: { ...st({ ruleId: 'R1', block: 'liquidations', key: 'insight.liq_surge', params: {} }).basis, window: '4h' } });
  it('the mockup\'s example, in member words', () => {
    const w = words(r1('short', 5));
    expect(w.title).toBe('Выносит шорты: $25M за 4ч — 5× обычного');
    expect(w.expl).toBe('Обычно за 4ч ликвидируют около $5M шортов. Ликвидация — биржа сама закрывает позицию, когда у трейдера кончается залог; волна ликвидаций значит, что цена резко шла против этой стороны.');
    expect(w.chip.tone).toBe('short');
    expect(words(r1('long', 5)).title).toBe('Выносит лонги: $25M за 4ч — 5× обычного');
    expect(words(r1('long', 5), 'en').title).toBe('Longs wiped out: $25M in 4h — 5× normal');
  });
  it('ratio null: neither the «× обычного» nor the norm sentence', () => {
    const w = words(r1('long', null));
    expect(w.title).toBe('Выносит лонги: $25M за 4ч');
    expect(w.expl).not.toContain('Обычно');
  });
});

describe('R2 liq_coin', () => {
  it('«ETH: ликвидаций на $16M за 24ч — 4× обычного для монеты», linked to the coin on the chart', () => {
    const w = words(st({ ruleId: 'R2', block: 'liquidations', key: 'insight.liq_coin', params: { symbol: 'ETHUSDT', usd: 16_000_000, ratio: 4 }, link: { route: 'instrument', symbol: 'ETHUSDT', timeSec: null } }));
    expect(w.title).toBe('ETH: ликвидаций на $16M за 24ч — 4× обычного для монеты');
    expect(w.expl).toBe('Обычно по ETH за 24ч ликвидируют около $4M. Среди монет с ликвидациями от $250k это самое необычное значение для своей истории.');
    expect(w.link).toBe('Открыть ETH на графике →');
    expect(w.chip.tone).toBe('liq'); // no side: the liquidations chip of its own
  });
});

describe('R3 liq_cascade — the moment is the link and the «when»', () => {
  const r3 = (timeSec: number) => st({ ruleId: 'R3', block: 'liquidations', key: 'insight.liq_cascade', params: { side: 'long', count: 21, minutes: 9, usd: 14_400_000, symbol: 'BTCUSDT' }, link: { route: 'instrument', symbol: 'BTCUSDT', timeSec } });
  it('«Каскад ликвидаций лонгов за 9 мин: 21, всего $14M» → «Открыть BTC в 03:00 UTC» (the count agrees with no noun: «3», «21» read right)', () => {
    const w = words(r3(TODAY_3AM));
    expect(w.title).toBe('Каскад ликвидаций лонгов за 9 мин: 21, всего $14M');
    expect(words({ ...r3(TODAY_3AM), params: { ...r3(TODAY_3AM).params, count: 3 } }).title).toBe('Каскад ликвидаций лонгов за 9 мин: 3, всего $14M');
    expect(words(r3(TODAY_3AM), 'en').title).toBe('Cascade of long liquidations in 9 min: 21, $14M in total');
    expect(w.expl).toContain('больше всего по BTC');
    expect(w.link).toBe('Открыть BTC в 03:00 UTC →');
    expect(w.when).toBe('сегодня 03:00 UTC');
    expect(w.chip.tone).toBe('long');
  });
  it('yesterday and older say so', () => {
    expect(words(r3(TODAY_3AM - 86_400)).when).toBe('вчера 03:00 UTC');
    expect(words(r3(TODAY_3AM - 3 * 86_400)).when).toBe('2026-11-01 03:00 UTC');
  });
});

describe('R4 oi_vs_price — the owner\'s screenshot, and one sentence per quadrant', () => {
  const r4 = (quadrant: string, oiPct: number, pricePct: number) => st({
    ruleId: 'R4', block: 'positioning', key: 'insight.oi_vs_price', params: { symbol: 'LTCUSDT', quadrant, oiPct, pricePct },
    link: { route: 'instrument', symbol: 'LTCUSDT', timeSec: NOW - 86_400 },
  });
  it('LTC +7.3 % OI at +0.3 % price: rare, price usual, new longs; over the window', () => {
    const w = words(r4('new_longs', 7.3, 0.3));
    expect(w.title).toBe('LTC: открытый интерес +7.3 % при цене +0.3 %');
    expect(w.expl).toBe('Для LTC такое изменение открытого интереса за 24ч — редкость, а цена в обычных пределах. Цена выше — скорее набирают лонги.');
    expect(w.link).toBe('Открыть LTC за 24ч →');
    expect(w.when).toBe('за 24ч'); // the period's start is not a moment
  });
  it('each quadrant its sentence; flat adds none', () => {
    expect(words(r4('new_shorts', 6.9, -5.7)).expl).toMatch(/Цена ниже — скорее открывают шорты\.$/);
    expect(words(r4('long_closing', -6, -1)).expl).toMatch(/скорее закрывают лонги\.$/);
    expect(words(r4('short_closing', -6, 1)).expl).toMatch(/скорее закрывают шорты\.$/);
    expect(words(r4('flat', 0.5, 0)).expl).toBe('Для LTC такое изменение открытого интереса за 24ч — редкость, а цена в обычных пределах.');
  });
});

describe('R5 funding_extremes — the coin is the subject; the sign says who pays', () => {
  const r5 = (rate: number, count: number) => st({ ruleId: 'R5', block: 'positioning', key: 'insight.funding_extremes', params: { count, total: 30, symbol: 'TRUMPUSDT', rate } });
  it('negative: shorts pay; one more coin is said', () => {
    const w = words(r5(-0.00039, 2));
    expect(w.title).toBe('TRUMP: шорты доплачивают лонгам −0.0390 % — необычно много');
    expect(w.expl).toContain('Отрицательный: шортов больше, и они платят.');
    expect(w.expl).toMatch(/Так же необычно ещё у 1 из 30 монет\.$/);
    expect(w.link).toBe('К позициям ↓');
    expect(w.chip.tone).toBe('pos');
  });
  it('positive: longs pay; alone, no «ещё у»', () => {
    const w = words(r5(0.0011, 1));
    expect(w.title).toBe('TRUMP: лонги доплачивают шортам 0.1100 % — необычно много');
    expect(w.expl).toContain('Положительный: лонгов больше, и они платят.');
    expect(w.expl).not.toContain('Так же');
  });
});

describe('R6 crowd_vs_top', () => {
  const r6 = (global: number, top: number) => st({ ruleId: 'R6', block: 'positioning', key: 'insight.crowd_vs_top', params: { symbol: 'ETHUSDT', global, top } });
  it('global > 1: the crowd is long; < 1: the mirror', () => {
    expect(words(r6(2.6, 0.8)).title).toBe('ETH: толпа в лонгах, крупные трейдеры — в шортах');
    expect(words(r6(0.6, 1.4)).title).toBe('ETH: толпа в шортах, крупные трейдеры — в лонгах');
    expect(words(r6(2.6, 0.8)).expl).toBe('Лонги к шортам: по числу счетов 2.60, у топ-трейдеров по объёму позиций 0.80 (1 — поровну). Для ETH такое расхождение — редкость.');
  });
});

describe('R7 breadth', () => {
  const r7 = (altGapPct: number, fngBand: string | null) => st({ ruleId: 'R7', block: 'sentiment', key: 'insight.breadth', params: { upPct: 12, altGapPct, fngBand } });
  it('alts behind, with F&G; ahead; no band, no F&G sentence', () => {
    const w = words(r7(-1.9, 'fear'));
    expect(w.title).toBe('Рынок: растут 12% монет, альты отстают от BTC на 1.9 п.');
    expect(w.expl).toBe('Такая картина по всему рынку за 24ч — редкость за последние 30 дней. Индекс страха и жадности: страх.');
    expect(words(r7(2.4, null)).title).toBe('Рынок: растут 12% монет, альты обгоняют BTC на 2.4 п.');
    expect(words(r7(2.4, null)).expl).not.toContain('страха');
    expect(words(r7(-1.9, 'fear')).chip.tone).toBe('sent');
  });
});

describe('R8–R10 flows', () => {
  it('R8: «Опционы BTC подорожали: ожидаемая волатильность 52 (+6.1)»', () => {
    expect(words(st({ ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike', params: { value: 52.2, change: 6.1 } })).title).toBe('Опционы BTC подорожали: ожидаемая волатильность 52 (+6.1)');
  });
  it('R9: a burn shrinks the supply, «за сутки»; a mint over a week', () => {
    const burn = words(st({ ruleId: 'R9', block: 'flows', key: 'insight.stablecoin_supply', params: { usd: -911_000_000, pct: -0.31, days: 1 } }));
    expect(burn.title).toBe('Стейблкоинов стало меньше на $911M за сутки');
    expect(burn.expl).toBe('Погашение: монеты сдали эмитенту и вывели доллары — эти деньги ушли из крипты. Это −0.31 % всех стейблкоинов; считаем монеты, а не их цену.');
    expect(burn.when).toBe('за сутки');
    expect(burn.link).toBe('К деривативам и потокам ↓');
    const mint = words(st({ ruleId: 'R9', block: 'flows', key: 'insight.stablecoin_supply', params: { usd: 2_500_000_000, pct: 0.8, days: 7 } }));
    expect(mint.title).toBe('Выпущено стейблкоинов на $2.5B за неделю');
    expect(mint.when).toBe('за неделю');
    expect(words(st({ ruleId: 'R9', block: 'flows', key: 'insight.stablecoin_supply', params: { usd: 2_500_000_000, pct: 0.8, days: 7 } }), 'en').title).toBe('Issued: $2.5B of stablecoins in a week');
  });
  it('R10: below / above, «последний час», the minutes held', () => {
    const below = words(st({ ruleId: 'R10', block: 'flows', key: 'insight.coinbase_premium', params: { pct: -0.05, minutes: 52 } }));
    expect(below.title).toBe('BTC на Coinbase дешевле, чем на Binance: −0.050 %');
    expect(below.expl).toMatch(/^Держалось 52 мин из последнего часа\./);
    expect(below.when).toBe('последний час');
    expect(words(st({ ruleId: 'R10', block: 'flows', key: 'insight.coinbase_premium', params: { pct: 0.18, minutes: 58 } }), 'en').title).toBe('BTC on Coinbase above Binance: +0.18 %');
  });
});

describe('the parts every card shares', () => {
  it('base: the quote suffix goes, a bare ticker stays', () => {
    expect(['BTCUSDT', 'PEPEUSDC', 'XAUUSD', '1000PEPEUSDT', 'USDT'].map(baseOf)).toEqual(['BTC', 'PEPE', 'XAU', '1000PEPE', 'USDT']);
  });
  it('ratio: one decimal under 10, whole above', () => {
    expect([5, 4.24, 12.6].map(ratioText)).toEqual(['5', '4.2', '13']);
  });
  it('basis: «за 24ч · Binance», and the sample sizes with the start go into the tooltip', () => {
    const b = basisOf(st({ ruleId: 'R5', block: 'positioning', key: 'insight.funding_extremes', params: {} }).basis);
    expect(say(b.basis)).toBe('за 24ч · Binance');
    expect(say(b.tip)).toBe('норма: 697 окон с данными из 697, с 2026-10-05');
    expect(say(basisOf({ window: '1h', venues: ['coinbase', 'binance'], sampleWindows: 600, observedWindows: 580, from: null }).tip, 'en')).toBe('norm: 580 windows with data of 600');
    expect(say(basisOf({ window: '1h', venues: ['coinbase', 'binance'], sampleWindows: 600, observedWindows: 580, from: null }).basis, 'en')).toBe('over 1h · Coinbase, Binance');
  });
  it('every anchor has its own label; none says «к графику»', () => {
    for (const anchor of ['liquidations', 'positioning', 'sentiment', 'flows', 'caps'] as const) {
      const label = say(linkLabel(st({ ruleId: 'R7', block: anchor, key: 'insight.breadth', params: {}, link: { anchor } })));
      expect(label).toMatch(/↓$/);
      expect(label).not.toContain('графику');
    }
  });
  it('the chip colours: liquidations by side, else by block', () => {
    expect(chipOf({ block: 'liquidations', params: { side: 'short' } }).tone).toBe('short');
    expect(chipOf({ block: 'liquidations', params: {} }).tone).toBe('liq');
    expect(['positioning', 'sentiment', 'flows', 'caps'].map((block) => chipOf({ block: block as never, params: {} }).tone)).toEqual(['pos', 'sent', 'flows', 'caps']);
  });
  it('levels (OI, L/S, DVOL, supply) scale over their range; amounts and signed values from zero', () => {
    expect(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'].map(sparkScaleOf))
      .toEqual(['zero', 'zero', 'zero', 'range', 'zero', 'range', 'zero', 'range', 'range', 'zero']);
  });
  it('a payload without the spark field (older server) is no chart, not a crash', () => {
    const { spark: _gone, ...old } = st({ ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike', params: { value: 40, change: 2 } });
    expect(cardView(old as WebInsightStatement, NOW).spark).toBeNull();
  });
  it('raw period codes never render: the «when» is a word', () => {
    const w = whenOf(st({ ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike', params: {} }), NOW);
    expect(say(w)).toBe('за 24ч');
    expect(say(w)).not.toContain('24h');
  });
  it('the title\'s figures are runs of their own (D23), and an absent figure stays text', () => {
    expect(figureRuns('Выносит шорты: $25M за 4ч — 5× обычного', ['$25M', '5×'])).toEqual([
      { text: 'Выносит шорты: ', num: false }, { text: '$25M', num: true }, { text: ' за 4ч — ', num: false }, { text: '5×', num: true }, { text: ' обычного', num: false },
    ]);
    expect(figureRuns('no figures here', ['$1M'])).toEqual([{ text: 'no figures here', num: false }]);
    // TL 2026-11-04: « %» stays in the text face — the digits are the figure
    expect(figureRuns('BNB: открытый интерес −5.1 % при цене +2.5 %', ['−5.1 %', '+2.5 %'])).toEqual([
      { text: 'BNB: открытый интерес ', num: false }, { text: '−5.1', num: true }, { text: ' %', num: false },
      { text: ' при цене ', num: false }, { text: '+2.5', num: true }, { text: ' %', num: false },
    ]);
  });
});

describe('D20: what a number means, never a forecast', () => {
  // the mockup's sentences that were cut: «так часто бывает перед резким движением» and the like
  const FORECAST = [/перед\s/i, /будет/i, /вырастет/i, /упад[её]т/i, /\bwill\b/i, /\bbefore a\b/i, /\busually precedes\b/i];
  it('no card string, in either language, predicts', () => {
    for (const table of [ru, en]) {
      const cards = Object.entries(table).filter(([k]) => k.startsWith('card.'));
      expect(cards.length).toBeGreaterThan(60);
      expect(cards.filter(([, text]) => FORECAST.some((re) => re.test(text))).map(([k]) => k)).toEqual([]);
    }
  });
});
