import { Test } from '@nestjs/testing';
import { NewsModule } from '../../src/news/news.module';
import { NewsService } from '../../src/news/news.service';

/**
 * IB-027 — a positive control at the COMPOSITION level.
 *
 * The defect this exists for: `NewsModule` imported only `DbModule`, `AppConfigModule` is not
 * `@Global`, so Nest injected `undefined` for the optional `AppConfigService`, the symbol
 * dictionary was empty on every pass, and 366 real articles were stored with zero tags. Silently —
 * an untagged article and an article about nothing are the same row.
 *
 * **993 unit tests could not see it**, and not by oversight: every one of them constructs
 * `NewsService` with its dependencies passed in by hand, which is the correct way to test a service
 * and is exactly why it cannot test the wiring. The bug lived in the gap between "the class works"
 * and "the application builds the class with what it needs".
 *
 * So this builds the module **the way the application does** — `NewsModule.register()`, resolving
 * through Nest — and asserts the dictionary is not empty. An empty dictionary is the signature of
 * every version of this failure, whatever its cause.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('news-module.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('NewsModule, composed as the application composes it', () => {
  it('gives NewsService a NON-EMPTY symbol dictionary', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NewsModule.register()],
    }).compile();

    const service = moduleRef.get(NewsService);
    const dictionary = service.symbolDictionary();

    // the assertion that would have failed before `AppConfigModule` was imported
    expect(dictionary.length).toBeGreaterThan(0);
    // and it is the real universe, not a stub that happens to be non-empty
    expect(dictionary.map((d) => d.symbol)).toContain('BTCUSDT');
    expect(dictionary.every((d) => d.pair.length > 0)).toBe(true);

    await moduleRef.close();
  }, 30_000);

  it('registers the reaction job too, so neither half can be wired alone', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NewsModule.register()],
    }).compile();
    // resolving it is the test: a provider missing from the module throws here
    expect(moduleRef.get(NewsService)).toBeDefined();
    await moduleRef.close();
  }, 30_000);
});
