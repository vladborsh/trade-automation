import { AMBIGUOUS_TERMS, buildDictionary, matchAssets, nameFromCoingeckoId } from '../../src/news/assets';

/**
 * IB-027 — which symbols a story might be about.
 *
 * The tests that matter are the FALSE ones. This feeds `news_reactions`, which measures each tagged
 * symbol's 15m/1h/4h return, so a wrong tag does not add noise to a list — it records a price move
 * as a reaction to a story that never mentioned the asset, and that becomes evidence AI-1 is later
 * calibrated on. Recall is cheap to fix later; a false reaction is indistinguishable from a real one.
 */

const UNIVERSE = [
  { id: 'BTCUSDT', base: 'BTC', coingecko_id: 'bitcoin' },
  { id: 'ETHUSDT', base: 'ETH', coingecko_id: 'ethereum' },
  { id: 'BCHUSDT', base: 'BCH', coingecko_id: 'bitcoin-cash' },
  { id: 'AVAXUSDT', base: 'AVAX', coingecko_id: 'avalanche-2' },
  { id: 'ARBUSDT', base: 'ARB', coingecko_id: 'arbitrum' },
  { id: 'NEARUSDT', base: 'NEAR', coingecko_id: 'near' },
  { id: 'ONEUSDT', base: 'ONE', coingecko_id: 'harmony' },
  { id: 'TRUMPUSDT', base: 'TRUMP', coingecko_id: 'official-trump' },
  { id: 'LINKUSDT', base: 'LINK', coingecko_id: 'chainlink' },
  { id: '1000PEPEUSDT', base: 'PEPE', coingecko_id: 'pepe' },
];
const DICT = buildDictionary(UNIVERSE);
const symbolsIn = (text: string) => matchAssets(text, DICT).map((m) => m.symbol).sort();

describe('tickers that are ordinary words must not match bare', () => {
  it('does not tag NEAR from the word "near"', () => {
    expect(symbolsIn('The fund closed near its all-time high this week')).toEqual([]);
  });

  it('does not tag ONE from the word "one"', () => {
    expect(symbolsIn('Only one exchange reported an outage')).toEqual([]);
  });

  it('does not tag TRUMP from political coverage', () => {
    // the worst case in the current universe: a surname in the news several times a day that is
    // also a token. Tagging it would attach a token's price move to unrelated political news.
    expect(symbolsIn('Trump announces new tariffs on imported steel')).toEqual([]);
    expect(symbolsIn('President Trump signs the executive order')).toEqual([]);
  });

  it('does not tag ARB, LINK or PEPE from ordinary prose', () => {
    expect(symbolsIn('Traders arb the spread between venues')).toEqual([]);
    expect(symbolsIn('The report includes a link to the filing')).toEqual([]);
  });

  it('DOES tag them on a cashtag, which nobody writes by accident', () => {
    expect(symbolsIn('$TRUMP rallies 40% after the listing')).toEqual(['TRUMPUSDT']);
    expect(symbolsIn('$NEAR and $ONE both gained')).toEqual(['NEARUSDT', 'ONEUSDT']);
  });

  it('DOES tag them on the coin name', () => {
    expect(symbolsIn('Chainlink announces a new oracle partnership')).toEqual(['LINKUSDT']);
    expect(symbolsIn('Arbitrum sequencer halted for two hours')).toEqual(['ARBUSDT']);
    expect(symbolsIn('Official Trump memecoin sees record volume')).toEqual(['TRUMPUSDT']);
  });
});

describe('unambiguous tickers', () => {
  it('matches a bare upper-case ticker', () => {
    expect(symbolsIn('BTC fell 3% on the open')).toEqual(['BTCUSDT']);
  });

  it('does not match it lower-cased in prose', () => {
    // "btc" in running text is as likely to be sloppy prose as a ticker; the name catches the
    // real cases
    expect(symbolsIn('the btc of it all')).toEqual([]);
  });

  it('does not match a ticker glued inside another word', () => {
    expect(symbolsIn('BTCUSDT perpetual funding turned negative')).toEqual([]);
    expect(symbolsIn('Visit ETHGlobal next month')).toEqual([]);
  });

  it('matches the name case-insensitively and across its hyphen', () => {
    expect(symbolsIn('Bitcoin Cash sees a hashrate drop')).toEqual(['BCHUSDT']);
    expect(symbolsIn('avalanche subnets expand')).toEqual(['AVAXUSDT']);
  });
});

describe('text that is entirely upper case', () => {
  it('does not use bare tickers, because every word looks like one', () => {
    // the upper-case requirement is what separates a ticker from a word; in a shouted headline it
    // carries no information at all
    expect(symbolsIn('SEC CHARGES FIRM OVER ONE MILLION IN LOSSES')).toEqual([]);
    expect(symbolsIn('REGULATOR SAYS LINK BETWEEN THE TWO FIRMS IS CLEAR')).toEqual([]);
  });

  it('still honours a cashtag and a name in shouted text', () => {
    expect(symbolsIn('BREAKING: $BTC BREAKS 100K')).toEqual(['BTCUSDT']);
    expect(symbolsIn('ETHEREUM FOUNDATION ANNOUNCES ROADMAP')).toEqual(['ETHUSDT']);
  });
});

describe('the evidence is recorded, so a tag can be audited', () => {
  it('says what matched, and prefers the strongest evidence', () => {
    expect(matchAssets('$BTC and bitcoin and BTC', DICT)).toEqual([{ symbol: 'BTCUSDT', matched: '$BTC' }]);
    expect(matchAssets('bitcoin rallied', DICT)).toEqual([{ symbol: 'BTCUSDT', matched: 'bitcoin' }]);
    expect(matchAssets('BTC rallied', DICT)).toEqual([{ symbol: 'BTCUSDT', matched: 'BTC' }]);
  });

  it('tags a symbol at most once however many times it appears', () => {
    expect(matchAssets('BTC BTC BTC bitcoin $BTC', DICT)).toHaveLength(1);
  });
});

describe('the dictionary', () => {
  it('turns a coingecko id into words and drops its disambiguating number', () => {
    expect(nameFromCoingeckoId('bitcoin-cash')).toBe('bitcoin cash');
    expect(nameFromCoingeckoId('avalanche-2')).toBe('avalanche');
    expect(nameFromCoingeckoId(null)).toBeNull();
    expect(nameFromCoingeckoId(undefined)).toBeNull();
  });

  it('still matches a symbol with no coingecko id, by ticker alone', () => {
    const dict = buildDictionary([{ id: 'QNTUSDT', base: 'QNT', coingecko_id: null }]);
    expect(matchAssets('QNT led the majors', dict)).toEqual([{ symbol: 'QNTUSDT', matched: 'QNT' }]);
  });

  it('pins the word-like tickers in the current universe, since a missing one fails OPEN', () => {
    // a ticker absent from AMBIGUOUS_BASES matches on its bare form, so the failure direction is
    // false tags. universe.yaml is revised by hand monthly; this is the reminder.
    for (const term of ['one', 'near', 'link', 'arb', 'dash', 'hype', 'pump', 'uni', 'sol', 'tao', 'trump']) {
      expect(AMBIGUOUS_TERMS.has(term)).toBe(true);
    }
    // and the NAMES that are ordinary words, which is the half I missed first time
    for (const term of ['near', 'harmony']) {
      expect(AMBIGUOUS_TERMS.has(term)).toBe(true);
    }
  });

  it('claims nothing for empty text', () => {
    expect(matchAssets('', DICT)).toEqual([]);
    expect(matchAssets('   ', DICT)).toEqual([]);
  });
});
