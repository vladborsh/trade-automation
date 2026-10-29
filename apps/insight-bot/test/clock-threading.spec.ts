import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * IB-051 — **a module that takes an injected instant must not also read the wall clock.**
 *
 * Two independent instances in one day — the news poller (dev-2) and `ContextService` (mine, in
 * IB-BUG-006) — made this a property of the codebase rather than two accidents. The failure shape
 * is the nastiest available: a partially threaded clock makes the SPEC pass while production runs
 * two clocks that disagree, and nothing compares them. Mine surfaced only across a UTC midnight,
 * when the service stamped `lastDailyDay` as 10-13 while a spec asked about 10-12 and the
 * duplicate-suppression test read six coin fetches where it expected three.
 *
 * ## What is a violation, and what is deliberately not
 *
 * A `Date.now()` **in a function body** is a violation. A `Date.now()` as a **default parameter**
 * is not: `poll(now = Date.now())` is the injection seam itself — production calls with no
 * argument, a spec passes an instant. Nine of the twelve modules in the original sweep were that
 * idiom, and a check that flagged them would have taught everyone to add allow-list entries
 * reflexively, which is how an allow-list stops meaning anything.
 *
 * Comments are not code. Two of the twelve were prose, one of them the sentence *"Nothing here
 * reads `Date.now()`"* — so comments are stripped before scanning rather than filtered afterwards.
 *
 * ## The allow-list is keyed by CATEGORY, not free text (Tech Lead, 2026-10-13)
 *
 * Every entry claims one of a fixed set, and a spec asserts the category is one of them. "The test
 * failed" is therefore not a sayable reason, and a case fitting no category goes to the Tech Lead
 * instead of being written in. The weakness of a rule that bites when a class gains a clock is that
 * the friction arrives while somebody is doing something else; the categories are what stop that
 * friction being discharged into the list.
 */

/** The only reasons a body may read the wall clock. */
const CATEGORIES = ['origin', 'elapsed', 'external-deadline'] as const;
type Category = (typeof CATEGORIES)[number];

interface Allowance {
  /** Path relative to `src/`. */
  file: string;
  /** The exact source line, trimmed. Keyed by text so a moved line stays allowed and an EDITED one does not. */
  line: string;
  /** How many times that line appears. A new occurrence of the same text still fails. */
  count: number;
  category: Category;
  why: string;
}

/**
 * Every allowance carries the argument for it, not a name.
 *
 * `origin` — this is where time enters the module. A timer-driven service has to ask the wall clock
 * somewhere, and that place is its composition root for time; the rule that keeps it honest is one
 * origin per path, with everything below taking the instant as a parameter.
 *
 * `elapsed` — a wall-time duration: an age, a timeout, a completion instant. **A domain clock here
 * would be the bug**, because an injected instant would report a stale age or schedule from the
 * wrong moment.
 */
const ALLOWED: readonly Allowance[] = [
  // ---- origins: where time ENTERS a module, with everything below taking it as a parameter
  {
    file: 'collectors/calendar/calendar-collector.service.ts',
    line: 'this.timer = setInterval(() => void this.tick(Date.now()), checkMs);',
    count: 1,
    category: 'origin',
    why: 'the daily-fetch check timer (IB-058); passed into tick(now) and poll(now), both of which REQUIRE the instant so a caller cannot repeat IB-051 by omission',
  },
  {
    file: 'collectors/calendar/calendar-collector.service.ts',
    line: 'await this.tick(Date.now());',
    count: 1,
    category: 'origin',
    why: 'the boot check (§3.4) — the other place time enters, read explicitly at the call rather than by a default',
  },
  {
    file: 'collectors/okx/okx.service.ts',
    line: 'const now = Date.now();',
    count: 2,
    category: 'origin',
    why: 'the socket message handler and the minute clock: both are where time enters, with nothing injected in scope',
  },
  {
    file: 'derive/derive.runner.ts',
    line: 'const now = Date.now();',
    count: 2,
    category: 'origin',
    why: 'the minute scheduler and its tick; the instant is passed into deriveClosedBuckets(now - GRACE)',
  },
  {
    file: 'features/features.runner.ts',
    line: 'const now = Date.now();',
    count: 2,
    category: 'origin',
    why: 'the scheduler, and the planned-versus-actual check — run() compares the attempt against the REAL clock precisely to detect that the process slept past the bar, which an injected clock could not tell it',
  },
  {
    file: 'features/features.cli.ts',
    line: 'const last = lastCloseMs(tf, Math.min(to, Date.now()));',
    count: 1,
    category: 'origin',
    why: 'clamps a requested range to the present: a CLI cannot compute frames for closes that have not happened',
  },
  {
    file: 'features/features.cli.ts',
    line: "const outcome = await service.runClose(onlySymbol, tf, closeMs, Date.now(), 'backfill');",
    count: 1,
    category: 'origin',
    why: 'the CLI is the composition root here and SUPPLIES the injected instant — the seam seen from the calling side',
  },
  {
    file: 'features/features.cli.ts',
    line: "const summary = await service.runPass(tf, closeMs, Date.now(), 'backfill');",
    count: 1,
    category: 'origin',
    why: 'as above, for the all-symbols path',
  },
  {
    file: 'ops/frame-audit.cli.ts',
    line: 'const now = Date.now();',
    count: 1,
    category: 'origin',
    why: 'a CLI entry point: the audit window is relative to the moment it is run, and nothing is injected',
  },
  {
    file: 'ops/gap-report.cli.ts',
    line: "const day = index === -1 ? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) : process.argv[index + 1];",
    count: 1,
    category: 'origin',
    why: 'defaults the report to yesterday when no --day is given; the explicit argument is the injected path',
  },
  {
    file: 'web/context/context.controller.ts',
    line: 'const now = Date.now();',
    count: 1,
    category: 'origin',
    why: 'a request handler: the cards it returns are relative to the moment of the request, and nothing is injected',
  },
  {
    file: 'web/context/context.controller.ts',
    line: 'const toMs = to === undefined ? Date.now() : Number(to);',
    count: 1,
    category: 'origin',
    why: 'the window default when a caller sends no `to`; an explicit `to` is the injected path',
  },

  // ---- elapsed: wall-time DURATIONS. A domain clock here would be the bug.
  {
    file: 'collectors/calendar/calendar-collector.service.ts',
    line: 'lastSuccessfulPollAge: this.lastSuccessAt === null ? null : Date.now() - this.lastSuccessAt,',
    count: 1,
    category: 'elapsed',
    why: 'an age for the health report; an injected domain clock would report a stale one',
  },
  {
    file: 'collectors/binance-perp/oi-ls.poller.ts',
    line: '.finally(() => this.scheduleNext(Date.now()));',
    count: 1,
    category: 'elapsed',
    why: 'when the poll actually FINISHED, which is what the next boundary must be measured from',
  },
  {
    file: 'backfill/backfill.cli.ts',
    line: 'const started = Date.now();',
    count: 1,
    category: 'elapsed',
    why: 'start of a duration printed at the end of the run',
  },
  {
    file: 'backfill/backfill.cli.ts',
    line: 'console.log(`\\n${coverage.length} series in ${Math.round((Date.now() - started) / 1000)} s — ${holes.length} with real holes.`);',
    count: 1,
    category: 'elapsed',
    why: 'the other half of that duration',
  },
  {
    file: 'derive/derive.cli.ts',
    line: 'const started = Date.now();',
    count: 1,
    category: 'elapsed',
    why: 'start of a duration printed at the end of the run',
  },
  {
    file: 'derive/derive.cli.ts',
    line: '`[${new Date(from).toISOString()}, ${new Date(to).toISOString()}) in ${Math.round((Date.now() - started) / 1000)} s\\n`,',
    count: 1,
    category: 'elapsed',
    why: 'the other half of that duration',
  },
];

