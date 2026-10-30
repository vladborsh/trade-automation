import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { WebPushPayload, WebPushSubscription } from '@trade-automation/contracts';
import * as webpush from 'web-push';
import { AppConfigService } from '../config/config.service';

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** The push services' answer for a subscription that no longer exists; the row is deleted. */
export const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/** A reminder that arrives after the event is noise: the push service drops it after this. */
export const PUSH_TTL_S = 15 * 60;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type SendFn = typeof webpush.sendNotification;
/** Specs substitute the push service here; production uses `web-push`'s own `sendNotification`. */
export const WEB_PUSH_SEND = Symbol('WEB_PUSH_SEND');

/** The three env keys, or null when push is not configured (env.schema refuses a partial set). */
export function vapidFromEnv(get: (key: string) => unknown): VapidKeys | null {
  const [publicKey, privateKey, subject] = ['WEB_PUSH_VAPID_PUBLIC', 'WEB_PUSH_VAPID_PRIVATE', 'WEB_PUSH_VAPID_SUBJECT']
    .map((k) => get(k));
  if (typeof publicKey !== 'string' || publicKey.length === 0) return null;
  return { publicKey, privateKey: String(privateKey), subject: String(subject) };
}

/**
 * IB-069 — the Web Push (VAPID) channel, the browser's counterpart of `TelegramSender.sendTo`.
 *
 * **Without keys it is disabled, not broken**: the bot boots, says so once at warn level, and the
 * notifier skips the push channel. With keys that do not parse it refuses to boot — a config that
 * looks set but cannot sign anything should not fail silently on the first reminder.
 *
 * Never throws from `send`: one dead browser must not stop the next member's reminder.
 */
@Injectable()
export class WebPushSender {
  private readonly logger = new Logger(WebPushSender.name);
  readonly vapid: VapidKeys | null;
  private readonly sendFn: SendFn;

  constructor(config: AppConfigService, @Optional() @Inject(WEB_PUSH_SEND) sendFn?: SendFn) {
    this.sendFn = sendFn ?? webpush.sendNotification;
    this.vapid = vapidFromEnv((k) => config.env.get(k as never));
    if (!this.vapid) {
      this.logger.warn('Web Push is off: WEB_PUSH_VAPID_PUBLIC / _PRIVATE / _SUBJECT are not set (npx web-push generate-vapid-keys)');
      return;
    }
    // throws on a malformed key or subject, at boot rather than at the first reminder
    webpush.getVapidHeaders('https://push.example', this.vapid.subject, this.vapid.publicKey, this.vapid.privateKey, 'aes128gcm');
  }

  get enabled(): boolean {
    return this.vapid !== null;
  }

  async send(subscription: WebPushSubscription, payload: WebPushPayload): Promise<PushOutcome> {
    if (!this.vapid) return 'failed';
    try {
      await this.sendFn(subscription, JSON.stringify(payload), {
        vapidDetails: this.vapid,
        TTL: PUSH_TTL_S,
        urgency: 'high',
        topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32),
      });
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status !== undefined && GONE_STATUSES.has(status)) return 'gone';
      this.logger.warn(`web push failed (${status ?? 'no status'}): ${(error as Error).message}`);
      return 'failed';
    }
  }
}
