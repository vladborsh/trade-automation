/**
 * IB-027 — the news sources, each with its own poll interval and what was probed (§10).
 *
 * **Every source here is keyless.** Two that the task named are not in the list, both by a Tech
 * Lead ruling on 2026-09-28:
 *
 * - **CryptoPanic — excluded, not yet.** `GET /api/v1/posts/?public=true` answers **HTTP 403**
 *   (a Cloudflare challenge); their API takes an `auth_token` from a free registration. A
 *   free-tier key carries terms and a rate limit someone has to own, so that is the user's call,
 *   not a developer's. Nothing was registered. It slots in behind `NewsSource` unchanged if a
 *   token ever arrives.
 * - **Coinbase — dropped from scope.** Probed 2026-09-28: `api/v2/assets/search` answers 200 but
 *   is an **asset search, not announcements**, and no keyless Coinbase announcements feed was
 *   found. Recorded so the next reader re-probes rather than assuming we simply missed one; if a
 *   URL turns up it goes in here as a tenth source.
 *
 * **Poll intervals** are set from what each feed actually carries, not from a uniform default.
 * Measured 2026-09-28 (single observation — a note, not a rule, per AGENTS.md; these are item
 * counts rather than a limit anything depends on):
 *
 * | source | items | span | poll |
 * |---|---|---|---|
 * | cointelegraph | 30 | 73.7 h | 5 min |
 * | decrypt | 36 | 96.0 h | 5 min |
 * | theblock | 20 | 80.2 h | 5 min |
 * | sec | 25 | 63 d | 15 min |
 * | cftc | 10 | 24 d | 15 min |
 *
 * A feed holding three days of items cannot lose anything to a five-minute poll; the interval is
 * about latency to a story, not about coverage. SEC and CFTC publish rarely and are polled less
 * often for the same reason.
 */

export type NewsSourceKind = 'rss' | 'json';

export interface NewsSource {
  /** Stable key stored in `raw_news.source`; changing one orphans that source's dedupe history. */
  id: string;
  url: string;
  kind: NewsSourceKind;
  pollMs: number;
  /**
   * CoinDesk and Blockworks answer **308** unless redirects are followed (measured 2026-09-28).
   * A fetch that does not follow them collects nothing from those two and looks healthy doing
   * it, so this is explicit rather than left to a client default.
   */
  followRedirects: boolean;
}

const FAST_POLL_MS = 5 * 60_000;
const SLOW_POLL_MS = 15 * 60_000;

export const NEWS_SOURCES: readonly NewsSource[] = [
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', kind: 'rss', pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss', kind: 'rss', pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'decrypt', url: 'https://decrypt.co/feed', kind: 'rss', pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'theblock', url: 'https://www.theblock.co/rss.xml', kind: 'rss', pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'blockworks', url: 'https://blockworks.co/feed', kind: 'rss', pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'sec', url: 'https://www.sec.gov/news/pressreleases.rss', kind: 'rss', pollMs: SLOW_POLL_MS, followRedirects: true },
  { id: 'cftc', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml', kind: 'rss', pollMs: SLOW_POLL_MS, followRedirects: true },
  // Exchange announcements — listings and delistings, which move a single asset hard.
  {
    id: 'binance-announcements',
    url: 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20',
    kind: 'json',
    pollMs: FAST_POLL_MS,
    followRedirects: true,
  },
  { id: 'okx-announcements', url: 'https://www.okx.com/api/v5/support/announcements', kind: 'json', pollMs: FAST_POLL_MS, followRedirects: true },
  {
    id: 'bybit-announcements',
    url: 'https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20',
    kind: 'json',
    pollMs: FAST_POLL_MS,
    followRedirects: true,
  },
];

/** Sources whose ids must stay stable, asserted by a spec so a rename is a deliberate act. */
export const NEWS_SOURCE_IDS = NEWS_SOURCES.map((s) => s.id);
