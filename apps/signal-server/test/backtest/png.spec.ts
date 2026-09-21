import { readPngInfo } from '../../src/backtest/png';
import { makePng } from './png-fixture';

describe('readPngInfo (IHDR, no image library)', () => {
  it('reads width and height from a real PNG', () => {
    expect(readPngInfo(makePng(640, 360))).toEqual({ width: 640, height: 360 });
    expect(readPngInfo(makePng(1, 1))).toEqual({ width: 1, height: 1 });
  });

  it('rejects anything that is not a PNG, or a malformed header', () => {
    const png = makePng(10, 10);
    expect(readPngInfo(Buffer.from('GIF89a…not a png at all, but long enough to read'))).toBeNull();
    expect(readPngInfo(Buffer.alloc(0))).toBeNull();
    expect(readPngInfo(png.subarray(0, 20))).toBeNull(); // truncated before the size fields
    const wrongChunk = Buffer.from(png);
    wrongChunk.write('IDAT', 12, 'latin1'); // first chunk must be IHDR
    expect(readPngInfo(wrongChunk)).toBeNull();
    const zeroWidth = Buffer.from(png);
    zeroWidth.writeUInt32BE(0, 16);
    expect(readPngInfo(zeroWidth)).toBeNull();
    const huge = Buffer.from(png);
    huge.writeUInt32BE(0x80000000, 20);
    expect(readPngInfo(huge)).toBeNull();
  });
});
