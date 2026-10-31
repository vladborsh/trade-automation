import { createTelegramWidgetScript, TELEGRAM_AUTH_CALLBACK, TELEGRAM_WIDGET_SRC, telegramLoginFailure } from './telegram-widget';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';

describe('createTelegramWidgetScript', () => {
  it('points the widget at our bot and our global callback', () => {
    const s = createTelegramWidgetScript(document, 'my_test_bot');
    expect(s.src).toBe(TELEGRAM_WIDGET_SRC);
    expect(TELEGRAM_WIDGET_SRC).toBe('https://telegram.org/js/telegram-widget.js?22');
    expect(s.getAttribute('data-telegram-login')).toBe('my_test_bot');
    expect(s.getAttribute('data-onauth')).toBe(`${TELEGRAM_AUTH_CALLBACK}(user)`);
    // no write access asked: the bot's chat comes from /start, never from the widget (M1)
    expect(s.hasAttribute('data-request-access')).toBe(false);
  });
});

describe('telegramLoginFailure', () => {
  it('maps each server code to its own key', () => {
    expect(telegramLoginFailure(403).key).toBe('login.notMember');
    expect(telegramLoginFailure(401).key).toBe('login.telegramInvalid');
    expect(telegramLoginFailure(503).key).toBe('login.telegramUnavailable');
    expect(telegramLoginFailure(500)).toEqual({ key: 'login.failed', params: { status: 500 } });
  });

  it('NOT_A_MEMBER says "by invitation" in both languages, and never offers to sign up', () => {
    expect(en['login.notMember'].toLowerCase()).toContain('invitation');
    expect(ru['login.notMember'].toLowerCase()).toContain('приглашени');
  });

  it('the unavailable message points at the link path that still works', () => {
    for (const table of [ru, en]) expect(table['login.telegramUnavailable']).toContain('/web');
  });
});
