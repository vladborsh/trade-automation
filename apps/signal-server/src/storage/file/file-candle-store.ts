import * as fs from 'fs';
import * as path from 'path';
import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';
import { CandleStore } from '../candle-store.port';

/**
 * architecture/live-signal-server.md §6.4: "FileCandleStore uses the identical relative
 * layout on disk [as S3], so a local `data/` directory is a byte-compatible mirror of the
 * bucket." Hive-style path: `<root>/candles/venue=<v>/symbol=<s>/tf=<tf>/date=<YYYY-MM-DD>.jsonl`
 * (uncompressed locally for dev ergonomics; S3CandleStore gzips the same relative key, §6.4).
 */
export class FileCandleStore implements CandleStore {
  constructor(private readonly root: string) {}

  private parseInstrumentId(id: InstrumentId): { venue: string; symbol: string } {
    const [venue, symbol] = id.split(':');
    return { venue, symbol };
  }

  private dayKey(openTime: number): string {
    return new Date(openTime).toISOString().slice(0, 10);
  }

  private filePath(instrument: InstrumentId, tf: Timeframe, day: string): string {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    return path.join(
      this.root,
      'candles',
      `venue=${venue}`,
      `symbol=${symbol}`,
      `tf=${tf}`,
      `date=${day}.jsonl`,
    );
  }

  async upsert(candles: Candle[]): Promise<void> {
    const byFile = new Map<string, Candle[]>();
    for (const candle of candles) {
      const file = this.filePath(candle.instrument, candle.timeframe, this.dayKey(candle.openTime));
      const list = byFile.get(file) ?? [];
      list.push(candle);
      byFile.set(file, list);
    }

    for (const [file, incoming] of byFile) {
      const existing = this.readFile(file);
      const byOpenTime = new Map(existing.map((c) => [c.openTime, c]));
      for (const c of incoming) byOpenTime.set(c.openTime, c);
      const merged = [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, merged.map((c) => JSON.stringify(c)).join('\n') + '\n');
    }
  }

  private readFile(file: string): Candle[] {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Candle);
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
      const file = this.filePath(instrument, tf, day);
      out.push(...this.readFile(file).filter((c) => c.openTime >= from && c.openTime <= to));
    }
    return out.sort((a, b) => a.openTime - b.openTime);
  }

  async latestOpenTime(instrument: InstrumentId, tf: Timeframe): Promise<number | null> {
    const dir = path.join(
      this.root,
      'candles',
      `venue=${this.parseInstrumentId(instrument).venue}`,
      `symbol=${this.parseInstrumentId(instrument).symbol}`,
      `tf=${tf}`,
    );
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    if (files.length === 0) return null;
    const last = this.readFile(path.join(dir, files[files.length - 1]));
    return last.length > 0 ? last[last.length - 1].openTime : null;
  }

  async *stream(instrument: InstrumentId, tf: Timeframe, from: number, to?: number): AsyncIterable<Candle> {
    const end = to ?? Date.now();
    for (const day of this.daysBetween(from, end)) {
      const file = this.filePath(instrument, tf, day);
      const bars = this.readFile(file).filter((c) => c.openTime >= from && c.openTime <= end);
      for (const c of bars.sort((a, b) => a.openTime - b.openTime)) {
        yield c;
      }
    }
  }
}
