import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { AppConfigService } from '@backtest-core/config/app-config.service';
import { routes } from './app.routes';
import { InsightApiClient } from './core/insight-api.client';
import { I18nService } from './i18n/i18n.service';

/**
 * The dashboard's bootstrap. `AppConfigService` is the backtest SPA's, imported through the
 * `@backtest-core/*` alias (design §3): `config.json` must be loaded before the first request,
 * because every page reads `apiBaseUrl` from it.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideAppInitializer(() => inject(AppConfigService).load()),
    // §11: the member's own language, before the first screen renders — otherwise a Russian member
    // sees one frame of the default and then a flip, which is the "mixed screen" the ruling forbids.
    // A failure here is not fatal: no session yet (the login page) or an unreachable API simply
    // leaves the stored language, and `ru` is the default.
    provideAppInitializer(async () => {
      const i18n = inject(I18nService);
      const api = inject(InsightApiClient);
      const config = inject(AppConfigService);
      try {
        // Angular runs initializers CONCURRENTLY, not in sequence: without awaiting the config load
        // here, `apiBaseUrl` is not there yet, `config.get()` throws, and the catch below silently
        // leaves every member on the default language. `load()` is idempotent and returns the same
        // promise, so this awaits the one already in flight. (Found by the two-language screenshots:
        // an `en` member's page rendered in Russian.)
        await config.load();
        const me = await api.me();
        i18n.setLangFromUser(me.user?.lang);
      } catch {
        // unauthenticated or offline: keep the stored/default language
      }
    }),
  ],
};
