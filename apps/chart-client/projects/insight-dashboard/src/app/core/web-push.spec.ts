import { pushSupported, subscriptionBody, vapidKeyBytes } from './web-push';

/** IB-069 — the push helpers that need no browser. */
describe('web push helpers (IB-069)', () => {
  it('decodes a base64url VAPID key to the 65-byte uncompressed P-256 point', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const bytes = vapidKeyBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
    // '-' and '_' are base64url's 62 and 63; a plain atob would throw on them
    expect(vapidKeyBytes('-_8')).toEqual(new Uint8Array([0xfb, 0xff]));
  });

  it('maps toJSON() to the bot\'s body, and refuses one without its keys', () => {
    const json = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', expirationTime: null, keys: { p256dh: 'BPk', auth: 'q1w' } };
    expect(subscriptionBody(json)).toEqual({ endpoint: json.endpoint, keys: { p256dh: 'BPk', auth: 'q1w' } });
    expect(subscriptionBody({ endpoint: json.endpoint })).toBeNull();
    expect(subscriptionBody({ endpoint: json.endpoint, keys: { p256dh: 'BPk' } })).toBeNull();
    expect(subscriptionBody({ keys: json.keys })).toBeNull();
  });

  it('needs a secure context, a service worker and a push manager', () => {
    const nav = { serviceWorker: {} };
    expect(pushSupported({ isSecureContext: true, navigator: nav, PushManager: class {} })).toBe(true);
    expect(pushSupported({ isSecureContext: false, navigator: nav, PushManager: class {} })).toBe(false);
    expect(pushSupported({ isSecureContext: true, navigator: {}, PushManager: class {} })).toBe(false);
    expect(pushSupported({ isSecureContext: true, navigator: nav })).toBe(false);
  });
});
