import { createHash } from 'crypto';

/**
 * IB-027 — normalisation and hashing, the base of both dedupe layers (§10). Pure, so every rule
 * below is a spec rather than something inferred from a live feed.
 *
 * The two layers answer different questions:
 * - **exact** (`urlHash`, `titleHash`): is this the *same item* we already stored? Re-reading a
 *   feed every few minutes means we see each article dozens of times.
 * - **near-duplicate** (`clusterTitle` + trigram similarity): is this the *same story* another
 *   outlet also carried? That is `news_clusters.confirmations`, and one outlet reporting is a
 *   very different thing from five.
 */

/**
 * Tracking parameters strip so the same article shared through two campaigns hashes once.
 * Deliberately a deny-list, not an allow-list: an unknown query parameter is far more likely to
 * be meaningful (an article id, a page) than tracking, and dropping a meaningful one would
 * collapse two genuinely different articles into one — the expensive direction of this error.
 */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_(cid|eid)$/i,
  /^ref$/i,
  /^source$/i,
  /^__twitter_impression$/i,
];

/** `https://Example.com/A/?utm_source=x#frag` → `example.com/a` */
export function normaliseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // Not a URL at all — hash the trimmed text so the caller still gets a stable key rather than
    // an exception in the middle of a poll.
    return raw.trim().toLowerCase();
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((p) => p.test(key))) url.searchParams.delete(key);
  }
  url.hash = '';
  url.protocol = 'https:'; // http/https for the same article is the same article
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  // A trailing slash is not a different page.
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = url.searchParams.toString();
  return `${url.hostname}${path}${query ? `?${query}` : ''}`;
}

/**
 * The title reduced to what two outlets would share: lower case, no punctuation, collapsed
 * whitespace, and no outlet suffix (" - CoinDesk", " | The Block").
 *
 * Accents are folded and non-Latin scripts are left alone rather than stripped: a Cyrillic or
 * CJK headline must still hash and still compare, and stripping it would make every such
 * headline hash to the empty string — silently clustering all of them together.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin combining marks only, so "Café" and "Cafe" agree
    // Re-compose. NFKD also splits Japanese dakuten (ビ -> ヒ + U+3099), which is NOT in the
    // Latin range above, so it survived to the punctuation strip below and was deleted —
    // silently turning ビ into ヒ and が into か. Caught by this file's own spec. NFC rejoins
    // them while leaving the Latin accents dropped, which is what the fold is for.
    .normalize('NFC')
    .replace(/\s+[-|–—]\s+[^-|–—]{1,30}$/u, '') // a trailing " - Outlet" / " | Outlet"
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation out, letters and numbers in any script kept
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function urlHash(raw: string): string {
  return sha256(normaliseUrl(raw));
}

export function titleHash(raw: string): string {
  return sha256(normaliseTitle(raw));
}

/** `<source>:<url_hash>` — the `raw_news` primary key, scoped so two sources can carry one URL. */
export function newsId(source: string, url: string): string {
  return `${source}:${urlHash(url)}`;
}
