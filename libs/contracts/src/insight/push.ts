import { z } from 'zod';

/**
 * IB-069 — browser Web Push for the calendar reminder: the dashboard subscribes through its
 * service worker and hands the bot the subscription; the bot pushes the same high-impact USD
 * reminder it sends to Telegram (IB-062), and the notification arrives with the tab closed.
 */

/** `GET /api/web/push/vapid-key` — `publicKey: null` means push is off on this server. */
export const WebPushVapidKeyResponseSchema = z.object({
  /** The VAPID application server key, base64url, as `PushManager.subscribe` wants it. */
  publicKey: z.string().min(1).nullable(),
});
export type WebPushVapidKeyResponse = z.infer<typeof WebPushVapidKeyResponseSchema>;

/** `POST /api/web/push/subscription` — `PushSubscription.toJSON()`, the fields the bot needs. */
export const WebPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(256),
  }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

/** `DELETE /api/web/push/subscription` — the endpoint is the subscription's identity. */
export const WebPushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });
export type WebPushUnsubscribe = z.infer<typeof WebPushUnsubscribeSchema>;

/**
 * What the bot pushes and the service worker shows. `tag` is the in-tab notifier's key
 * (`alert:<scheduledAt ms>`, calendar-core's `alertKey`), so the push and the open tab's own
 * notification for the same event replace each other instead of ringing twice.
 */
export const WebPushPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  tag: z.string(),
});
export type WebPushPayload = z.infer<typeof WebPushPayloadSchema>;
