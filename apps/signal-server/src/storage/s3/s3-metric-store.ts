import * as zlib from 'zlib';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';
import { MetricStore } from '../metric-store.port';
import { upgradeLegacyObservation } from '../upgrade-legacy-observation';

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * architecture/chart-layouts.md §4.4, base §6.4: identical relative key to `S3CandleStore`,
 * gzip-compressed JSONL, under a `metrics/` prefix. Reuses the already-pinned S3 bucket/IAM
 * (live-signal-server-infra.md §1) — no infra change, no DevOps hand-off needed.
 */
export class S3MetricStore implements MetricStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  private parseInstrumentId(id: InstrumentId): { venue: string; symbol: string } {
    const [venue, symbol] = id.split(':');
    return { venue, symbol };
  }

  private dayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  private objectKey(instrument: InstrumentId, metric: MetricKind, day: string): string {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    return `metrics/venue=${venue}/symbol=${symbol}/metric=${metric}/date=${day}.jsonl.gz`;
  }

  private async getDay(key: string): Promise<MetricObservation[]> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const gz = await streamToBuffer(res.Body);
      const jsonl = zlib.gunzipSync(gz).toString('utf8');
      return jsonl
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => upgradeLegacyObservation(JSON.parse(l)));
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return [];
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 404) return [];
      throw err;
    }
  }

  private async putDay(key: string, observations: MetricObservation[]): Promise<void> {
    const jsonl = observations.map((o) => JSON.stringify(o)).join('\n') + '\n';
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

  async upsert(observations: MetricObservation[]): Promise<void> {
    const byKey = new Map<string, MetricObservation[]>();
    for (const o of observations) {
      const key = this.objectKey(o.instrument, o.metric, this.dayKey(o.time));
      const list = byKey.get(key) ?? [];
      list.push(o);
      byKey.set(key, list);
    }

    for (const [key, incoming] of byKey) {
      const existing = await this.getDay(key);
      const byTime = new Map(existing.map((o) => [o.time, o]));
      for (const o of incoming) byTime.set(o.time, o);
      const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
      await this.putDay(key, merged);
    }
  }

  private daysBetween(from: number, to: number): string[] {
    const days: string[] = [];
    const start = new Date(this.dayKey(from) + 'T00:00:00Z').getTime();
    const end = new Date(this.dayKey(to) + 'T00:00:00Z').getTime();
    for (let d = start; d <= end; d += 24 * 60 * 60_000) {
      days.push(new Date(d).toISOString().slice(0, 10));
    }
    return days;
  }

  async query(
    instrument: InstrumentId,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]> {
    const out: MetricObservation[] = [];
    for (const day of this.daysBetween(from, to)) {
      const key = this.objectKey(instrument, metric, day);
      out.push(...(await this.getDay(key)).filter((o) => o.time >= from && o.time <= to));
    }
    return out.sort((a, b) => a.time - b.time);
  }

  async latestTime(instrument: InstrumentId, metric: MetricKind): Promise<number | null> {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    const prefix = `metrics/venue=${venue}/symbol=${symbol}/metric=${metric}/`;
    const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }));
    const keys = (res.Contents ?? []).map((o) => o.Key!).sort();
    if (keys.length === 0) return null;
    const last = await this.getDay(keys[keys.length - 1]);
    return last.length > 0 ? last[last.length - 1].time : null;
  }
}
