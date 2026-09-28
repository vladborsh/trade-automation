import { Injectable, computed, isDevMode, signal } from '@angular/core';
import { DEFAULT_LANG, isLang, type Lang, type StringKey, type Strings } from './keys';
import { en } from './en';
import { ru } from './ru';

const TABLES: Record<Lang, Strings> = { ru, en };

/** Where a member's own choice is remembered between loads; `/auth/me` still wins when it answers. */
const STORED_LANG_KEY = 'insight.lang';

/**
 * architecture/insight-bot-web-dashboard.md §11 — one bundle, language chosen at runtime.
 *
 * Both tables ship in the bundle and the selection is a signal, so changing `/lang` in the bot
 * changes the dashboard on the next load without a second build. This is not Angular's build-time
 * i18n, deliberately: two builds of one small dashboard would double the deploy and let the two
 * drift.
 *
 * Order of precedence: the language `GET /api/web/auth/me` reports, else a language the member
 * chose on the login page (where there is no user yet), else `ru`.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly current = signal<Lang>(readStoredLang());

  readonly lang = this.current.asReadonly();
  readonly table = computed<Strings>(() => TABLES[this.current()]);

  /** From `/auth/me`. An unknown or absent value leaves the default rather than guessing. */
  setLangFromUser(lang: unknown): void {
    if (isLang(lang)) this.current.set(lang);
  }

  /** The login page's switch, which §11 scopes to that page — remembered for the next load. */
  setLang(lang: Lang): void {
    this.current.set(lang);
    try {
      localStorage.setItem(STORED_LANG_KEY, lang);
    } catch {
      // private window or blocked storage: the choice simply does not outlive the page
    }
  }

  /**
   * The string for `key`, with `{name}` placeholders filled.
   *
   * A key the table does not carry cannot normally exist — `Strings` is `Record<StringKey, string>`,
   * so an incomplete table fails to compile. It can still happen when a key is built at runtime
   * (from an API code, say), and then this **throws in dev** rather than rendering the key: a screen
   * showing `health.col.venue` to a member is worse than a screen that failed loudly to the
   * developer who introduced it. In production it falls back to the default language's string, and
   * only renders the key if that is missing too.
   */
  t(key: StringKey, params?: Record<string, string | number>): string {
    const template = this.table()[key] ?? TABLES[DEFAULT_LANG][key];
    if (template === undefined) {
      if (isDevMode()) {
        throw new Error(`i18n: no string for key "${key}" in ${this.current()} or ${DEFAULT_LANG}`);
      }
      return key;
    }
    return fill(template, params);
  }
}

/** Pure, so the placeholder rules are spec'd without the service. */
export function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    // an unknown placeholder is left as written: better a visible `{status}` than a silent "undefined"
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORED_LANG_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}
