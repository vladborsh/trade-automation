import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { selectDue, type DueNotification } from './calendar-notify';
import { pushPayload, pushReminders } from './calendar-push';
import { PgCalendarNotifyStore, type CalendarNotifyStore } from './pg/calendar-notify.repo';
import { PgWebPushStore, type WebPushStore } from './pg/web-push.repo';
import { TelegramSender } from './telegram-sender';
import { WebPushSender } from './web-push-sender';
import * as T from './templates/texts';

const CHECK_MS = 60_000;
/** Specs substitute an in-memory store here; production builds the Postgres one from `DB`. */
export const CALENDAR_NOTIFY_STORE = Symbol('CALENDAR_NOTIFY_STORE');
export const WEB_PUSH_STORE = Symbol('WEB_PUSH_STORE');
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
 *
 * IB-069 adds a second channel beside Telegram: the same reminders (not the digest) as a browser
 * Web Push to every subscription, journalled per (subscription, key) in
 * `web_push_notifications_sent`. A push service answering 404/410 deletes the subscription.
 */
export type NotifyResult =
  | { channel: 'telegram'; userId: number; key: string; delivered: boolean }
  | { channel: 'push'; subscriptionId: number; key: string; delivered: boolean };

@Injectable()
export class CalendarNotifierService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CalendarNotifierService.name);
  private readonly store: CalendarNotifyStore | null;
  private readonly pushStore: WebPushStore | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) db: Db | null,
    private readonly telegram: TelegramSender,
    @Optional() @Inject(CALENDAR_NOTIFY_STORE) store?: CalendarNotifyStore,
    @Optional() private readonly push?: WebPushSender,
    @Optional() @Inject(WEB_PUSH_STORE) pushStore?: WebPushStore,
  ) {
    this.store = store ?? (db ? new PgCalendarNotifyStore(db) : null);
    this.pushStore = pushStore ?? (db ? new PgWebPushStore(db) : null);
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
  async tick(now: number): Promise<NotifyResult[]> {
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

  private async run(store: CalendarNotifyStore, now: number): Promise<NotifyResult[]> {
    const pushStore = this.push?.enabled ? this.pushStore : null;
    const [recipients, targets] = await Promise.all([store.recipients(), pushStore ? pushStore.targets() : []]);
    if (recipients.length === 0 && targets.length === 0) return [];

    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const day = new Date(dayStart).toISOString().slice(0, 10);
    const [events, collectedToday, sent, pushSent] = await Promise.all([
      store.events(dayStart, dayStart + 2 * DAY_MS, now),
      store.collected(day),
      store.sentKeys(now - 2 * DAY_MS),
      pushStore && targets.length > 0 ? pushStore.sentKeys(now - 2 * DAY_MS) : new Map<number, Set<string>>(),
    ]);

    const input = { events, collectedToday, digestAtMin: this.digestAtMin, leadMs: this.leadMin * 60_000 };
    const results: NotifyResult[] = [];
    for (const recipient of recipients) {
      for (const due of selectDue(now, input, sent.get(recipient.userId) ?? new Set())) {
        if (!(await store.claim(recipient.userId, due.key, now))) continue;
        const delivered = await this.telegram.sendTo(recipient.chatId, T.pick(this.render(due, now), recipient.lang));
        results.push({ channel: 'telegram', userId: recipient.userId, key: due.key, delivered });
      }
    }
    if (pushStore && this.push) {
      for (const target of targets) {
        for (const due of pushReminders(selectDue(now, input, pushSent.get(target.id) ?? new Set()))) {
          if (!(await pushStore.claim(target.id, due.key, now))) continue;
          const outcome = await this.push.send(target.subscription, pushPayload(due, now, target.lang));
          if (outcome === 'gone') {
            await pushStore.drop(target.id);
            this.logger.log(`web push: subscription ${target.id} (member ${target.userId}) is gone — deleted`);
          }
          results.push({ channel: 'push', subscriptionId: target.id, key: due.key, delivered: outcome === 'sent' });
          if (outcome === 'gone') break;
        }
      }
    }
    if (results.length > 0) {
      const keys = [...new Set(results.map((r) => `${r.channel}:${r.key}`))].join(', ');
      this.logger.log(`calendar: ${results.filter((r) => r.delivered).length}/${results.length} sent (${keys})`);
    }
    return results;
  }

  private render(due: DueNotification, now: number): T.Texts {
    if (due.kind === 'digest') return T.calendarDigest(due.day, due.events, due.holidays, this.leadMin);
    return T.calendarReminder(due.scheduledAt, due.events, Math.max(0, Math.round((due.scheduledAt - now) / 60_000)));
  }
}

