import { readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * The shared scanner for guards that read this repository's own source.
 *
 * ## Why it exists, and it is not DRY for its own sake
 *
 * Three guards independently needed the same two properties, and each paid for them separately:
 *
 * | guard | what it needed | how it found out |
 * |---|---|---|
 * | `regime-spec.spec.ts` (playbooks must not import regime) | a non-zero file count | an import guard passed vacuously over an empty directory |
 * | a clock sweep | comment stripping | two of twelve "suspects" were comments |
 * | `scheduler-boundaries.spec.ts` (IB-028) | both | its first run reported its OWN documentation as an offender |
 *
 * Two is a coincidence; three is a structural answer. So the two lessons live here and the fourth
 * guard inherits them instead of paying again.
 *
 * ## The two properties
 *
 * 1. **Comments are stripped, and stripped properly.** A line-based heuristic (`line.trim()`
 *    starting with a star) misses a block comment whose continuation line does not, and misses
 *    code that follows a one-line block comment on the same line. This strips with a small state
 *    machine so a guard can never report prose — including its own explanation of the pattern it
 *    forbids, which is how this was found.
 *
 *    This very comment demonstrated it: an earlier draft wrote that example literally, the inner
 *    comment terminator ended the doc block four lines early, and the prose below it became code.
 *    A file about comment handling cannot contain a comment terminator in its prose.
 * 2. **It refuses to scan nothing.** `readSourceTree` and `listFiles` THROW on an empty result
 *    rather than returning `[]`, because a guard over zero files is green for ever while guarding
 *    nothing, and that is the failure mode of every vacuous check. A thrown error names the path,
 *    so a renamed or moved tree reads as "the guard cannot find the code" rather than "the code is
 *    clean".
 *
 * Line structure is preserved: a stripped comment becomes spaces, never nothing, so reported line
 * numbers still point at the file.
 */

export interface SourceFile {
  /** Absolute path. */
  path: string;
  /** Path relative to the scanned root, forward-slashed, for stable assertions. */
  rel: string;
  /** The file with comments blanked out and line structure intact. */
  code: string;
  /** `code` split into lines, so a hit can report a line number. */
  lines: string[];
}

export interface Hit {
  rel: string;
  /** 1-indexed. */
  line: number;
  /** The code of that line, trimmed — comments already removed. */
  text: string;
}

/**
 * Blanks comments while keeping every other character in place.
 *
 * Strings are tracked so `'http://x'` and a regex-looking literal are not mistaken for comments;
 * template literals are tracked too, since this repo's SQL lives in them and contains sequences
 * that look like JavaScript comments and are not.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    const keepNewline = ch === '\n';

    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') { state = 'line'; out.push('  '); i += 2; continue; }
        if (ch === '/' && next === '*') { state = 'block'; out.push('  '); i += 2; continue; }
        if (ch === "'") state = 'single';
        else if (ch === '"') state = 'double';
        else if (ch === '`') state = 'template';
        out.push(ch);
        i += 1;
        continue;
      case 'line':
        if (keepNewline) { state = 'code'; out.push('\n'); i += 1; continue; }
        out.push(' ');
        i += 1;
        continue;
      case 'block':
        if (ch === '*' && next === '/') { state = 'code'; out.push('  '); i += 2; continue; }
        // newlines survive so line numbers do not shift
        out.push(keepNewline ? '\n' : ' ');
        i += 1;
        continue;
      case 'single':
      case 'double':
      case 'template': {
        const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
        if (ch === '\\') { out.push(ch, next ?? ''); i += 2; continue; }
        if (ch === quote) state = 'code';
        out.push(ch);
        i += 1;
        continue;
      }
    }
  }
  return out.join('');
}

export interface ListOptions {
  /** Default `.ts`. */
  ext?: string;
  /** Skip `*.spec.ts`. Default true, since a guard scanning its own siblings reports their examples. */
  skipSpecs?: boolean;
}

/** Every matching file under `dir`, recursively. **Throws when it finds none.** */
export function listFiles(dir: string, options: ListOptions = {}): string[] {
  const ext = options.ext ?? '.ts';
  const skipSpecs = options.skipSpecs ?? true;

  const walk = (at: string): string[] => {
    let entries: string[];
    try {
      entries = readdirSync(at);
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const path = `${at}/${entry}`;
      if (statSync(path).isDirectory()) return walk(path);
      if (!path.endsWith(ext)) return [];
      if (skipSpecs && path.endsWith('.spec.ts')) return [];
      return [path];
    });
  };

  const files = walk(dir);
  if (files.length === 0) {
    // not an empty array: a guard over nothing passes for ever. The message names the path because
    // the usual cause is a moved or renamed tree, not clean code.
    throw new Error(
      `source-scan: no ${ext} files under ${dir}. A guard that scans nothing is green for ever — `
      + 'check the path before believing this is a clean result.',
    );
  }
  return files.sort();
}

/** Reads and strips a tree. **Throws when it finds no files**, for the reason above. */
export function readSourceTree(root: string, options: ListOptions = {}): SourceFile[] {
  return listFiles(root, options).map((path) => {
    const code = stripComments(readFileSync(path, 'utf8'));
    return {
      path,
      rel: path.slice(root.length + 1).replace(/\\/g, '/'),
      code,
      lines: code.split('\n'),
    };
  });
}

/**
 * Lines of a tree whose (comment-stripped) code matches.
 *
 * The predicate sees stripped code only, so no guard has to remember to do that — which is the
 * whole point of this file.
 */
export function scanLines(
  files: readonly SourceFile[],
  matches: (code: string, file: SourceFile, index: number) => boolean,
): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    file.lines.forEach((code, index) => {
      if (matches(code, file, index)) hits.push({ rel: file.rel, line: index + 1, text: code.trim() });
    });
  }
  return hits;
}
