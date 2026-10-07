#!/usr/bin/env node
/**
 * IB-BUG-008 — does Telegram actually accept the link we send?
 *
 * The bot sends the dashboard URL three ways (HTML anchor, inline button, bare text) and
 * Telegram validates two of them server-side: it rejects some button URLs with
 * `BUTTON_URL_INVALID`, and a host with no TLD is exactly the kind it may refuse. Guessing is
 * what produced the bug, so this asks Telegram and prints what it said.
 *
 * **It never prints the token.** It reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_SERVICE_CHAT_ID`
 * from the environment and reports only Telegram's verdict per variant.
 *
 *   TELEGRAM_BOT_TOKEN=… TELEGRAM_SERVICE_CHAT_ID=… node infra/insight-bot/verify-telegram-link.mjs
 *
 * Add --send to actually deliver the messages to the service chat (so a human can try tapping);
 * without it the script stops at the first failing variant and sends nothing it does not have to.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_SERVICE_CHAT_ID;
if (!token || !chatId) {
  console.error('set TELEGRAM_BOT_TOKEN and TELEGRAM_SERVICE_CHAT_ID (values are never printed)');
  process.exit(2);
}

/**
 * Result of the first run, 2026-10-07 (one probe per variant — a note, not a rule):
 *
 *   HTML anchor    localhost    ACCEPTED        inline button  localhost    REJECTED "Wrong HTTP URL"
 *   HTML anchor    127.0.0.1    ACCEPTED        inline button  127.0.0.1    ACCEPTED
 *
 * So `WEB_BASE_URL` uses `127.0.0.1`. Re-run this if Telegram's behaviour is ever in doubt;
 * that is what it is for.
 */
const URLS = ['http://127.0.0.1:3005/login?t=VERIFY', 'http://localhost:3005/login?t=VERIFY'];

async function call(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  // description is Telegram's own words; it never contains the token
  return { ok: body.ok === true, status: response.status, description: body.description ?? '' };
}

const results = [];
for (const url of URLS) {
  results.push({
    url,
    variant: 'HTML anchor',
    ...(await call('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `IB-BUG-008 check — <a href="${url}">Открыть панель</a>\n\n${url}`,
      link_preview_options: { is_disabled: true },
    })),
  });

  results.push({
    url,
    variant: 'inline button',
    ...(await call('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `IB-BUG-008 check — button for ${url}`,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Открыть панель', url }]] },
    })),
  });
}

let anyFailed = false;
for (const r of results) {
  const verdict = r.ok ? 'ACCEPTED' : `REJECTED (${r.status}) ${r.description}`;
  if (!r.ok) anyFailed = true;
  console.log(`${r.variant.padEnd(14)} ${r.url.padEnd(38)} ${verdict}`);
}

console.log(
  anyFailed
    ? '\nAt least one variant was refused. The bot already falls back to plain text, so the\n' +
      'person still gets a copyable link — but prefer a variant Telegram accepts.'
    : '\nEvery variant accepted. Tapping still has to be confirmed by a human: Telegram accepting\n' +
      'a URL is not the same as a desktop client making it tappable.',
);
process.exit(anyFailed ? 1 : 0);
