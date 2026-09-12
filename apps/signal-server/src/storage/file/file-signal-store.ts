import * as fs from 'fs';
import * as path from 'path';
import { InstrumentId, Signal } from '@trade-automation/contracts';
import { SignalStore } from '../signal-store.port';

export class FileSignalStore implements SignalStore {
  constructor(private readonly root: string) {}

  private dayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  private filePath(instrument: InstrumentId, day: string): string {
    const [venue, symbol] = instrument.split(':');
    return path.join(this.root, 'signals', `venue=${venue}`, `symbol=${symbol}`, `date=${day}.jsonl`);
  }

  async append(signals: Signal[]): Promise<void> {
    const byFile = new Map<string, Signal[]>();
    for (const s of signals) {
      const file = this.filePath(s.instrument, this.dayKey(s.time));
      const list = byFile.get(file) ?? [];
      list.push(s);
      byFile.set(file, list);
    }
    for (const [file, list] of byFile) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, list.map((s) => JSON.stringify(s)).join('\n') + '\n');
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
      const file = this.filePath(instrument, day);
      if (!fs.existsSync(file)) continue;
      const rows = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Signal)
        .filter((s) => s.time >= from && s.time <= to && (!strategyId || s.strategyId === strategyId));
      out.push(...rows);
    }
    return out.sort((a, b) => a.time - b.time);
  }
}
