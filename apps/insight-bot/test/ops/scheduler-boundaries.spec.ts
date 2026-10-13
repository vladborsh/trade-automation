import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { neverReject, type ErrorSink } from '../../src/ops/never-reject';

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

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** `void this.something(` with no `.catch` on the same line — the shape that kills the process. */
const BARE = /void\s+(this|\(this)\b[^;]*\(/;

describe('every scheduler boundary is unable to reject', () => {
  const offenders: string[] = [];
  const allowedFiles = new Set(ALLOWED.map((a) => a.file));

  for (const path of tsFiles(SRC)) {
    const rel = path.slice(SRC.length + 1).replace(/\\/g, '/');
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // comments mention these boundaries by name — including this guard's own explanation of them,
      // and the comment in `never-reject.ts` describing the shape it replaces. A scanner that reads
      // prose as code reports its own documentation.
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return;
      const code = line.split('//')[0];
      if (!BARE.test(code)) return;
      if (code.includes('.catch(')) return;           // handled inline
      if (code.includes('neverReject')) return;        // handled by the boundary helper
      // a multi-line chain: `void this.x()` then `.catch(` on a following line
      if (lines.slice(i + 1, i + 4).some((l) => l.includes('.catch('))) return;
      if (allowedFiles.has(rel)) return;
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }

  it('has no boundary that discards a promise without recording its rejection', () => {
    expect(offenders).toEqual([]);
  });

  it('allows only boundaries with a written reason', () => {
    // an allow-list is a record of decisions, so an entry without a reason is not a decision
    for (const entry of ALLOWED) {
      expect(entry.why.length).toBeGreaterThan(40);
      expect(tsFiles(SRC).map((p) => p.slice(SRC.length + 1))).toContain(entry.file);
    }
  });

  it('would catch a new bare boundary — the control on the regex itself', () => {
    // without this the guard could pass by matching nothing, which is how an import guard once
    // passed over an empty directory
    expect(BARE.test('    this.timer = setInterval(() => void this.tick(), MS);')).toBe(true);
    expect(BARE.test('    void this.pump();')).toBe(true);
    // and the prose that describes the shape must not be read as the shape
    expect('     * `setInterval(() => void this.tick(), MS)` is the shape'.trim().startsWith('*')).toBe(true);
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
