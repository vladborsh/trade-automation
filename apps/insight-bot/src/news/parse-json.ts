import { newsId, titleHash, urlHash } from './normalise';
import { NewsItem, ParseResult, parseDate } from './parse';

/**
 * IB-027 — the three exchange announcement APIs (§10). Each has its own shape, confirmed live on
 * 2026-09-28 and kept verbatim in `test/fixtures/news/`; a changed shape fails those specs,
 * which is the guard AGENTS.md prefers over re-probing.
 *
 * The one that will surprise a reader:
 *
 * **Binance sends no URL.** An article is `{id, code, title, type, releaseDate}` and the page
 * lives at `https://www.binance.com/en/support/announcement/<code>` — built here, from `code`,
 * not from `id`. Using `id` produces a 404, and since nothing downstream fetches the page the
 * mistake would sit in the database unnoticed until someone clicked a link.
 */

const BINANCE_ARTICLE_BASE = 'https://www.binance.com/en/support/announcement';

function item(
  source: string,
  url: string,
  title: string,
  body: string | null,
  published: Date | null,
  skipped: ParseResult['skipped'],
): NewsItem | null {
  if (url.length === 0 || title.length === 0) {
    skipped.push({ reason: url.length === 0 ? 'no url' : 'no title', sample: (title || url).slice(0, 80) });
    return null;
  }
  if (published === null) {
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

/**
 * `www.binance.com/bapi/composite/v1/public/cms/article/list/query` — articles nested under
 * `data.catalogs[].articles[]`, and catalogs can nest further, so this walks them.
 */
export function parseBinanceAnnouncements(source: string, body: string): ParseResult {
  const skipped: ParseResult['skipped'] = [];
  const items: NewsItem[] = [];
  let payload: { data?: { catalogs?: unknown[] } };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch (err) {
    return { items: [], skipped: [{ reason: `unparseable json: ${(err as Error).message}`, sample: body.slice(0, 80) }] };
  }

  const walk = (catalogs: unknown[]): void => {
    for (const raw of catalogs) {
      const catalog = raw as { articles?: unknown[]; catalogs?: unknown[] };
      for (const a of catalog.articles ?? []) {
        const article = a as { code?: string; title?: string; releaseDate?: number };
        const code = String(article.code ?? '');
        items.push(
          ...([
            item(
              source,
              code.length > 0 ? `${BINANCE_ARTICLE_BASE}/${code}` : '',
              String(article.title ?? '').trim(),
              null,
              parseDate(String(article.releaseDate ?? '')),
              skipped,
            ),
          ].filter((x): x is NewsItem => x !== null)),
        );
      }
      if (catalog.catalogs?.length) walk(catalog.catalogs);
    }
  };
  walk(payload.data?.catalogs ?? []);
  return { items, skipped };
}

/** `okx.com/api/v5/support/announcements` — `data[].details[]`, `pTime` is epoch ms as a string. */
export function parseOkxAnnouncements(source: string, body: string): ParseResult {
  const skipped: ParseResult['skipped'] = [];
  const items: NewsItem[] = [];
  let payload: { code?: string; msg?: string; data?: Array<{ details?: unknown[] }> };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch (err) {
    return { items: [], skipped: [{ reason: `unparseable json: ${(err as Error).message}`, sample: body.slice(0, 80) }] };
  }
  if (payload.code !== undefined && payload.code !== '0') {
    // OKX reports application errors in the body, not the status line (as its REST client notes).
    return { items: [], skipped: [{ reason: `okx code ${payload.code}: ${payload.msg ?? ''}`.trim(), sample: '' }] };
  }

  for (const group of payload.data ?? []) {
    for (const d of group.details ?? []) {
      const detail = d as { title?: string; url?: string; pTime?: string };
      const built = item(source, String(detail.url ?? ''), String(detail.title ?? '').trim(), null, parseDate(String(detail.pTime ?? '')), skipped);
      if (built !== null) items.push(built);
    }
  }
  return { items, skipped };
}

/**
 * `api.bybit.com/v5/announcements/index` — `result.list[]`, with both `dateTimestamp` and
 * `publishTime`. **`publishTime` is the one used**: `dateTimestamp` is the campaign's own start
 * date (it equals `startDateTimestamp` on every sampled row) and is often a day earlier than
 * publication, which would put the reaction window before the news existed.
 */
export function parseBybitAnnouncements(source: string, body: string): ParseResult {
  const skipped: ParseResult['skipped'] = [];
  const items: NewsItem[] = [];
  let payload: { retCode?: number; retMsg?: string; result?: { list?: unknown[] } };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch (err) {
    return { items: [], skipped: [{ reason: `unparseable json: ${(err as Error).message}`, sample: body.slice(0, 80) }] };
  }
  if (payload.retCode !== undefined && payload.retCode !== 0) {
    return { items: [], skipped: [{ reason: `bybit retCode ${payload.retCode}: ${payload.retMsg ?? ''}`.trim(), sample: '' }] };
  }

  for (const raw of payload.result?.list ?? []) {
    const entry = raw as { title?: string; description?: string; url?: string; publishTime?: number; dateTimestamp?: number };
    const built = item(
      source,
      String(entry.url ?? ''),
      String(entry.title ?? '').trim(),
      typeof entry.description === 'string' ? entry.description.trim() : null,
      parseDate(String(entry.publishTime ?? entry.dateTimestamp ?? '')),
      skipped,
    );
    if (built !== null) items.push(built);
  }
  return { items, skipped };
}

/** Dispatch by source id — the registry says which parser a source uses. */
export const JSON_PARSERS: Record<string, (source: string, body: string) => ParseResult> = {
  'binance-announcements': parseBinanceAnnouncements,
  'okx-announcements': parseOkxAnnouncements,
  'bybit-announcements': parseBybitAnnouncements,
};
