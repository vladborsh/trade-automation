import * as zlib from 'zlib';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InstrumentId, Signal } from '@trade-automation/contracts';
import { SignalStore } from '../signal-store.port';

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** architecture/live-signal-server.md §6.4 — same layout/append pattern as S3CandleStore, for signals. */
export class S3SignalStore implements SignalStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  private dayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  private objectKey(instrument: InstrumentId, day: string): string {
    const [venue, symbol] = instrument.split(':');
    return `signals/venue=${venue}/symbol=${symbol}/date=${day}.jsonl.gz`;
  }

  private async getDay(key: string): Promise<Signal[]> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const gz = await streamToBuffer(res.Body);
      return zlib
        .gunzipSync(gz)
        .toString('utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Signal);
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return [];
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 404) return [];
      throw err;
    }
  }

  async append(signals: Signal[]): Promise<void> {
    const byKey = new Map<string, Signal[]>();
    for (const s of signals) {
      const key = this.objectKey(s.instrument, this.dayKey(s.time));
      const list = byKey.get(key) ?? [];
      list.push(s);
      byKey.set(key, list);
    }
    for (const [key, incoming] of byKey) {
      const existing = await this.getDay(key);
      const merged = [...existing, ...incoming].sort((a, b) => a.time - b.time);
      const jsonl = merged.map((s) => JSON.stringify(s)).join('\n') + '\n';
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

  async query(instrument: InstrumentId, from: number, to: number, strategyId?: string): Promise<Signal[]> {
    const out: Signal[] = [];
    for (const day of this.daysBetween(from, to)) {
      const bars = await this.getDay(this.objectKey(instrument, day));
      out.push(
        ...bars.filter((s) => s.time >= from && s.time <= to && (!strategyId || s.strategyId === strategyId)),
      );
    }
    return out.sort((a, b) => a.time - b.time);
  }
}
