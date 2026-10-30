import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Optional, Post } from '@nestjs/common';
import {
  WebPushSubscriptionSchema, WebPushUnsubscribeSchema, type WebPushVapidKeyResponse,
} from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { PgWebPushStore, type WebPushStore } from '../../delivery/pg/web-push.repo';
import { vapidFromEnv } from '../../delivery/web-push-sender';
import type { User } from '../../users/user.model';
import { CurrentUser } from '../auth/web-auth.guard';

/** Specs substitute an in-memory store here; production builds the Postgres one from `DB`. */
export const WEB_PUSH_SUBSCRIPTIONS = Symbol('WEB_PUSH_SUBSCRIPTIONS');

/**
 * IB-069 — `/api/web/push`: the dashboard's service worker subscribes here. Every route needs a
 * session — `WebModule`'s module-wide guard, no decorator on purpose — and a subscription belongs
 * to the member of that session.
 */
@Controller('api/web/push')
export class WebPushController {
  private readonly store: WebPushStore | null;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) db: Db | null,
    @Optional() @Inject(WEB_PUSH_SUBSCRIPTIONS) store?: WebPushStore,
  ) {
    this.store = store ?? (db ? new PgWebPushStore(db) : null);
  }

  private get publicKey(): string | null {
    return vapidFromEnv((k) => this.config.env.get(k as never))?.publicKey ?? null;
  }

  /** Push off on this server answers `publicKey: null`, and the dashboard keeps its in-tab alerts. */
  @Get('vapid-key')
  vapidKey(): WebPushVapidKeyResponse {
    return { publicKey: this.publicKey };
  }

  @Post('subscription')
  @HttpCode(204)
  async subscribe(@CurrentUser() user: User, @Body() body: unknown): Promise<void> {
    const store = this.ready();
    const parsed = WebPushSubscriptionSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'BAD_SUBSCRIPTION', message: parsed.error.issues[0]?.message }, 400);
    await store.save(user.id, parsed.data);
  }

  /** Idempotent: unsubscribing a browser the server already forgot (410 earlier) is still 204. */
  @Delete('subscription')
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: User, @Body() body: unknown): Promise<void> {
    const store = this.ready(false);
    const parsed = WebPushUnsubscribeSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'BAD_SUBSCRIPTION', message: parsed.error.issues[0]?.message }, 400);
    await store.remove(user.id, parsed.data.endpoint);
  }

  /** Unsubscribing works with push switched off, so a member can still clear their row. */
  private ready(needsKey = true): WebPushStore {
    if (needsKey && !this.publicKey) throw new HttpException({ code: 'PUSH_DISABLED', message: 'web push is not configured' }, 503);
    if (!this.store) throw new HttpException({ code: 'NOT_FOUND', message: 'no database' }, 503);
    return this.store;
  }
}
