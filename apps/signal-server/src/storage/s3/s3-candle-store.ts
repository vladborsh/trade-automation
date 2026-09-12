import * as zlib from 'zlib';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';
import { CandleStore } from '../candle-store.port';

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * architecture/live-signal-server.md §6.3/§6.4 — the recommended backup/system-of-record.
 * One gzip-compressed JSONL object per (venue, symbol, tf, UTC day); a day is rewritten whole
 * on upsert (§6.2's "day-object rewrite is the 'database' work, done by WriteBuffer").
 */
export class S3CandleStore implements CandleStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  private parseInstrumentId(id: InstrumentId): { venue: string; symbol: string } {
    const [venue, symbol] = id.split(':');
    return { venue, symbol };
  }

  private dayKey(openTime: number): string {
    return new Date(openTime).toISOString().slice(0, 10);
  }

  private objectKey(instrument: InstrumentId, tf: Timeframe, day: string): string {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    return `candles/venue=${venue}/symbol=${symbol}/tf=${tf}/date=${day}.jsonl.gz`;
  }

  private async getDay(key: string): Promise<Candle[]> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const gz = await streamToBuffer(res.Body);
      const jsonl = zlib.gunzipSync(gz).toString('utf8');
      return jsonl
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Candle);
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return [];
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 404) return [];
      throw err;
    }
  }

  private async putDay(key: string, candles: Candle[]): Promise<void> {
    const jsonl = candles.map((c) => JSON.stringify(c)).join('\n') + '\n';
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

  async upsert(candles: Candle[]): Promise<void> {
    const byKey = new Map<string, Candle[]>();
    for (const candle of candles) {
      const key = this.objectKey(candle.instrument, candle.timeframe, this.dayKey(candle.openTime));
      const list = byKey.get(key) ?? [];
      list.push(candle);
      byKey.set(key, list);
    }

    for (const [key, incoming] of byKey) {
      const existing = await this.getDay(key);
      const byOpenTime = new Map(existing.map((c) => [c.openTime, c]));
      for (const c of incoming) byOpenTime.set(c.openTime, c);
      const merged = [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
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

  async query(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    const out: Candle[] = [];
    for (const day of this.daysBetween(from, to)) {
      const key = this.objectKey(instrument, tf, day);
      out.push(...(await this.getDay(key)).filter((c) => c.openTime >= from && c.openTime <= to));
    }
    return out.sort((a, b) => a.openTime - b.openTime);
  }

  async latestOpenTime(instrument: InstrumentId, tf: Timeframe): Promise<number | null> {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    const prefix = `candles/venue=${venue}/symbol=${symbol}/tf=${tf}/`;
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
    );
    const keys = (res.Contents ?? []).map((o) => o.Key!).sort();
    if (keys.length === 0) return null;
    const last = await this.getDay(keys[keys.length - 1]);
    return last.length > 0 ? last[last.length - 1].openTime : null;
  }

  async *stream(instrument: InstrumentId, tf: Timeframe, from: number, to?: number): AsyncIterable<Candle> {
    const end = to ?? Date.now();
    for (const day of this.daysBetween(from, end)) {
      const key = this.objectKey(instrument, tf, day);
      const bars = (await this.getDay(key)).filter((c) => c.openTime >= from && c.openTime <= end);
      for (const c of bars.sort((a, b) => a.openTime - b.openTime)) {
        yield c;
      }
    }
  }
}
