import { XMLParser } from 'fast-xml-parser';
import { FeedXmlRow } from './ff-feed.mapper';

export interface FeedFetchResult {
  changed: true;
  json: unknown;
  xml: FeedXmlRow[];
  etag: { json: string | null; xml: string | null };
  fetchedAt: number;
}
export interface FeedNotModifiedResult {
  changed: false;
}
export type FeedFetchOutcome = FeedFetchResult | FeedNotModifiedResult;

export interface FeedClient {
  fetch(previousEtag: { json: string | null; xml: string | null }): Promise<FeedFetchOutcome>;
}

const xmlParser = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false });

/** architecture/economic-calendar.md §3.1 step 2 — decode as windows-1252 (the response's declared charset). */
export function parseXmlRows(xmlBuffer: Buffer): FeedXmlRow[] {
  const decoded = new TextDecoder('windows-1252').decode(xmlBuffer);
  const doc = xmlParser.parse(decoded) as { weeklyevents?: { event?: FeedXmlRow | FeedXmlRow[] } };
  const events = doc.weeklyevents?.event ?? [];
  return Array.isArray(events) ? events : [events];
}

/**
 * architecture/economic-calendar.md §3.1, §3.2 — real HTTP client with conditional requests
 * (`If-None-Match` per URL, §1.1's cheap-and-correct weak etag). A `304` on the JSON alone is
 * treated as "nothing to do" — the XML is only ever consulted for `url`/`seriesId`, so a
 * same-JSON snapshot never needs a fresh XML fetch either.
 */
export class FfFeedClient implements FeedClient {
  constructor(private readonly baseUrl: string) {}

  async fetch(previousEtag: { json: string | null; xml: string | null }): Promise<FeedFetchOutcome> {
    const jsonRes = await this.get(`${this.baseUrl}.json`, previousEtag.json);
    if (jsonRes.status === 304) {
      return { changed: false };
    }
    if (!jsonRes.res.ok) {
      throw new Error(`ForexFactory feed JSON request failed: ${jsonRes.res.status} ${jsonRes.res.statusText}`);
    }
    const json = await jsonRes.res.json();
    const jsonEtag = jsonRes.res.headers.get('etag');

    const xmlRes = await this.get(`${this.baseUrl}.xml`, null); // always fetch fresh XML alongside a changed JSON
    if (!xmlRes.res.ok) {
      throw new Error(`ForexFactory feed XML request failed: ${xmlRes.res.status} ${xmlRes.res.statusText}`);
    }
    const xmlBuffer = Buffer.from(await xmlRes.res.arrayBuffer());
    const xmlEtag = xmlRes.res.headers.get('etag');
    const xml = parseXmlRows(xmlBuffer);

    return { changed: true, json, xml, etag: { json: jsonEtag, xml: xmlEtag }, fetchedAt: Date.now() };
  }

  private async get(url: string, etag: string | null): Promise<{ res: Response; status: number }> {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await fetch(url, { headers });
    return { res, status: res.status };
  }
}
