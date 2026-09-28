/**
 * IB-012 — the CSV inside a data.binance.vision zip.
 *
 * Two quirks the archive actually has, both measured in `research/`: some files carry a header
 * row and some do not (Binance added one to klines during 2025), and a file can end without a
 * trailing newline. Nothing here quotes or escapes — these files are plain numeric CSV — so a
 * full CSV parser would be more surface than the format warrants.
 */

/**
 * A header row is one whose first field is neither a number nor a date.
 *
 * "Not a number" alone is not enough: the metrics files' first column is a formatted datetime
 * (`2026-09-27 00:05:00`), so that rule silently ate the first row of every metrics file.
 */
export function looksLikeHeader(fields: readonly string[]): boolean {
  const first = (fields[0] ?? '').trim();
  if (first.length === 0) return false;
  if (/^-?\d+(\.\d+)?$/.test(first)) return false;
  return !Number.isFinite(Date.parse(first));
}

/** Splits the file into rows of fields, dropping a header row and any blank lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const fields = trimmed.split(',');
    if (rows.length === 0 && looksLikeHeader(fields)) continue;
    rows.push(fields);
  }
  return rows;
}
