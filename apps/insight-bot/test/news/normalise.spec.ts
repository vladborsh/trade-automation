import { newsId, normaliseTitle, normaliseUrl, titleHash, urlHash } from '../../src/news/normalise';

describe('normaliseUrl', () => {
  it('collapses the variations that are the same article', () => {
    const canonical = 'coindesk.com/markets/2026/09/28/btc-rallies';
    for (const variant of [
      'https://www.coindesk.com/markets/2026/09/28/btc-rallies',
      'http://coindesk.com/markets/2026/09/28/btc-rallies',
      'https://CoinDesk.com/markets/2026/09/28/btc-rallies/',
      'https://www.coindesk.com/markets/2026/09/28/btc-rallies#top',
      'https://www.coindesk.com/markets/2026/09/28/btc-rallies?utm_source=twitter&utm_medium=social',
      '  https://www.coindesk.com/markets/2026/09/28/btc-rallies  ',
    ]) {
      expect(normaliseUrl(variant)).toBe(canonical);
    }
  });

  it('keeps an unknown query parameter, because dropping a meaningful one merges two articles', () => {
    // The expensive direction of this error: an allow-list would silently collapse ?id=1 and
    // ?id=2 into one row. A deny-list only ever fails to collapse, which the trigram layer sees.
    expect(normaliseUrl('https://site.com/a?id=1')).toBe('site.com/a?id=1');
    expect(normaliseUrl('https://site.com/a?id=1')).not.toBe(normaliseUrl('https://site.com/a?id=2'));
    expect(normaliseUrl('https://site.com/a?page=2&utm_source=x')).toBe('site.com/a?page=2');
  });

  it('does not throw on something that is not a URL', () => {
    expect(normaliseUrl('  NOT A URL  ')).toBe('not a url');
  });

  it('distinguishes different paths on one host', () => {
    expect(normaliseUrl('https://a.com/one')).not.toBe(normaliseUrl('https://a.com/two'));
  });
});

describe('normaliseTitle', () => {
  it('reduces a headline to what two outlets would share', () => {
    expect(normaliseTitle('Bitcoin Rallies 5%, Traders Say — CoinDesk')).toBe('bitcoin rallies 5 traders say');
    expect(normaliseTitle('  BITCOIN   rallies 5%,  traders say!  ')).toBe('bitcoin rallies 5 traders say');
  });

  it('strips a trailing outlet suffix but not a real trailing clause', () => {
    expect(normaliseTitle('SEC Sues Firm | The Block')).toBe('sec sues firm');
    // Long enough not to look like an outlet name: kept.
    expect(normaliseTitle('SEC Sues Firm - and the market barely moved at all today')).toContain('market barely moved');
  });

  it('folds accents so Café and Cafe agree', () => {
    expect(normaliseTitle('Café opens')).toBe(normaliseTitle('Cafe opens'));
  });

  it('keeps non-Latin scripts instead of hashing them all to nothing', () => {
    // Stripping non-Latin would make every Cyrillic/CJK headline normalise to '' and cluster
    // together — a silent, total merge.
    expect(normaliseTitle('Биткоин вырос на 5%')).toBe('биткоин вырос на 5');
    expect(normaliseTitle('ビットコインが上昇')).toBe('ビットコインが上昇');
    expect(normaliseTitle('Биткоин вырос')).not.toBe(normaliseTitle('ビットコインが上昇'));
    expect(normaliseTitle('Биткоин вырос')).not.toBe('');
  });

  it('is stable under punctuation and spacing noise', () => {
    expect(normaliseTitle('Fed: rates "unchanged" (again)')).toBe(normaliseTitle('Fed rates unchanged again'));
  });
});

describe('hashes and ids', () => {
  it('hashes the normalised value, so cosmetic variants share a hash', () => {
    expect(urlHash('https://www.a.com/x?utm_source=q')).toBe(urlHash('http://a.com/x/'));
    expect(titleHash('Bitcoin Rallies — CoinDesk')).toBe(titleHash('bitcoin rallies'));
  });

  it('gives different hashes to genuinely different items', () => {
    expect(urlHash('https://a.com/one')).not.toBe(urlHash('https://a.com/two'));
    expect(titleHash('Bitcoin rallies')).not.toBe(titleHash('Ethereum rallies'));
  });

  it('scopes the id by source, so two outlets carrying one URL are two rows', () => {
    expect(newsId('coindesk', 'https://a.com/x')).not.toBe(newsId('theblock', 'https://a.com/x'));
    expect(newsId('coindesk', 'https://a.com/x')).toBe(newsId('coindesk', 'https://www.a.com/x/'));
  });

  it('produces a sha256 hex digest', () => {
    expect(urlHash('https://a.com')).toMatch(/^[0-9a-f]{64}$/);
  });
});
