import { WebLiquidationEpisodesResponseSchema, type WebLiquidationEpisode } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-episodes.7d.json';
import {
  coinChips, coinSentence, episodeLink, mergeCoinOptions, episodeMinutes, episodesState, episodeTime, plural, priceFacts, segments, shortNormDays, venueChips,
} from './liq-episodes';

const answer = WebLiquidationEpisodesResponseSchema.parse(fixture);
const [big, open, single] = answer.episodes as [WebLiquidationEpisode, WebLiquidationEpisode, WebLiquidationEpisode];
const coins = (...pairs: Array<[string, number]>) => pairs.map(([base, usd]) => ({ base, symbol: `${base}USDT`, usd }));

describe('IB-134 episode view (E3–E6)', () => {
  describe('the coin sentence', () => {
    it('100 % one coin → «Только X»', () => {
      expect(coinSentence({ usd: 7e6, coins: coins(['ETH', 7e6]) })).toEqual({ key: 'liqEp.coin.only', params: { coin: 'ETH' } });
    });
    it('80 % → «Почти всё — X»', () => {
      expect(coinSentence({ usd: 10e6, coins: coins(['BTC', 8e6], ['ETH', 2e6]) })).toEqual({ key: 'liqEp.coin.almost', params: { coin: 'BTC' } });
    });
    it('79 % → no sentence, the chips speak', () => {
      expect(coinSentence({ usd: 10e6, coins: coins(['BTC', 7.9e6], ['ETH', 2.1e6]) })).toBeNull();
    });
  });

  describe('«за {m} минут»', () => {
    it('a single print is «за 1 минуту», not «за 0»', () => {
      expect(episodeMinutes(single)).toBe(1);
      expect(plural('minutes', episodeMinutes(single))).toEqual({ key: 'liqEp.minutes.one', params: { n: 1 } });
    });
    it('rounds up: 22 min 7 s is 23 minutes', () => {
      expect(big.to - big.from).toBe(1_327);
      expect(episodeMinutes(big)).toBe(23);
    });
    it('Russian forms: 1 one, 3 few, 11 many, 22 few, 25 many', () => {
      expect([1, 3, 11, 22, 25].map((n) => plural('episodes', n).key)).toEqual(
        ['liqEp.episodes.one', 'liqEp.episodes.few', 'liqEp.episodes.many', 'liqEp.episodes.few', 'liqEp.episodes.many']);
    });
  });

  describe('the price, the facts and the link are ONE coin — the largest', () => {
    it('BTC episode: BTC price, BTC link', () => {
      const facts = priceFacts(big)!;
      expect(facts.coin).toBe(big.coins[0].base);
      expect(episodeLink(big).coin).toBe(facts.coin);
      expect(episodeLink(big).link).toEqual({ commands: ['/instrument', big.coins[0].symbol], queryParams: { at: big.from } });
      expect(big.price?.symbol).toBe(big.coins[0].symbol);
    });
    it('an ETH-led episode names ETH in the facts and in the link (E11.2: never BTC under ETH)', () => {
      expect(open.coins[0].base).toBe('ETH');
      expect(priceFacts(open)!.coin).toBe('ETH');
      expect(episodeLink(open).coin).toBe('ETH');
    });
    it('during: open of from → close of to with the move; +4 h against the episode end', () => {
      const p = { ...big.price!, startOpen: 100, endClose: 101.5, after4hClose: 100.69 };
      const f = priceFacts({ coins: big.coins, price: p })!;
      expect(f.during).toEqual({ from: '100.00', to: '101.50', pct: '+1.5 %', tone: 'up' });
      expect(f.after).toEqual({ close: '100.69', pct: '−0.8 %', tone: 'down' });
    });
    it('+4 h not passed → `after` is null («ещё не прошло»)', () => {
      expect(open.price?.after4hClose).toBeNull();
      expect(priceFacts(open)!.after).toBeNull();
    });
    it('no price → no facts (the card says «нет цены»)', () => {
      expect(single.price).toBeNull();
      expect(priceFacts(single)).toBeNull();
    });
  });

  describe('chips', () => {
    it('top 3 coins, then «ещё n»', () => {
      const c = coinChips(big, 'all');
      expect(c.chips.map((x) => x.label.split(' ')[0])).toEqual(big.coins.slice(0, 3).map((x) => x.base));
      expect(c.more).toBe(big.coins.length - 3);
      expect(c.chips.some((x) => x.on)).toBe(false);
    });
    it('a filtered coin is highlighted, and shown even outside the top 3', () => {
      const fifth = big.coins[4];
      const c = coinChips(big, fifth.symbol);
      expect(c.chips.at(-1)).toEqual({ label: expect.stringMatching(new RegExp(`^${fifth.base} `)), on: true });
      expect(c.more).toBe(big.coins.length - 4);
    });
    it('venue chips only when more than one venue took part', () => {
      expect(venueChips(big, 'okx').map((v) => v.label)).toEqual(['Binance 71 %', 'Bybit 18 %', 'OKX 11 %']);
      expect(venueChips(big, 'okx').find((v) => v.on)?.label).toBe('OKX 11 %');
      expect(venueChips(open, 'all')).toEqual([]);
    });
  });

  describe('time', () => {
    const tz = 'UTC';
    it('7d: day and range; a single print one time', () => {
      expect(episodeTime({ from: Date.UTC(2026, 10, 4, 17, 4) / 1000, to: Date.UTC(2026, 10, 4, 17, 13) / 1000 }, true, tz)).toBe('04/11 17:04–17:13');
      expect(episodeTime({ from: Date.UTC(2026, 10, 4, 17, 4) / 1000, to: Date.UTC(2026, 10, 4, 17, 4) / 1000 }, true, tz)).toBe('04/11 17:04');
    });
    it('across midnight the 7d view names both days; 24h shows times only', () => {
      const e = { from: Date.UTC(2026, 10, 4, 23, 58) / 1000, to: Date.UTC(2026, 10, 5, 0, 3) / 1000 };
      expect(episodeTime(e, true, tz)).toBe('04/11 23:58–05/11 00:03');
      expect(episodeTime(e, false, tz)).toBe('23:58–00:03');
    });
  });

  describe('state and norm', () => {
    it('collecting / none / cards', () => {
      expect(episodesState({ norm: { status: 'collecting', collectingHours: 5 }, summary: answer.summary })).toBe('collecting');
      expect(episodesState({ norm: answer.norm, summary: { ...answer.summary, count: 0 } })).toBe('none');
      expect(episodesState(answer)).toBe('cards');
    });
    it('«норма по {d} дн.» only under a week', () => {
      expect(shortNormDays(answer)).toBe(2.5);
      expect(shortNormDays({ norm: { ...answer.norm, heldDays: 7 } as typeof answer.norm })).toBeNull();
    });
  });

  it('segments: a template split at its placeholders, in the language\'s own order', () => {
    expect(segments('{a} x {b}.', { a: 'A', b: 'B' })).toEqual([
      { text: 'A', part: 'a' }, { text: ' x ', part: null }, { text: 'B', part: 'b' }, { text: '.', part: null },
    ]);
  });

  it('coin options accumulate across answers in first-seen order, without duplicates', () => {
    const first = mergeCoinOptions([], [big]);
    expect(first.map((c) => c.base)).toEqual(big.coins.map((c) => c.base));
    const next = mergeCoinOptions(first, [open]);
    expect(next.slice(0, first.length)).toEqual(first);
    expect(new Set(next.map((c) => c.symbol)).size).toBe(next.length);
  });
});
