import * as webpush from 'web-push';
import { PUSH_TTL_S, WebPushSender } from '../../src/delivery/web-push-sender';

/**
 * IB-069 — the VAPID channel: off without keys, a boot failure with broken ones, and the push
 * service's answer mapped to what the notifier does next (404/410 → delete the subscription).
 */
const KEYS = webpush.generateVAPIDKeys();
const config = (env: Record<string, unknown>) => ({ env: { get: (k: string) => env[k] } }) as never;
const ENV = { WEB_PUSH_VAPID_PUBLIC: KEYS.publicKey, WEB_PUSH_VAPID_PRIVATE: KEYS.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.com' };
const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };
const PAYLOAD = { title: 'In 15 min', body: '• CPI m/m', tag: 'alert:1793277000000' };

const failing = (statusCode?: number) => jest.fn(async () => {
  throw Object.assign(new Error(`Received unexpected response code`), statusCode === undefined ? {} : { statusCode });
});

describe('WebPushSender (IB-069)', () => {
  it('without keys it is off and sends nothing', async () => {
    const send = jest.fn();
    const sender = new WebPushSender(config({}), send as never);
    expect(sender.enabled).toBe(false);
    expect(await sender.send(SUB, PAYLOAD)).toBe('failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to start with keys that do not parse', () => {
    expect(() => new WebPushSender(config({ ...ENV, WEB_PUSH_VAPID_PRIVATE: 'nope' }))).toThrow();
  });

  it('sends the JSON payload with the VAPID details, a 15-minute TTL and a URL-safe topic', async () => {
    const send = jest.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
    const sender = new WebPushSender(config(ENV), send as never);
    expect(await sender.send(SUB, PAYLOAD)).toBe('sent');
    expect(send).toHaveBeenCalledWith(SUB, JSON.stringify(PAYLOAD), expect.objectContaining({
      TTL: PUSH_TTL_S,
      urgency: 'high',
      topic: 'alert_1793277000000',
      vapidDetails: { publicKey: KEYS.publicKey, privateKey: KEYS.privateKey, subject: 'mailto:ops@example.com' },
    }));
  });

  it.each([404, 410])('a %i means the subscription is gone', async (status) => {
    expect(await new WebPushSender(config(ENV), failing(status) as never).send(SUB, PAYLOAD)).toBe('gone');
  });

  it.each([400, 413, 429, 500, undefined])('anything else (%s) is a failure that keeps the subscription', async (status) => {
    expect(await new WebPushSender(config(ENV), failing(status) as never).send(SUB, PAYLOAD)).toBe('failed');
  });
});
