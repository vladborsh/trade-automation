/**
 * Reads a raw request body with a hard size cap. Nest's Express adapter only parses JSON and
 * urlencoded bodies, so an `image/png` request arrives unread, as a stream. This refuses on the
 * declared `Content-Length` before reading a byte, and otherwise counts bytes as they stream in
 * and stops at the first chunk past the cap (also covering chunked uploads with no length). A
 * body over the cap is therefore never buffered whole.
 */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`body exceeds ${maxBytes} bytes`);
  }
}

export async function readLimitedBody(
  body: AsyncIterable<Buffer | string | Uint8Array> & { destroy?: () => void },
  declaredLength: string | undefined,
  maxBytes: number,
): Promise<Buffer> {
  if (declaredLength !== undefined && Number(declaredLength) > maxBytes) throw new BodyTooLargeError(maxBytes);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      body.destroy?.();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** `image/png; charset=binary` → `image/png`. */
export function mediaType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}
