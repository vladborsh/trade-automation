/**
 * architecture/backtest-app-system-design.md §9.2 — the upload is checked for being a real PNG
 * and its dimensions are read from the header, with no image library: the 8-byte signature,
 * then the first chunk, which the PNG spec requires to be IHDR (13 bytes: width and height as
 * big-endian uint32, then depth, colour type, …).
 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngInfo {
  width: number;
  height: number;
}

/** Width and height from a PNG's IHDR; null when `bytes` is not a PNG or the header is malformed. */
export function readPngInfo(bytes: Buffer): PngInfo | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  // the spec caps both at 2^31 - 1 and forbids 0
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) return null;
  return { width, height };
}
