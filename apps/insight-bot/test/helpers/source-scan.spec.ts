import { join } from 'node:path';
import { listFiles, readSourceTree, scanLines, stripComments } from './source-scan';

/**
 * The shared scanner is now load-bearing for three guards, so it gets the scrutiny they would
 * otherwise each need.
 *
 * Both of its properties are tested from the failing side as well as the passing one: a stripper
 * that removes too much makes a guard blind, and a stripper that removes too little makes it report
 * its own documentation — which is exactly how this file came to exist.
 */
describe('stripComments', () => {
  it('removes a line comment but keeps the code before it', () => {
    expect(stripComments("const a = 1; // void this.tick()").trimEnd()).toBe('const a = 1;');
  });

  it('removes a block comment on one line, including code AFTER it on the same line', () => {
    const stripped = stripComments('a(); /* void this.tick() */ b();');
    expect(stripped).toContain('a();');
    expect(stripped).toContain('b();');
    expect(stripped).not.toContain('void this.tick()');
  });

  it('removes a MULTI-LINE block comment whose continuation does not start with a star', () => {
    // the shape a line-based heuristic misses, and the one that reported this guard's own prose
    const source = [
      '/*',
      ' * fine',
      'void this.tick() — described, not written',
      ' */',
      'const real = 1;',
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).not.toContain('void this.tick()');
    expect(stripped).toContain('const real = 1;');
  });

  it('keeps line numbers stable, so a reported line still points at the file', () => {
    const source = '/*\n *\n */\nconst x = 1;';
    expect(stripComments(source).split('\n')).toHaveLength(4);
    expect(stripComments(source).split('\n')[3]).toBe('const x = 1;');
  });

  it('does NOT strip a comment-looking sequence inside a string', () => {
    // over-stripping is the other failure: a guard that cannot see real code is vacuous again
    expect(stripComments("const u = 'https://example.com/x';")).toContain('https://example.com/x');
    expect(stripComments('const d = "a /* b */ c";')).toContain('a /* b */ c');
  });

  it('does not strip inside a template literal, where this repo keeps its SQL', () => {
    const sql = 'const q = `select 1 -- not a js comment\n  /* nor this */`;';
    const stripped = stripComments(sql);
    expect(stripped).toContain('-- not a js comment');
    expect(stripped).toContain('/* nor this */');
  });

  it('survives an escaped quote without losing the rest of the file', () => {
    const source = "const s = 'it\\'s fine'; // gone\nconst after = 2;";
    const stripped = stripComments(source);
    expect(stripped).toContain('const after = 2;');
    expect(stripped).not.toContain('gone');
  });
});

describe('listFiles refuses to scan nothing', () => {
  const SRC = join(__dirname, '..', '..', 'src');

  it('finds the source tree and says how much it read — the positive control', () => {
    const files = listFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
  });

  it('THROWS on a path with no matching files, rather than returning an empty list', () => {
    // the whole point: an empty list is a green guard over nothing, for ever
    expect(() => listFiles(join(SRC, 'does-not-exist'))).toThrow(/no \.ts files under/);
    expect(() => listFiles(join(SRC, 'does-not-exist'))).toThrow(/green for ever/);
  });

  it('skips specs by default, so a guard does not report its siblings examples', () => {
    expect(listFiles(SRC).some((f) => f.endsWith('.spec.ts'))).toBe(false);
  });

  it('can be asked for a different extension', () => {
    const migrations = listFiles(join(__dirname, '..', '..', 'migrations'), { ext: '.sql' });
    expect(migrations.length).toBeGreaterThan(20);
    expect(migrations.every((f) => f.endsWith('.sql'))).toBe(true);
  });
});

describe('readSourceTree and scanLines', () => {
  const SRC = join(__dirname, '..', '..', 'src');

  it('hands the predicate stripped code, with a relative path and a line number', () => {
    const files = readSourceTree(SRC);
    const hits = scanLines(files, (code) => code.includes('export function stripComments'));
    expect(hits).toEqual([]); // the helper is in test/, not src/ — so this proves the tree, not the string

    const exports = scanLines(files, (code) => code.includes('export class DexService'));
    expect(exports).toHaveLength(1);
    expect(exports[0].rel).toBe('dex/dex.service.ts');
    expect(exports[0].line).toBeGreaterThan(1);
    expect(exports[0].text).toContain('export class DexService');
  });

  it('finds nothing for a pattern that only appears in comments — the property that matters', () => {
    const files = readSourceTree(SRC);
    // `never-reject.ts` documents the forbidden shape at length; stripped, it is not there
    const hits = scanLines(files, (code) => code.includes('setInterval(() => void this.tick(), MS)'));
    expect(hits).toEqual([]);
  });
});
