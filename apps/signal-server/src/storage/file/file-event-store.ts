import * as fs from 'fs';
import * as path from 'path';
import { CalendarNotification, EconomicEvent, EventRevision, eventDayNY } from '@trade-automation/contracts';
import { EventStore } from '../event-store.port';

/**
 * architecture/economic-calendar.md §4.2–4.3: identical relative key layout family to
 * `FileMetricStore`/`FileCandleStore`, under a `calendar/` prefix.
 *
 * calendar/events/date=<scheduledDay ET>.jsonl          current state; rewritten whole on upsert
 * calendar/revisions/date=<poll UTC day>.jsonl          append-only
 * calendar/notifications/date=<fired UTC day>.jsonl     append-only ledger
 */
export class FileEventStore implements EventStore {
  constructor(private readonly root: string) {}

  private utcDayKey(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
  }

  private eventsFile(scheduledDay: string): string {
    return path.join(this.root, 'calendar', 'events', `date=${scheduledDay}.jsonl`);
  }

  private revisionsFile(pollUtcDay: string): string {
    return path.join(this.root, 'calendar', 'revisions', `date=${pollUtcDay}.jsonl`);
  }

  private notificationsFile(firedUtcDay: string): string {
    return path.join(this.root, 'calendar', 'notifications', `date=${firedUtcDay}.jsonl`);
  }

  private readJsonl<T>(file: string): T[] {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as T);
  }

  private writeJsonl<T>(file: string, rows: T[]): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : ''));
  }

  private appendJsonl<T>(file: string, rows: T[]): void {
    if (rows.length === 0) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  async upsert(events: EconomicEvent[]): Promise<void> {
    const byDay = new Map<string, EconomicEvent[]>();
    for (const e of events) {
      const list = byDay.get(e.scheduledDay) ?? [];
      list.push(e);
      byDay.set(e.scheduledDay, list);
    }
    for (const [day, incoming] of byDay) {
      const file = this.eventsFile(day);
      const existing = this.readJsonl<EconomicEvent>(file);
      const byId = new Map(existing.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      const merged = [...byId.values()].sort((a, b) => a.scheduledAt - b.scheduledAt);
      this.writeJsonl(file, merged);
    }
  }

  private eventDaysDir(): string {
    return path.join(this.root, 'calendar', 'events');
  }

  private listEventDayFiles(): string[] {
    const dir = this.eventDaysDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  }

  async queryByScheduled(from: number, to: number): Promise<EconomicEvent[]> {
    const fromDay = eventDayNY(from);
    const toDay = eventDayNY(to);
    const out: EconomicEvent[] = [];
    for (const file of this.listEventDayFiles()) {
      const day = file.replace('date=', '').replace('.jsonl', '');
      if (day < fromDay || day > toDay) continue;
      out.push(...this.readJsonl<EconomicEvent>(path.join(this.eventDaysDir(), file)));
    }
    return out.filter((e) => e.scheduledAt >= from && e.scheduledAt <= to).sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  async get(id: string): Promise<EconomicEvent | null> {
    const parts = id.split(':');
    if (parts[0] === 'ff' && parts.length === 3) {
      const day = parts[2];
      const found = this.readJsonl<EconomicEvent>(this.eventsFile(day)).find((e) => e.id === id);
      return found ?? null;
    }
    // ffx: ids carry no day — rare, and only reached on a cache miss (§4.3); scan every day file.
    for (const file of this.listEventDayFiles()) {
      const found = this.readJsonl<EconomicEvent>(path.join(this.eventDaysDir(), file)).find((e) => e.id === id);
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
      this.appendJsonl(this.revisionsFile(day), list);
    }
  }

  async queryRevisions(eventId: string): Promise<EventRevision[]> {
    const dir = path.join(this.root, 'calendar', 'revisions');
    if (!fs.existsSync(dir)) return [];
    const out: EventRevision[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      out.push(...this.readJsonl<EventRevision>(path.join(dir, file)).filter((r) => r.eventId === eventId));
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
      this.appendJsonl(this.notificationsFile(day), list);
    }
  }

  async queryNotifications(from: number, to: number): Promise<CalendarNotification[]> {
    const dir = path.join(this.root, 'calendar', 'notifications');
    if (!fs.existsSync(dir)) return [];
    const out: CalendarNotification[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      out.push(...this.readJsonl<CalendarNotification>(path.join(dir, file)));
    }
    return out.filter((n) => n.at >= from && n.at <= to).sort((a, b) => a.at - b.at);
  }
}
