import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';

/** Where the built dashboard lands: the Dockerfile copies `dist/insight-dashboard/browser` here. */
export const DASHBOARD_ROOT = join(__dirname, '..', '..', 'public');

/** The paths the SPA fallback must never answer — pinned in `test/web/static.module.spec.ts`. */
export const DASHBOARD_EXCLUDE = ['/api', '/api/(.*)', '/healthz', '/metrics'];

/**
 * IB-030 (design §2 W2, §3) — insight-bot serves the dashboard bundle itself, same origin as
 * `/api/web/*`, so the session cookie is same-site and there is no CORS to configure.
 *
 * **The exclusions are the whole point of this file.** `ServeStaticModule`'s SPA fallback answers
 * any unmatched GET with `index.html`; without `exclude`, a typo'd API path or a monitoring probe
 * would get 200 and a page of HTML instead of a 404 or its JSON — and the ops liveness probe that
 * the box's health check reads would start returning the dashboard. So `/api/*`, `/healthz` and
 * `/metrics` are excluded, and they keep answering as themselves.
 *
 * WD-011 (storage ruling S7): `/health` is NOT excluded. Since the ops probe moved to `/healthz`, the
 * path `/health` belongs to the dashboard's admin Health page, and a reload there must get
 * `index.html`.
 *
 * Registered only when the bundle is actually present: in development nobody has run
 * `ng build insight-dashboard`, and a missing root would make every unmatched route a 500 rather
 * than the 404 it should be. `ng serve insight-dashboard` on the slot's `:42x5` is the dev path.
 */
@Module({})
export class DashboardStaticModule {
  /** `root` is for specs only (a temp bundle); the app always serves `DASHBOARD_ROOT`. */
  static register(root = DASHBOARD_ROOT): DynamicModule {
    if (!existsSync(join(root, 'index.html'))) {
      new Logger(DashboardStaticModule.name).log(
        `no dashboard bundle at ${root} — static serving off (use \`ng serve insight-dashboard\` in development)`,
      );
      return { module: DashboardStaticModule };
    }
    return {
      module: DashboardStaticModule,
      imports: [
        ServeStaticModule.forRoot({
          rootPath: root,
          // the SPA fallback must never swallow the API or the ops endpoints
          // NB: @nestjs/serve-static 4 vendors path-to-regexp **0.2.5**, not the version Nest's
          // docs assume, and it tests `pathname + '/'`. The documented `/api/{*splat}` compiles
          // to a regex that matches nothing here — silently, so the fallback swallowed
          // `/api/web/anything-unrouted` and answered it with index.html. These three are checked
          // against the vendored matcher in `static.module.spec.ts`; do not "modernise" them
          // without running that spec.
          exclude: DASHBOARD_EXCLUDE,
          serveStaticOptions: {
            // hashed assets are immutable; index.html must not be, or a deploy would not be seen —
            // nor the IB-069 service worker, whose fixed name is how the browser finds an update
            setHeaders: (res, path) => {
              if (!path.endsWith('index.html') && !path.endsWith('sw.js')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            },
          },
        }),
      ],
    };
  }
}
