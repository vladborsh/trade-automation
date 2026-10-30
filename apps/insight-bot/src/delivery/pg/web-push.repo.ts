import type { WebPushSubscription } from '@trade-automation/contracts';
import type { Db } from '../../db/db.port';
import type { Lang } from '../../users/user.model';

/**
 * IB-069 — browser push subscriptions and their dedup journal. A port, like
 * `CalendarNotifyStore`, so the notifier and the controller are specced in memory.
 */
export interface PushTarget {
  id: number;
  userId: number;
  lang: Lang;
  subscription: WebPushSubscription;
}

export interface WebPushStore {
  /** Upserts on the endpoint: the same browser subscribing again replaces its keys and owner. */
  save(userId: number, subscription: WebPushSubscription): Promise<void>;
  /** Deletes the member's own subscription; false when there was none of theirs. */
  remove(userId: number, endpoint: string): Promise<boolean>;
  /** Every subscription whose member is not disabled, with the member's language. */
  targets(): Promise<PushTarget[]>;
  /** The push service said the subscription is gone (404/410). */
  drop(id: number): Promise<void>;
  /** Journal keys per subscription, from `sinceMs` on. */
  sentKeys(sinceMs: number): Promise<Map<number, Set<string>>>;
  /** Writes the journal row; false when it was already there. */
  claim(subscriptionId: number, key: string, at: number): Promise<boolean>;
}

export class PgWebPushStore implements WebPushStore {
  constructor(private readonly db: Db) {}

  async save(userId: number, s: WebPushSubscription): Promise<void> {
    await this.db.query(
      `insert into web_push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      [userId, s.endpoint, s.keys.p256dh, s.keys.auth],
    );
  }

  async remove(userId: number, endpoint: string): Promise<boolean> {
    const rows = await this.db.query(
      'delete from web_push_subscriptions where user_id = $1 and endpoint = $2 returning id',
      [userId, endpoint],
    );
    return rows.length > 0;
  }

  async targets(): Promise<PushTarget[]> {
    const rows = await this.db.query<{ id: number; user_id: number; lang: Lang; endpoint: string; p256dh: string; auth: string }>(
      `select s.id, s.user_id, u.lang, s.endpoint, s.p256dh, s.auth
         from web_push_subscriptions s join users u on u.id = s.user_id
        where not u.disabled order by s.id`,
    );
    return rows.map((r) => ({
      id: r.id, userId: r.user_id, lang: r.lang,
      subscription: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
    }));
  }

  async drop(id: number): Promise<void> {
    await this.db.query('delete from web_push_subscriptions where id = $1', [id]);
  }

  async sentKeys(sinceMs: number): Promise<Map<number, Set<string>>> {
    const rows = await this.db.query<{ subscription_id: number; key: string }>(
      'select subscription_id, key from web_push_notifications_sent where sent_at >= $1',
      [new Date(sinceMs)],
    );
    const out = new Map<number, Set<string>>();
    for (const r of rows) out.set(r.subscription_id, (out.get(r.subscription_id) ?? new Set()).add(r.key));
    return out;
  }

  async claim(subscriptionId: number, key: string, at: number): Promise<boolean> {
    const rows = await this.db.query(
      `insert into web_push_notifications_sent (subscription_id, key, sent_at) values ($1, $2, $3)
       on conflict (subscription_id, key) do nothing returning key`,
      [subscriptionId, key, new Date(at)],
    );
    return rows.length > 0;
  }
}
