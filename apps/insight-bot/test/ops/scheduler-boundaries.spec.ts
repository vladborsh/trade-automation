import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { neverReject, type ErrorSink } from '../../src/ops/never-reject';
import { readSourceTree, scanLines } from '../helpers/source-scan';

/**
 * IB-028 — every scheduler boundary must be unable to reject, and this is the guard that keeps it
 * true for boundaries nobody has written yet.
 *
 * ## The failure it exists to prevent
 *
 * A timer callback cannot await, so schedulers are written `setInterval(() => void this.tick())`.
 * `void` discards the promise, a rejection becomes an unhandled promise rejection, and since Node 15
 * the default for those is to **terminate the process** — the collectors, the news ingest, the DEX
 * snapshots, the web API and the member bot, all of them, from one throw in one tick body.
 *
 * It is not hypothetical: GoPlus answered `"result": null` on 2026-10-13, `Object.keys(null)` threw
 * inside the DEX tick, and the only reason it did not end the process is that the throw happened to
 * be inside a try/catch one level down. The containment in the collectors covers *one source failing
 * without affecting the others*; it does not cover a throw in the tick body, which affects every
 * source at once.
 *
 * Asking fifteen tick bodies to be exhaustive is a rule that needs discipline in the error path
 * nobody exercises. This fails the build instead.
 */

const SRC = join(__dirname, '..', '..', 'src');

/**
 * Boundaries that may stay bare, each for a stated reason. An escape hatch with an empty list is a
 * rule pretending to be a mechanism; one with unexplained entries is the same thing with extra
 * steps.
 */
const ALLOWED: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'collectors/context/coingecko.gate.ts',
    why: 'framework-free by design — the file has no imports at all, so it has no logger to record '
      + 'through, and `pump` awaits only an injected sleep and a task that catches its own errors. '
      + 'Giving it a logger to satisfy this guard would be a design change in another task s file.',
  },
];

/** `void this.something(` with no `.catch` on the same line — the shape that kills the process. */
const BARE = /void\s+(this|\(this)\b[^;]*\(/;

describe('every scheduler boundary is unable to reject', () => {
  const allowedFiles = new Set(ALLOWED.map((a) => a.file));
  // `readSourceTree` strips comments and THROWS if it reads no files — the two properties this
  // guard, dev-1's import guard and the clock sweep each needed and each had to learn separately
  const files = readSourceTree(SRC);

  const offenders = scanLines(files, (code, file) => {
    if (!BARE.test(code)) return false;
    if (code.includes('.catch(')) return false;      // handled inline
    if (code.includes('neverReject')) return false;   // handled by the boundary helper
    // a multi-line chain: `void this.x()` with `.catch(` on a following line
    const index = file.lines.indexOf(code);
    if (file.lines.slice(index + 1, index + 4).some((l) => l.includes('.catch('))) return false;
    return !allowedFiles.has(file.rel);
  }).map((hit) => `${hit.rel}:${hit.line}: ${hit.text}`);

  it('has no boundary that discards a promise without recording its rejection', () => {
    expect(offenders).toEqual([]);
  });

  it('read the source tree, so a green result is about the code and not about the path', () => {
    // the shared scanner throws on an empty tree, and this states the count the result rests on
    expect(files.length).toBeGreaterThan(50);
  });

  it('allows only boundaries with a written reason', () => {
    // an allow-list is a record of decisions, so an entry without a reason is not a decision
    for (const entry of ALLOWED) {
      expect(entry.why.length).toBeGreaterThan(40);
      expect(files.map((f) => f.rel)).toContain(entry.file);
    }
  });

  it('would catch a new bare boundary — the control on the regex itself', () => {
    // without this the guard could pass by matching nothing, which is how an import guard once
    // passed over an empty directory
    expect(BARE.test('    this.timer = setInterval(() => void this.tick(), MS);')).toBe(true);
    expect(BARE.test('    void this.pump();')).toBe(true);
    expect(BARE.test("    this.timer = setInterval(() => neverReject(this.logger, 'x', () => this.tick()), MS);"))
      .toBe(false);
  });
});

describe('neverReject', () => {
  const sink = () => {
    const lines: string[] = [];
    return { lines, sink: { error: (message: string) => lines.push(message) } satisfies ErrorSink };
  };

  it('records an async rejection and does not rethrow', async () => {
    const { lines, sink: s } = sink();
    neverReject(s, 'dex tick', () => Promise.reject(new Error('connection terminated')));
    await Promise.resolve();
    await Promise.resolve();
    expect(lines.join()).toContain('dex tick failed');
    expect(lines.join()).toContain('connection terminated');
  });

  it('records a SYNCHRONOUS throw, which a bare .catch would never see', () => {
    // the likeliest shape for a mapping error: the body throws before returning a promise
    const { lines, sink: s } = sink();
    neverReject(s, 'news tick', () => { throw new Error('Cannot convert undefined or null to object'); });
    expect(lines.join()).toContain('news tick threw synchronously');
    expect(lines.join()).toContain('null to object');
  });

  it('says nothing when the body succeeds — a quiet boundary is the normal case', async () => {
    const { lines, sink: s } = sink();
    neverReject(s, 'quiet', () => Promise.resolve(1));
    await Promise.resolve();
    expect(lines).toEqual([]);
  });

  it('accepts a Nest Logger structurally, so no service needs an adapter', () => {
    // the type is a sink rather than Logger precisely so a framework-free collector port fits too
    const logger: ErrorSink = new Logger('spec');
    expect(typeof logger.error).toBe('function');
  });

  it('keeps a non-Error rejection readable instead of printing [object Object]', async () => {
    const { lines, sink: s } = sink();
    neverReject(s, 'odd', () => Promise.reject('a string rejection'));
    await Promise.resolve();
    await Promise.resolve();
    expect(lines.join()).toContain('a string rejection');
  });
});
