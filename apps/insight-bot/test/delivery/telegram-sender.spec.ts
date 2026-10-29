import { TelegramSender } from '../../src/delivery/telegram-sender';

/** IB-011 — the service sender. Tokens are the user's: without one this is disabled, not broken. */

const config = (token?: string, chatId?: string) =>
  ({ env: { get: (key: string) => (key === 'TELEGRAM_BOT_TOKEN' ? token : key === 'TELEGRAM_SERVICE_CHAT_ID' ? chatId : undefined) } }) as never;

describe('TelegramSender', () => {
  it('is disabled without a token, and send() logs instead of throwing', async () => {
    const sender = new TelegramSender(config(undefined, '-100123'));
    expect(sender.enabled).toBe(false);
    await expect(sender.send('hello')).resolves.toBe(false);
  });

  it('is disabled without a chat id, even with a token', () => {
    expect(new TelegramSender(config('123:abc', undefined)).enabled).toBe(false);
    expect(new TelegramSender(config('123:abc', '')).enabled).toBe(false);
  });

  it('is enabled with both, and a venue-side failure never escapes', async () => {
    const sender = new TelegramSender(config('123:abc', '-100123'));
    expect(sender.enabled).toBe(true);
    // the bot would reach api.telegram.org; the spec's network guard blocks it, and the point is
    // that the rejection is swallowed rather than taking the watchdog down with it
    await expect(sender.send('hello')).resolves.toBe(false);
  });

  it('sendTo (IB-062) needs only the token, and sends to the member\'s chat, not the service chat', async () => {
    const sender = new TelegramSender(config('123:abc', undefined));
    const calls: Array<{ method: string; chat_id: unknown; text: unknown }> = [];
    (sender as unknown as { bot: import('grammy').Bot }).bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as { chat_id: unknown; text: unknown };
      calls.push({ method, chat_id: p.chat_id, text: p.text });
      return { ok: true, result: { message_id: 1 } } as never;
    });

    await expect(sender.sendTo(4242, 'CPI in 15 min')).resolves.toBe(true);
    expect(calls).toEqual([{ method: 'sendMessage', chat_id: 4242, text: 'CPI in 15 min' }]);
  });

  it('sendTo without a token logs and returns false; a failure never escapes', async () => {
    await expect(new TelegramSender(config(undefined, undefined)).sendTo(4242, 'x')).resolves.toBe(false);
    // network guard blocks api.telegram.org: the rejection is swallowed
    await expect(new TelegramSender(config('123:abc', undefined)).sendTo(4242, 'x')).resolves.toBe(false);
  });
});
