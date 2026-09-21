import { BodyTooLargeError, mediaType, readLimitedBody } from '../../src/backtest/upload-body';

function source(chunks: (Buffer | string)[]) {
  let consumed = 0;
  let destroyed = false;
  const iterable = {
    destroy: () => {
      destroyed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        consumed++;
        yield c;
      }
    },
  };
  return { iterable, consumed: () => consumed, destroyed: () => destroyed };
}

describe('readLimitedBody', () => {
  it('concatenates the chunks up to the cap', async () => {
    const s = source([Buffer.from('ab'), 'cd', Buffer.from('e')]);
    await expect(readLimitedBody(s.iterable, '5', 5)).resolves.toEqual(Buffer.from('abcde'));
  });

  it('refuses on the declared Content-Length before reading a byte', async () => {
    const s = source([Buffer.alloc(10)]);
    await expect(readLimitedBody(s.iterable, '11', 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(s.consumed()).toBe(0);
  });

  it('stops at the first chunk past the cap when no (or a false) length is declared, and destroys the stream', async () => {
    const s = source([Buffer.alloc(6), Buffer.alloc(6), Buffer.alloc(6)]);
    await expect(readLimitedBody(s.iterable, undefined, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(s.consumed()).toBe(2);
    expect(s.destroyed()).toBe(true);
    const lying = source([Buffer.alloc(8), Buffer.alloc(8)]);
    await expect(readLimitedBody(lying.iterable, '4', 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('mediaType drops parameters and case', () => {
    expect(mediaType('Image/PNG; charset=binary')).toBe('image/png');
    expect(mediaType(undefined)).toBe('');
  });
});
