import { Injectable, signal } from '@angular/core';
import { inject } from '@angular/core';
import { InsightApiClient } from './insight-api.client';
import { SERVICE_WORKER_URL, pushSupported, subscriptionBody, vapidKeyBytes } from './web-push';

/**
 * IB-069 — browser Web Push: the service worker (`public/sw.js`, see the comment there for why it
 * is ours rather than `@angular/service-worker`), the push subscription, and handing it to the bot.
 * With it the calendar reminder arrives with every dashboard tab closed, as long as the browser
 * runs. Works only on https or localhost — the browser refuses a service worker anywhere else.
 *
 * Never throws: push is an addition to the in-tab alerts, so any failure (unsupported browser, push
 * off on the server, a push service that is unreachable) leaves `subscribed` false and the tab's own
 * notifier doing the job alone.
 */
@Injectable({ providedIn: 'root' })
export class WebPushService {
  private readonly api = inject(InsightApiClient);
  private registering: Promise<ServiceWorkerRegistration | null> | null = null;

  readonly supported = typeof window !== 'undefined' && pushSupported(window);
  /** True once this browser's subscription is with the bot. */
  readonly subscribed = signal(false);

  /** Subscribes (or re-sends an existing subscription, which the bot upserts). */
  async enable(): Promise<boolean> {
    try {
      const registration = await this.registration();
      if (!registration) return this.settle(false);
      const { publicKey } = await this.api.pushVapidKey();
      if (!publicKey) return this.settle(false);
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(publicKey) as BufferSource,
      });
      const body = subscriptionBody(subscription.toJSON());
      if (!body) return this.settle(false);
      await this.api.pushSubscribe(body);
      return this.settle(true);
    } catch (error) {
      console.warn('web push: subscribing failed, in-tab alerts only', error);
      return this.settle(false);
    }
  }

  /** Unsubscribes in the browser first (that alone stops delivery), then tells the bot. */
  async disable(): Promise<void> {
    this.subscribed.set(false);
    try {
      const registration = await this.registration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await this.api.pushUnsubscribe(endpoint);
    } catch {
      // the bot keeps a dead row until its next push answers 410, which deletes it
    }
  }

  /**
   * The in-tab notifier shows through the service worker when there is one, so its notification
   * and the push for the same event are the same kind with the same `tag`, and replace each other.
   */
  async show(title: string, options: NotificationOptions): Promise<void> {
    const registration = await this.registration().catch(() => null);
    if (registration) await registration.showNotification(title, options);
    else new Notification(title, options);
  }

  private registration(): Promise<ServiceWorkerRegistration | null> {
    if (!this.supported) return Promise.resolve(null);
    this.registering ??= navigator.serviceWorker
      .register(SERVICE_WORKER_URL)
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
    return this.registering;
  }

  private settle(on: boolean): boolean {
    this.subscribed.set(on);
    return on;
  }
}
