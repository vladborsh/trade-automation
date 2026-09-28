import * as crypto from 'crypto';
import { z } from 'zod';
import { EconomicEvent, EventImpact, eventDayNY } from '@trade-automation/contracts';

/** architecture/economic-calendar.md §1.2 — the bare JSON array row; extra keys (a future `actual`) allowed. */
export const FeedJsonRowSchema = z
  .object({
    title: z.string(),
    country: z.string(),
    date: z.string(),
    impact: z.string(),
    forecast: z.string(),
    previous: z.string(),
    actual: z.string().optional(),
  })
  .passthrough();
export type FeedJsonRow = z.infer<typeof FeedJsonRowSchema>;
export const FeedJsonSchema = z.array(FeedJsonRowSchema);

/** The XML/CSV row shape (§1.2, §3.1) — same six data fields plus `url`, `time` instead of an offset `date`. */
export interface FeedXmlRow {
  title: string;
  country: string;
  date: string; // MM-DD-YYYY
  time: string; // 'h:mmam/pm', 'All Day', 'Tentative', ...
  impact: string;
  forecast: string;
  previous: string;
  url: string;
}

/** Draft produced by the mapper, before diffing against the store (§3.1, §3.3). */
export interface MappedEventDraft {
  id: string;
  seriesId: string | null;
  sourceUrl: string | null;
  title: string;
  country: string;
  impact: EventImpact;
  scheduledAt: number;
  scheduledDay: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  actualSource: EconomicEvent['actualSource'];
}

const SERIES_ID_RE = /\/calendar\/(\d+)-/;

function normalizeImpact(raw: string): EventImpact {
  const lowered = raw.trim().toLowerCase();
  if (lowered === 'low' || lowered === 'medium' || lowered === 'high' || lowered === 'holiday') return lowered;
  return 'unknown';
}

function emptyToNull(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  return raw.trim().length === 0 ? null : raw;
}

/**
 * The XML instant, read as UTC (§1.2: "the XML/CSV time column ... is the same instant rendered
 * in UTC"). Returns null for non-clock-time values like 'All Day'/'Tentative' (§3.1 step 3) so
 * the caller falls through to the positional join.
 */
export function xmlInstantUtc(dateMmDdYyyy: string, time: string): number | null {
  const dateMatch = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateMmDdYyyy.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})(am|pm)$/i.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;

  const [, mm, dd, yyyy] = dateMatch;
  let [, hh, min, ampm] = timeMatch;
  let hour = Number(hh) % 12;
  if (ampm.toLowerCase() === 'pm') hour += 12;

  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hour, Number(min), 0);
}

function seriesIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = SERIES_ID_RE.exec(url);
  return match ? match[1] : null;
}

/**
 * Pure mapping: (jsonRows, xmlRows) -> event drafts (architecture/economic-calendar.md §3.1).
 * Join is tried positionally first (true for every row observed on 2026-09-16), then by
 * (title, country, UTC instant); a total join failure produces a `null` sourceUrl/seriesId and
 * the caller assigns the `ffx:` synthetic id (§2.2) — this function never throws on an unjoined
 * row.
 */
export function mapFeedSnapshot(jsonRows: unknown, xmlRows: FeedXmlRow[]): MappedEventDraft[] {
  const rows = FeedJsonSchema.parse(jsonRows);

  // Index the XML rows for the instant-based fallback join.
  const xmlByKey = new Map<string, FeedXmlRow[]>();
  for (const x of xmlRows) {
    const key = `${x.title}|${x.country}`;
    const list = xmlByKey.get(key) ?? [];
    list.push(x);
    xmlByKey.set(key, list);
  }

  return rows.map((row, i) => {
    const scheduledAt = Date.parse(row.date);
    let matchedXml: FeedXmlRow | undefined;

    const positional = xmlRows[i];
    if (positional && positional.title === row.title && positional.country === row.country) {
      matchedXml = positional;
    } else {
      const candidates = xmlByKey.get(`${row.title}|${row.country}`) ?? [];
      matchedXml = candidates.find((x) => xmlInstantUtc(x.date, x.time) === scheduledAt);
    }

    const sourceUrl = matchedXml?.url ?? null;
    const seriesId = seriesIdFromUrl(sourceUrl);
    const scheduledDay = eventDayNY(scheduledAt);
    const id = seriesId !== null ? `ff:${seriesId}:${scheduledDay}` : `ffx:${sha1EventKey(row.title, row.country, scheduledDay)}`;

    const actual = emptyToNull(row.actual);

    return {
      id,
      seriesId,
      sourceUrl,
      title: row.title,
      country: row.country,
      impact: normalizeImpact(row.impact),
      scheduledAt,
      scheduledDay,
      forecast: emptyToNull(row.forecast),
      previous: emptyToNull(row.previous),
      actual,
      actualSource: actual !== null ? 'feed' : null,
    };
  });
}

function sha1EventKey(title: string, country: string, scheduledDay: string): string {
  return crypto.createHash('sha1').update(`${title}|${country}|${scheduledDay}`).digest('hex');
}
