import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { selectDue, type DueNotification } from './calendar-notify';
import { PgCalendarNotifyStore, type CalendarNotifyStore } from './pg/calendar-notify.repo';
import { TelegramSender } from './telegram-sender';
import * as T from './templates/texts';

const CHECK_MS = 60_000;
/** Specs substitute an in-memory store here; production builds the Postgres one from `DB`. */
export const CALENDAR_NOTIFY_STORE = Symbol('CALENDAR_NOTIFY_STORE');
const DAY_MS = 86_400_000;

/**
 * IB-062 — the economic calendar in members' DMs: a morning digest and a reminder
 * `CALENDAR_REMIND_LEAD_MIN` before each high-impact USD event. Shaped like `GapReportService`:
 * a 60 s check, the decision in a pure function (`calendar-notify.ts`).
 *
 * **Repeat protection is the journal, not memory.** Each message is claimed in
 * `calendar_notifications_sent` (insert … on conflict do nothing) before it is sent, so a restart,
 * an overlapping tick or a second instance cannot send it twice. The price is that a send that
 * fails after its claim is not retried — the right side to err on for a reminder that is useless
 * ten minutes later.
 */
@Injectable()
export class CalendarNotifierService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CalendarNotifierService.name);
  private readonly store: CalendarNotifyStore | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) db: Db | null,
    private readonly telegram: TelegramSender,
    @Optional() @Inject(CALENDAR_NOTIFY_STORE) store?: CalendarNotifyStore,
  ) {
    this.store = store ?? (db ? new PgCalendarNotifyStore(db) : null);
  }

  private get digestAtMin(): number {
    const [h, m] = String(this.config.env.get('CALENDAR_DIGEST_TIME')).split(':').map(Number);
    return h * 60 + m;
  }

  private get leadMin(): number {
    return Number(this.config.env.get('CALENDAR_REMIND_LEAD_MIN'));
  }

  onApplicationBootstrap(): void {
    if (!this.config.env.get('CALENDAR_ENABLED') || !this.store) return;
    this.timer = setInterval(() => void this.tick(Date.now()), CHECK_MS);
    this.timer.unref?.();
    void this.tick(Date.now());
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check. Returns what it sent (or tried to), for the specs and the log. */
  async tick(now: number): Promise<Array<{ userId: number; key: string; delivered: boolean }>> {
    if (this.running || !this.store) return [];
    this.running = true;
    try {
      return await this.run(this.store, now);
    } catch (error) {
      this.logger.warn(`calendar notifier check failed: ${(error as Error).message}`);
      return [];
    } finally {
      this.running = false;
    }
  }

  private async run(store: CalendarNotifyStore, now: number) {
    const recipients = await store.recipients();
    if (recipients.length === 0) return [];

    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const day = new Date(dayStart).toISOString().slice(0, 10);
    const [events, collectedToday, sent] = await Promise.all([
      store.events(dayStart, dayStart + 2 * DAY_MS, now),
      store.collected(day),
      store.sentKeys(now - 2 * DAY_MS),
    ]);

    const input = { events, collectedToday, digestAtMin: this.digestAtMin, leadMs: this.leadMin * 60_000 };
    const results: Array<{ userId: number; key: string; delivered: boolean }> = [];
    for (const recipient of recipients) {
      for (const due of selectDue(now, input, sent.get(recipient.userId) ?? new Set())) {
        if (!(await store.claim(recipient.userId, due.key, now))) continue;
        const delivered = await this.telegram.sendTo(recipient.chatId, T.pick(this.render(due, now), recipient.lang));
        results.push({ userId: recipient.userId, key: due.key, delivered });
      }
    }
    if (results.length > 0) {
      const keys = [...new Set(results.map((r) => r.key))].join(', ');
      this.logger.log(`calendar: ${results.filter((r) => r.delivered).length}/${results.length} sent (${keys})`);
    }
    return results;
  }

  private render(due: DueNotification, now: number): T.Texts {
    if (due.kind === 'digest') return T.calendarDigest(due.day, due.events, due.holidays, this.leadMin);
    return T.calendarReminder(due.scheduledAt, due.events, Math.max(0, Math.round((due.scheduledAt - now) / 60_000)));
  }
}

