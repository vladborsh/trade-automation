import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * IB-152 (owner ruling A): every time the site shows goes through `time-format.ts`. This is that rule
 * as a check: it scans the dashboard's sources (as `no-literals.spec.ts` scans the templates) and
 * fails on a new way of turning a moment into text that bypasses the formatter.
 *
 * Each pattern is a door the old code used: `toISOString().slice` (UTC, the format of the day it was
 * written), `toLocale*String` and `DatePipe` (the browser's format), a bare `Intl.DateTimeFormat`,
 * `getUTCHours`/`getHours` and `padStart(2, '0')` (an `HH:MM` built by hand). The numeric
 * `toLocaleString('en-US', …)` stays allowed: every one in the app formats a NUMBER; a Date passed
 * there would read as `11/6/2026, 5:15:00 PM`, which a reviewer sees, but this check does not.
 */

const APP_DIR = join(process.cwd(), 'projects', 'insight-dashboard', 'src', 'app');

const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'toLocaleTimeString / toLocaleDateString', re: /\.toLocale(Time|Date)String\(/ },
  { name: 'toLocaleString that is not the numeric en-US form', re: /\.toLocaleString\((?!'en-US')/ },
  { name: 'Intl.DateTimeFormat', re: /Intl\.DateTimeFormat/ },
  { name: 'DatePipe / the date pipe', re: /\bDatePipe\b|\|\s*date\b/ },
  { name: 'toISOString()', re: /\.toISOString\(\)/ },
  { name: 'a clock read by hand (get[UTC]Hours/Minutes/Seconds/Date/Month, getTimezoneOffset)', re: /\.get(UTC)?(Hours|Minutes|Seconds|Date|Month)\(|getTimezoneOffset\(/ },
  { name: 'a two-digit pad (a hand-built HH:MM)', re: /padStart\(2,\s*'0'\)/ },
  { name: 'a timeZone option outside the formatter', re: /\btimeZone\s*:/ },
];

/**
 * Files allowed to use a rule, with the reason. Short on purpose: a new entry needs an argument that
 * it renders nothing, or that it IS the formatter.
 */
const ALLOWED: ReadonlyArray<readonly [file: string, rules: readonly string[], reason: string]> = [
  [join('shared', 'time-format.ts'), RULES.map((r) => r.name), 'the formatter itself'],
  [
    join('features', 'instrument', 'trading-sessions.ts'),
    ['Intl.DateTimeFormat', 'a timeZone option outside the formatter'],
    "computes London's and New York's session hours as UTC instants (DST-correct); it renders no text",
  ],
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if ((name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.includes('fixture')) || name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** Comment lines say what a format WAS (`YYYY-MM-DD`, `toISOString`); only code is checked. */
function codeLines(text: string): Array<{ n: number; line: string }> {
  return text.split('\n').map((line, i) => ({ n: i + 1, line })).filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

export function violations(file: string, text: string): string[] {
  const allowed = new Set(ALLOWED.filter(([f]) => f === file).flatMap(([, rules]) => rules));
  const out: string[] = [];
  for (const { n, line } of codeLines(text)) {
    for (const rule of RULES) if (!allowed.has(rule.name) && rule.re.test(line)) out.push(`${file}:${n} — ${rule.name}: ${line.trim()}`);
  }
  return out;
}

describe('time-format guard (IB-152): every rendered time goes through shared/time-format.ts', () => {
  const files = sources(APP_DIR);

  it('scans the app (a guard that read nothing would pass)', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f.endsWith(join('liquidations', 'liq-layout.ts')))).toBe(true);
  });

  it('finds no direct time formatting outside the formatter', () => {
    const found = files.flatMap((f) => violations(relative(APP_DIR, f), readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });

  it('catches each old door (the check can disagree)', () => {
    const file = join('features', 'x.ts');
    const bad = [
      "const t = new Date(ms).toISOString().slice(11, 16);",
      "d.toLocaleTimeString('en-GB', { hour: '2-digit' });",
      "new Date().toLocaleString();",
      "new Intl.DateTimeFormat('ru', { weekday: 'short' });",
      "{{ row.time * 1000 | date: 'HH:mm' }}",
      "imports: [DatePipe],",
      "`${d.getUTCHours()}:${d.getUTCMinutes()}`",
      "String(n).padStart(2, '0')",
      "fmt({ timeZone: 'UTC' })",
    ];
    for (const line of bad) expect(violations(file, line), line).not.toEqual([]);
    expect(violations(file, "v.toLocaleString('en-US', { maximumFractionDigits: 2 })")).toEqual([]);
    expect(violations(file, ' * the old `toISOString().slice` format')).toEqual([]);
  });

  it('the allowlist is the formatter and one non-rendering file, each with a reason', () => {
    for (const [file, , reason] of ALLOWED) {
      expect(files.map((f) => relative(APP_DIR, f))).toContain(file);
      expect(reason.length).toBeGreaterThan(10);
    }
    expect(ALLOWED.length).toBe(2);
  });
});
