import type { WebPushSubscription } from '@trade-automation/contracts';

/**
 * IB-069 — the browser push's pure half: whether this browser can do it, the VAPID key in the
 * form `PushManager.subscribe` wants, and the subscription as the bot's contract. The service owns
 * the service worker, the push manager and the API.
 */

/** Served from the bundle root (`public/sw.js`), so its scope is the whole dashboard. */
export const SERVICE_WORKER_URL = '/sw.js';

/** Push needs a service worker and a push manager — and a secure context: https, or localhost. */
export function pushSupported(win: { isSecureContext?: boolean; navigator?: object; PushManager?: unknown }): boolean {
  return win.isSecureContext === true && !!win.navigator && 'serviceWorker' in win.navigator && 'PushManager' in win;
}

/** The base64url VAPID public key as bytes; `PushManager.subscribe` rejects the string in some browsers. */
export function vapidKeyBytes(key: string): Uint8Array {
  const base64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** `PushSubscription.toJSON()` as the bot's body, or null when a field the bot needs is missing. */
export function subscriptionBody(json: PushSubscriptionJSON): WebPushSubscription | null {
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.['p256dh'] || !keys?.['auth']) return null;
  return { endpoint, keys: { p256dh: keys['p256dh'], auth: keys['auth'] } };
}
