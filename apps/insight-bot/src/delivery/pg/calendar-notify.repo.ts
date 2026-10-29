import type { EconomicEvent } from '@trade-automation/contracts';
import type { Db } from '../../db/db.port';
import type { Lang } from '../../users/user.model';
import { calendarEvents } from '../../web/calendar/pg/calendar.repo';

/**
 * IB-062 — what the calendar notifier reads and writes. A port, so the service is specced with an
 * in-memory store; this is the Postgres side of it.
 */
export interface CalendarRecipient {
  userId: number;
  chatId: number;
  lang: Lang;
}

export interface CalendarNotifyStore {
  /** Latest revision of each USD high/holiday event with `event_time` in `[fromMs, toMs]`. */
  events(fromMs: number, toMs: number, now: number): Promise<EconomicEvent[]>;
  /** True when `calendar_fetch_runs` has a row for `day` (UTC, `YYYY-MM-DD`). */
  collected(day: string): Promise<boolean>;
  /** Members who want calendar DMs and can be reached: enabled, not disabled, chat known. */
  recipients(): Promise<CalendarRecipient[]>;
  /** Journal keys per member, from `sinceMs` on. */
  sentKeys(sinceMs: number): Promise<Map<number, Set<string>>>;
  /** Writes the journal row; false when it was already there (another tick or a restart got it). */
  claim(userId: number, key: string, at: number): Promise<boolean>;
}

export class PgCalendarNotifyStore implements CalendarNotifyStore {
  constructor(private readonly db: Db) {}

  events(fromMs: number, toMs: number, now: number): Promise<EconomicEvent[]> {
    return calendarEvents(this.db, { fromMs, toMs, currency: 'USD', impacts: ['high', 'holiday'] }, now);
  }

  async collected(day: string): Promise<boolean> {
    const rows = await this.db.query('select 1 from calendar_fetch_runs where day = $1::date', [day]);
    return rows.length > 0;
  }

  async recipients(): Promise<CalendarRecipient[]> {
    const rows = await this.db.query<{ id: number; chat_id: string; lang: Lang }>(
      `select id, chat_id, lang from users
        where calendar_alerts and not disabled and chat_id is not null order by id`,
    );
    return rows.map((r) => ({ userId: r.id, chatId: Number(r.chat_id), lang: r.lang }));
  }

  async sentKeys(sinceMs: number): Promise<Map<number, Set<string>>> {
    const rows = await this.db.query<{ user_id: number; key: string }>(
      'select user_id, key from calendar_notifications_sent where sent_at >= $1',
      [new Date(sinceMs)],
    );
    const out = new Map<number, Set<string>>();
    for (const r of rows) out.set(r.user_id, (out.get(r.user_id) ?? new Set()).add(r.key));
    return out;
  }

  async claim(userId: number, key: string, at: number): Promise<boolean> {
    const rows = await this.db.query(
      `insert into calendar_notifications_sent (user_id, key, sent_at) values ($1, $2, $3)
       on conflict (user_id, key) do nothing returning key`,
      [userId, key, new Date(at)],
    );
    return rows.length > 0;
  }
}
