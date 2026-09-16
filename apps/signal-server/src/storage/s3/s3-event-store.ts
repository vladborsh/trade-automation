import * as zlib from 'zlib';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CalendarNotification, EconomicEvent, EventRevision, eventDayNY } from '@trade-automation/contracts';
import { EventStore } from '../event-store.port';

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * architecture/economic-calendar.md §4.2–4.3, base §6.4: identical relative key family to
 * `S3MetricStore`, gzip-compressed JSONL, under a `calendar/` prefix. Reuses the already-pinned
 * S3 bucket/IAM (live-signal-server-infra.md §1) — no infra change.
 */
export class S3EventStore implements EventStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  private utcDayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  private eventsKey(scheduledDay: string): string {
    return `calendar/events/date=${scheduledDay}.jsonl.gz`;
  }

  private revisionsKey(pollUtcDay: string): string {
    return `calendar/revisions/date=${pollUtcDay}.jsonl.gz`;
  }

  private notificationsKey(firedUtcDay: string): string {
    return `calendar/notifications/date=${firedUtcDay}.jsonl.gz`;
  }

  private async getJsonl<T>(key: string): Promise<T[]> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const gz = await streamToBuffer(res.Body);
      const jsonl = zlib.gunzipSync(gz).toString('utf8');
      return jsonl
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as T);
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return [];
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 404) return [];
      throw err;
    }
  }

  private async putJsonl<T>(key: string, rows: T[]): Promise<void> {
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
    const gz = zlib.gzipSync(Buffer.from(jsonl, 'utf8'));
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: gz,
        ContentType: 'application/jsonl+gzip',
        ContentEncoding: 'gzip',
      }),
    );
  }

  private async appendJsonl<T>(key: string, rows: T[]): Promise<void> {
    if (rows.length === 0) return;
    const existing = await this.getJsonl<T>(key);
    await this.putJsonl(key, [...existing, ...rows]);
  }

  async upsert(events: EconomicEvent[]): Promise<void> {
    const byDay = new Map<string, EconomicEvent[]>();
    for (const e of events) {
      const list = byDay.get(e.scheduledDay) ?? [];
      list.push(e);
      byDay.set(e.scheduledDay, list);
    }
    for (const [day, incoming] of byDay) {
      const key = this.eventsKey(day);
      const existing = await this.getJsonl<EconomicEvent>(key);
      const byId = new Map(existing.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      const merged = [...byId.values()].sort((a, b) => a.scheduledAt - b.scheduledAt);
      await this.putJsonl(key, merged);
    }
  }

  private async listEventDayKeys(): Promise<string[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'calendar/events/' }),
    );
    return (res.Contents ?? []).map((o) => o.Key!).sort();
  }

  async queryByScheduled(from: number, to: number): Promise<EconomicEvent[]> {
    const fromDay = eventDayNY(from);
    const toDay = eventDayNY(to);
    const out: EconomicEvent[] = [];
    for (const key of await this.listEventDayKeys()) {
      const match = /date=([\d-]+)\.jsonl\.gz$/.exec(key);
      if (!match) continue;
      const day = match[1];
      if (day < fromDay || day > toDay) continue;
      out.push(...(await this.getJsonl<EconomicEvent>(key)));
    }
    return out.filter((e) => e.scheduledAt >= from && e.scheduledAt <= to).sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  async get(id: string): Promise<EconomicEvent | null> {
    const parts = id.split(':');
    if (parts[0] === 'ff' && parts.length === 3) {
      const day = parts[2];
      const found = (await this.getJsonl<EconomicEvent>(this.eventsKey(day))).find((e) => e.id === id);
      return found ?? null;
    }
    for (const key of await this.listEventDayKeys()) {
      const found = (await this.getJsonl<EconomicEvent>(key)).find((e) => e.id === id);
      if (found) return found;
    }
    return null;
  }

  async appendRevisions(rows: EventRevision[]): Promise<void> {
    const byDay = new Map<string, EventRevision[]>();
    for (const r of rows) {
      const day = this.utcDayKey(r.at);
      const list = byDay.get(day) ?? [];
      list.push(r);
      byDay.set(day, list);
    }
    for (const [day, list] of byDay) {
      await this.appendJsonl(this.revisionsKey(day), list);
    }
  }

  async queryRevisions(eventId: string): Promise<EventRevision[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'calendar/revisions/' }),
    );
    const out: EventRevision[] = [];
    for (const obj of res.Contents ?? []) {
      out.push(...(await this.getJsonl<EventRevision>(obj.Key!)).filter((r) => r.eventId === eventId));
    }
    return out.sort((a, b) => a.revision - b.revision);
  }

  async appendNotifications(rows: CalendarNotification[]): Promise<void> {
    const byDay = new Map<string, CalendarNotification[]>();
    for (const n of rows) {
      const day = this.utcDayKey(n.at);
      const list = byDay.get(day) ?? [];
      list.push(n);
      byDay.set(day, list);
    }
    for (const [day, list] of byDay) {
      await this.appendJsonl(this.notificationsKey(day), list);
    }
  }

  async queryNotifications(from: number, to: number): Promise<CalendarNotification[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'calendar/notifications/' }),
    );
    const out: CalendarNotification[] = [];
    for (const obj of res.Contents ?? []) {
      out.push(...(await this.getJsonl<CalendarNotification>(obj.Key!)));
    }
    return out.filter((n) => n.at >= from && n.at <= to).sort((a, b) => a.at - b.at);
  }
}
