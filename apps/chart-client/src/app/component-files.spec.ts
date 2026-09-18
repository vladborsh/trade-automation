/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard for AGENTS.md "Angular components": one component = three files.
 *
 * - No inline `template:` / `styles:` in any `@Component` under `src` (rule 1). Host components
 *   declared inside a `*.spec.ts` are exempt, so spec files are not scanned.
 * - A `*.component.ts` stays at or under 250 lines (rule 3) unless listed in OVERSIZED below.
 */
const SRC_DIR = join(process.cwd(), 'src');
const MAX_COMPONENT_LINES = 250;

/**
 * Components allowed over MAX_COMPONENT_LINES, each with a ceiling at today's size so an
 * oversized file cannot grow further (AGENTS.md rule 3: extract before adding). When a file
 * shrinks, lower its ceiling; when it drops to 250 or below, delete its entry.
 */
const OVERSIZED: Record<string, number> = {
  // Series lifecycle, range sync, scroll-back paging and crosshair wiring all live in one
  // class. Splitting it is separate work (architecture/four-streams-2026-09-18.md §D2).
  'app/features/chart/chart.component.ts': 610,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function lineCount(source: string): number {
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

/** The argument text of every `@Component(...)` decorator in `source`. */
function componentDecorators(source: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('@Component(', from);
    if (start < 0) return found;
    let depth = 0;
    let i = start + '@Component'.length;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) break;
    }
    found.push(source.slice(start, i + 1));
    from = i + 1;
  }
}

/** The inline keys (`template`, `styles`) a decorator uses instead of templateUrl/styleUrl. */
function inlineKeys(decorator: string): string[] {
  return [...decorator.matchAll(/^\s*(template|styles)\s*:/gm)].map((m) => m[1]);
}

describe('component files (AGENTS.md "Angular components")', () => {
  const files = sourceFiles(SRC_DIR).map((path) => ({
    path: relative(SRC_DIR, path).split('\\').join('/'),
    source: readFileSync(path, 'utf8'),
  }));
  const componentFiles = files.filter((f) => componentDecorators(f.source).length > 0);

  it('scans the real component tree', () => {
    expect(componentFiles.map((f) => f.path)).toContain('app/app.ts');
    expect(componentFiles.length).toBeGreaterThanOrEqual(17);
  });

  it('has no inline template: or styles: in any @Component', () => {
    const offenders = componentFiles.flatMap((f) =>
      componentDecorators(f.source).flatMap((d) => inlineKeys(d).map((key) => `${f.path} (${key}:)`)),
    );
    expect(offenders).toEqual([]);
  });

  it(`keeps every .component.ts at or under ${MAX_COMPONENT_LINES} lines unless allowlisted`, () => {
    const offenders = files
      .filter((f) => f.path.endsWith('.component.ts'))
      .map((f) => ({ path: f.path, lines: lineCount(f.source) }))
      .filter((f) => f.lines > (OVERSIZED[f.path] ?? MAX_COMPONENT_LINES))
      .map((f) => `${f.path}: ${f.lines} lines (limit ${OVERSIZED[f.path] ?? MAX_COMPONENT_LINES})`);
    expect(offenders).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(OVERSIZED).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || lineCount(file.source) <= MAX_COMPONENT_LINES;
    });
    expect(stale).toEqual([]);
  });

  it('detects inline template and styles (the guard is not vacuous)', () => {
    const decorators = componentDecorators(
      "@Component({ selector: 'x',\n  template: `<p></p>`,\n  styles: [`p {}`],\n})\nclass X {}",
    );
    expect(decorators.length).toBe(1);
    expect(inlineKeys(decorators[0])).toEqual(['template', 'styles']);
    expect(inlineKeys("@Component({\n  templateUrl: './x.html',\n  styleUrl: './x.scss',\n})")).toEqual([]);
  });
});
