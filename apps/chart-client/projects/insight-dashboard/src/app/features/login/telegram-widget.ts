import type { StringKey } from '../../i18n/keys';

/**
 * IB-072 — the Telegram Login Widget on /login (architecture/member-access-design-2026-10-31.md M1).
 *
 * Telegram's widget is a script tag that replaces itself with an iframe from oauth.telegram.org and,
 * on success, calls a **global** function named in `data-onauth` with the signed payload. We post
 * that payload untouched to `POST /api/web/auth/telegram`; the server verifies it.
 *
 * The widget only works on the domain set for the bot in BotFather (`/setdomain`) — on localhost it
 * renders "Bot domain invalid". That is configuration, not a bug here.
 */

export const TELEGRAM_WIDGET_SRC = 'https://telegram.org/js/telegram-widget.js?22';

/** The global the widget calls. Prefixed so it cannot collide with anything else on `window`. */
export const TELEGRAM_AUTH_CALLBACK = '__ibTelegramAuth';

/** The widget's script element, ready to append where the button should appear. */
export function createTelegramWidgetScript(doc: Document, botUsername: string): HTMLScriptElement {
  const script = doc.createElement('script');
  script.async = true;
  script.src = TELEGRAM_WIDGET_SRC;
  script.setAttribute('data-telegram-login', botUsername);
  script.setAttribute('data-size', 'large');
  script.setAttribute('data-userpic', 'false');
  script.setAttribute('data-onauth', `${TELEGRAM_AUTH_CALLBACK}(user)`);
  return script;
}

/**
 * Pure: which sentence a widget-login failure gets. 403 is the one a stranger sees — membership is by
 * invitation only (M1), so the way out is the bot, not this page.
 */
export function telegramLoginFailure(status: number): { key: StringKey; params?: Record<string, string | number> } {
  if (status === 403) return { key: 'login.notMember' };
  if (status === 401) return { key: 'login.telegramInvalid' };
  if (status === 503) return { key: 'login.telegramUnavailable' };
  return { key: 'login.failed', params: { status } };
}
