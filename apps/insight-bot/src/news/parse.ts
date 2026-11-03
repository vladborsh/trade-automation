import { XMLParser } from 'fast-xml-parser';
import { newsId, titleHash, urlHash } from './normalise';

/** One article, source-agnostic, ready for `raw_news`. */
export interface NewsItem {
  id: string;
  source: string;
  url: string;
  title: string;
  body: string | null;
  publishedAt: Date;
  urlHash: string;
  titleHash: string;
}

/**
 * IB-027 — feed parsing (§10). Pure: bytes in, items out, so every shape below is spec'd against
 * a recorded fixture rather than against a live feed that changes under the test.
 *
 * Three shapes are handled because the sources genuinely use three:
 * - **RSS 2.0** `<item>` with `<pubDate>` (CoinDesk, Cointelegraph, Decrypt, The Block, SEC, CFTC)
 * - **Atom** `<entry>` with `<published>`/`<updated>` (Blockworks)
 * - **JSON** announcement APIs, one per exchange (Binance, OKX, Bybit)
 *
 * An item missing a URL, a title or a usable date is **dropped with a reason**, never stored with
 * a fabricated stamp: `published_at` drives the reaction window, so a guessed date would produce
 * a confidently wrong return measurement.
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

export interface ParseResult {
  items: NewsItem[];
  /** Entries the parser refused, with why — surfaced so a feed that changes shape is visible. */
  skipped: Array<{ reason: string; sample: string }>;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  // fast-xml-parser gives `{ '#text': ... }` for an element with attributes.
  const node = value as { '#text'?: unknown };
  return node['#text'] !== undefined ? text(node['#text']) : '';
}

/** Parses a date the way each feed writes it; returns null rather than an Invalid Date. */
export function parseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms)) return new Date(ms);
  // Some APIs send epoch milliseconds as a string or number.
  const epoch = Number(trimmed);
  if (Number.isFinite(epoch) && epoch > 1_000_000_000_000) return new Date(epoch);
  if (Number.isFinite(epoch) && epoch > 1_000_000_000) return new Date(epoch * 1000);
  return null;
}

function build(source: string, url: string, title: string, body: string | null, published: Date | null, skipped: ParseResult['skipped']): NewsItem | null {
  if (url.length === 0) {
    skipped.push({ reason: 'no url', sample: title.slice(0, 80) });
    return null;
  }
  if (title.length === 0) {
    skipped.push({ reason: 'no title', sample: url.slice(0, 80) });
    return null;
  }
  if (published === null) {
    // Never substituted with `now`: published_at drives the reaction window, and a guessed stamp
    // yields a confidently wrong return rather than an absent one.
    skipped.push({ reason: 'no usable published date', sample: title.slice(0, 80) });
    return null;
  }
  return {
    id: newsId(source, url),
    source,
    url,
    title,
    body: body && body.length > 0 ? body : null,
    publishedAt: published,
    urlHash: urlHash(url),
    titleHash: titleHash(title),
  };
}

/** RSS 2.0 and Atom, which differ enough in element names to be worth one function each way. */
export function parseFeed(source: string, xml: string): ParseResult {
  const skipped: ParseResult['skipped'] = [];
  const items: NewsItem[] = [];
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    return { items: [], skipped: [{ reason: `unparseable xml: ${(err as Error).message}`, sample: xml.slice(0, 80) }] };
  }

  const rss = (doc as { rss?: { channel?: { item?: unknown } } }).rss;
  for (const raw of asArray(rss?.channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const item = build(
      source,
      text(raw.link),
      text(raw.title),
      text(raw.description) || text(raw['content:encoded']),
      parseDate(text(raw.pubDate) || text(raw['dc:date'])),
      skipped,
    );
    if (item !== null) items.push(item);
  }

  const feed = (doc as { feed?: { entry?: unknown } }).feed;
  for (const raw of asArray(feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    // Atom puts the URL in <link href="...">, sometimes as several links with rel attributes.
    const links = asArray(raw.link as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const alternate = links.find((l) => (l as { '@_rel'?: string })['@_rel'] === undefined || (l as { '@_rel'?: string })['@_rel'] === 'alternate');
    const href = text((alternate as { '@_href'?: unknown } | undefined)?.['@_href']) || text(raw.link);
    const item = build(
      source,
      href,
      text(raw.title),
      text(raw.summary) || text(raw.content),
      parseDate(text(raw.published) || text(raw.updated)),
      skipped,
    );
    if (item !== null) items.push(item);
  }

  return { items, skipped };
}
