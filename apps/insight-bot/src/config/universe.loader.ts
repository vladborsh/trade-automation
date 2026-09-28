import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { UniverseFile, UniverseFileSchema } from './universe.schema';

/**
 * Parses and validates `universe.yaml`'s text. Pure (no fs), so the specs can feed it a
 * document directly — `AGENTS.md`: anything that can be a pure function gets its own file
 * and its own spec.
 */
export function parseUniverse(text: string, path = 'universe.yaml'): UniverseFile {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (err) {
    throw new Error(`Invalid universe file ${path}: ${(err as Error).message}`);
  }
  const result = UniverseFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid universe file ${path}: ${result.error.toString()}`);
  }
  return result.data;
}

export function loadUniverseFile(path: string): UniverseFile {
  if (!fs.existsSync(path)) {
    throw new Error(`Universe file not found: ${path}`);
  }
  return parseUniverse(fs.readFileSync(path, 'utf8'), path);
}
