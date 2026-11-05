import type { Locator, Page } from '@playwright/test';

/**
 * IB-BUG-045 — open a dashboard page and wait until it is READY, not until a time has passed.
 *
 * `page.goto` resolves on the document's `load` event, and that comes BEFORE the app has booted: the
 * Angular bootstrap, `/auth/me`, the lazy route chunk, the page's API reads and the render all happen
 * after it. Measured on a warm :4235 (one run, 2026-11-05): `goto` returned at 5.24 s, the immediate
 * `page.clock.runFor(2_000)` at 5.29 s, Angular started at 5.46 s, the Market reads went out at
 * 6.09 s, the cards were there at 6.85 s. So a `runFor` straight after `goto` advances a page that
 * has not started, and the first `expect` (5 s) was the only real wait — for boot + chunk + data +
 * render. Cold `ng serve` (Vite bundles dependencies on the first request) on a loaded machine
 * pushed that past 5 s: «app-insight-card 0 vs 3». CPU throttling reproduces it on demand (8×: 0
 * cards after 5 s, the insights answer landing 0.5 s before the deadline; 12×: not even asked).
 *
 * Here every stage is an event or a state: each named `/api/web` path SERVED (the route mock's
 * answer delivered to the page), then `ready` attached. Neither has a budget of its own — the test's
 * timeout is the only bound — so a slow machine makes the test slower, not red; a page that never
 * asks, or never renders, still fails, naming the path or the element it waited for.
 * Call `page.clock.runFor` AFTER this: only then does it advance a running page.
 */
export async function gotoReady(page: Page, url: string, opts: { served: readonly string[]; ready: Locator }): Promise<void> {
  const served = opts.served.map((path) =>
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/web${path}`, { timeout: 0 }));
  // a goto that throws must not leave the waits as unhandled rejections; they are awaited below
  for (const s of served) s.catch(() => undefined);
  await page.goto(url);
  await Promise.all(served);
  await opts.ready.waitFor({ state: 'attached', timeout: 0 });
}
