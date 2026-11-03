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
 * - **CFTC — dropped 2026-10-12, after the live pass.** `RSS/RSSGP/rssgp.xml` answers **HTTP 403 to
 *   Node and HTTP 200 to `curl` with byte-identical headers**; neither the User-Agent, the Accept
 *   header nor the HTTP version changes it, and Node's `https` module is refused too. That leaves
 *   the TLS fingerprint: a deliberate client block. Getting past it would mean disguising what we
 *   are, which is not authorised and not something a market-data bot should do to a regulator's
 *   site. Nine sources that work beat ten with one pretending. If CFTC matters later the answer is
 *   an official feed or API, not a disguise.
 * - **Blockworks — dropped 2026-10-12, after the live pass.** `blockworks.co/feed` serves 50
 *   entries whose newest is **2026-01-07**, about nine months old. Checked against the raw payload
 *   rather than assumed: the feed is ordered newest-first, `published` equals `updated`, and there
 *   is no newer date field — so this is the source, not our parsing. Our committed fixture records
 *   the same January dates, which is the trap inverted: an accurate fixture of a dead feed. A
 *   source whose newest item is nine months old contributes nothing but noise to the confounder
 *   counts. If Blockworks publishes a working feed later, it slots back in unchanged.
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

/**
 * How a source answers, which decides what an EMPTY response means.
 *
 * - `window` — the response is "the last N items", served regardless of recency. An empty body is
 *   therefore broken: the feed cannot legitimately have nothing in it, and treating it as "nothing
 *   published" would record a confident zero.
 * - `time-filtered` — the response is "items since T". Empty is the CORRECT answer on a quiet
 *   weekend, and treating it as a failure would back a legitimately quiet source off and lose it
 *   for being quiet — the mirror of the first bug, and just as silent.
 *
 * All ten sources today are `window` (fixed URLs, no time parameter), so one rule would currently
 * be right — by coincidence of the source list, not by design. Declared per source so the first
 * time-filtered one cannot inherit the wrong rule without someone choosing it.
 */
export type NewsSourceShape = 'window' | 'time-filtered';

export interface NewsSource {
  /** Stable key stored in `raw_news.source`; changing one orphans that source's dedupe history. */
  id: string;
  url: string;
  kind: NewsSourceKind;
  /** What an empty response means. See `NewsSourceShape`. */
  shape: NewsSourceShape;
  /**
   * How old the NEWEST item a healthy version of this source serves may be, in hours.
   *
   * The third source state, after "answers" and "answers empty": **answers, with nothing new.**
   * Blockworks serves content nine months old and looks perfectly healthy doing it — 50 articles
   * every poll, parsed cleanly, none of it news. A dead source contributing old articles is worse
   * than one contributing nothing, because nothing about the response says so.
   *
   * Exceeding this is reported as a NUMBER (the measured age), not a boolean: "newest item is 288
   * days old" is actionable, "stale: true" is not. These are expectations about publishing cadence,
   * set from the live pass of 2026-10-12 with slack — a news site quiet for two days is a finding,
   * an announcements feed quiet for a fortnight is not.
   */
  maxNewestAgeHours: number;
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
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', kind: 'rss', shape: 'window', maxNewestAgeHours: 48, pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss', kind: 'rss', shape: 'window', maxNewestAgeHours: 48, pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'decrypt', url: 'https://decrypt.co/feed', kind: 'rss', shape: 'window', maxNewestAgeHours: 48, pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'theblock', url: 'https://www.theblock.co/rss.xml', kind: 'rss', shape: 'window', maxNewestAgeHours: 48, pollMs: FAST_POLL_MS, followRedirects: true },
  { id: 'sec', url: 'https://www.sec.gov/news/pressreleases.rss', kind: 'rss', shape: 'window', maxNewestAgeHours: 336, pollMs: SLOW_POLL_MS, followRedirects: true },
  // Exchange announcements — listings and delistings, which move a single asset hard.
  {
    id: 'binance-announcements',
    url: 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20',
    kind: 'json',
    shape: 'window',
    maxNewestAgeHours: 336,
    pollMs: FAST_POLL_MS,
    followRedirects: true,
  },
  { id: 'okx-announcements', url: 'https://www.okx.com/api/v5/support/announcements', kind: 'json', shape: 'window', maxNewestAgeHours: 336, pollMs: FAST_POLL_MS, followRedirects: true },
  {
    id: 'bybit-announcements',
    url: 'https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20',
    kind: 'json',
    shape: 'window',
    maxNewestAgeHours: 336,
    pollMs: FAST_POLL_MS,
    followRedirects: true,
  },
];

/** Sources whose ids must stay stable, asserted by a spec so a rename is a deliberate act. */
export const NEWS_SOURCE_IDS = NEWS_SOURCES.map((s) => s.id);
