import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { AppConfigService } from '@backtest-core/config/app-config.service';
import { routes } from './app.routes';

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
  ],
};
