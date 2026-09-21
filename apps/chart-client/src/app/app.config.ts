import { ApplicationConfig, Injector, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AppConfigService } from './core/config/app-config.service';
import { AuthService } from './core/auth/auth.service';
import { UNAUTHORIZED_HANDLER } from './core/api/unauthorized-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    // The auth guard's GET /auth/me needs apiBaseUrl before the first navigation settles.
    provideAppInitializer(() => inject(AppConfigService).load()),
    {
      provide: UNAUTHORIZED_HANDLER,
      // Resolved lazily: AuthService depends on RestClient, which depends on this handler.
      useFactory: () => {
        const injector = inject(Injector);
        return () => injector.get(AuthService).handleUnauthorized();
      },
    },
  ],
};
