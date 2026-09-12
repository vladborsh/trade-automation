import * as fs from 'fs';
import * as path from 'path';
import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';
import { MetricStore } from '../metric-store.port';

/**
 * architecture/chart-layouts.md §4.4, base §6.4: identical relative key layout to
 * `FileCandleStore`, under a `metrics/` prefix instead of `candles/`:
 * `<root>/metrics/venue=<v>/symbol=<s>/metric=<m>/date=<YYYY-MM-DD>.jsonl`.
 */
export class FileMetricStore implements MetricStore {
  constructor(private readonly root: string) {}

  private parseInstrumentId(id: InstrumentId): { venue: string; symbol: string } {
    const [venue, symbol] = id.split(':');
    return { venue, symbol };
  }

  private dayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  private filePath(instrument: InstrumentId, metric: MetricKind, day: string): string {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    return path.join(
      this.root,
      'metrics',
      `venue=${venue}`,
      `symbol=${symbol}`,
      `metric=${metric}`,
      `date=${day}.jsonl`,
    );
  }

  async upsert(observations: MetricObservation[]): Promise<void> {
    const byFile = new Map<string, MetricObservation[]>();
    for (const o of observations) {
      const file = this.filePath(o.instrument, o.metric, this.dayKey(o.time));
      const list = byFile.get(file) ?? [];
      list.push(o);
      byFile.set(file, list);
    }

    for (const [file, incoming] of byFile) {
      const existing = this.readFile(file);
      const byTime = new Map(existing.map((o) => [o.time, o]));
      for (const o of incoming) byTime.set(o.time, o);
      const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, merged.map((o) => JSON.stringify(o)).join('\n') + '\n');
    }
  }

  private readFile(file: string): MetricObservation[] {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as MetricObservation);
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
      const file = this.filePath(instrument, metric, day);
      out.push(...this.readFile(file).filter((o) => o.time >= from && o.time <= to));
    }
    return out.sort((a, b) => a.time - b.time);
  }

  async latestTime(instrument: InstrumentId, metric: MetricKind): Promise<number | null> {
    const { venue, symbol } = this.parseInstrumentId(instrument);
    const dir = path.join(this.root, 'metrics', `venue=${venue}`, `symbol=${symbol}`, `metric=${metric}`);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    if (files.length === 0) return null;
    const last = this.readFile(path.join(dir, files[files.length - 1]));
    return last.length > 0 ? last[last.length - 1].time : null;
  }
}