const SRC = join(process.cwd(), 'src');

/** Comments are prose, not code — two of the original twelve suspects were comments. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Is this `Date.now()` a default-parameter initialiser — the injection seam rather than a read?
 *
 * Matched on the line, which is enough in this codebase: the idiom is always `name = Date.now()`
 * or `name: () => number = () => Date.now()` inside a signature, never assigned to a local.
 */
function isInjectionSeam(line: string): boolean {
  return /\b\w+\s*(\?)?\s*:?\s*[^=]*=\s*(\(\)\s*=>\s*)?Date\.now\b/.test(line)
    && !/^\s*(const|let|var)\b/.test(line)
    && !/^\s*this\./.test(line);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

interface Read {
  file: string;
  line: string;
}

function wallClockReads(): Read[] {
  const reads: Read[] = [];
  for (const path of filesUnder(SRC)) {
    const file = relative(SRC, path);
    for (const raw of stripComments(readFileSync(path, 'utf8')).split('\n')) {
      const line = raw.trim();
      if (!line.includes('Date.now()')) continue;
      if (isInjectionSeam(line)) continue;
      reads.push({ file, line });
    }
  }
  return reads;
}

describe('the clock is threaded, not half-threaded', () => {
  it('every wall-clock read in src/ is either a seam or allow-listed by category', () => {
    const reads = wallClockReads();
    const unexplained = reads.filter(
      (read) => !ALLOWED.some((a) => a.file === read.file && a.line === read.line),
    );
    expect(unexplained).toEqual([]);
  });

  it('every allowance matches exactly the number of reads it claims', () => {
    // a NEW occurrence of an already-allowed line still fails: the entry covers what was argued
    // for, not the text for ever
    const reads = wallClockReads();
    const mismatched = ALLOWED.map((a) => ({
      file: a.file,
      line: a.line,
      claimed: a.count,
      found: reads.filter((r) => r.file === a.file && r.line === a.line).length,
    })).filter((x) => x.claimed !== x.found);
    expect(mismatched).toEqual([]);
  });

  it('every allowance claims one of the named categories, so "the test failed" is not sayable', () => {
    for (const allowance of ALLOWED) {
      expect(CATEGORIES).toContain(allowance.category);
      expect(allowance.why.length).toBeGreaterThan(20);
    }
  });

  it('recognises the injection seam and does not flag it', () => {
    // the idiom in nine of the twelve swept modules; flagging it would train everyone to add
    // allow-list entries reflexively, which is how a list stops meaning anything
    expect(isInjectionSeam('async poll(now = Date.now()): Promise<void> {')).toBe(true);
    expect(isInjectionSeam('@Optional() private readonly now: () => number = () => Date.now(),')).toBe(true);
    expect(isInjectionSeam('const now = Date.now();')).toBe(false);
    expect(isInjectionSeam('this.globalDueAt = globalDueAfter(Date.now(), \'ok\');')).toBe(false);
  });

  it('would have caught the IB-BUG-006 defect on the day it was written', () => {
    // the real one: an injected clock on the class, and a second read in the body
    const offending = 'this.globalDueAt = globalDueAfter(Date.now(), \'ok\');';
    expect(isInjectionSeam(offending)).toBe(false);
    expect(ALLOWED.some((a) => a.line === offending)).toBe(false);
  });

  it('does not read comments as code', () => {
    const source = '// Nothing here reads `Date.now()`.\n/* also Date.now() */\nconst x = 1;';
    expect(stripComments(source).includes('Date.now()')).toBe(false);
  });
});
