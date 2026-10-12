import {
  WebCoverageResponseSchema, WebFrameCoverageSchema,
} from '../src/insight/coverage';

/**
 * IB-015 — the frame block of `GET /api/web/coverage`.
 *
 * These assertions are about the SHAPE carrying its meaning, not about arithmetic. The counts
 * themselves are produced and tested in `apps/insight-bot`; what matters here is that a reader
 * of the contract cannot confuse the four of them, and that adding the block did not break a
 * client built against the earlier response.
 */
describe('WebFrameCoverageSchema', () => {
  const row = {
    tf: '15m',
    expected: 96,
    written: 96,
    incomplete: 0,
    explainedOnly: 3,
    unhealed: 0,
    oldestUnhealed: null,
  };

  it('parses a healthy day', () => {
    expect(WebFrameCoverageSchema.parse(row)).toEqual(row);
  });

  it('keeps explainedOnly and incomplete as SEPARATE counts', () => {
    // The distinction is the block's reason for existing: a frame refusing only permanent keys
    // is `complete = false` for ever and there is nothing for anyone to do about it. If the two
    // shared a field, a dashboard would light up over a symbol that simply listed last week.
    const parsed = WebFrameCoverageSchema.parse({ ...row, explainedOnly: 12, incomplete: 0 });
    expect(parsed.explainedOnly).toBe(12);
    expect(parsed.incomplete).toBe(0);
  });

  it('allows written below expected, which is how a pass that never ran becomes visible', () => {
    const parsed = WebFrameCoverageSchema.parse({ ...row, written: 40 });
    expect(parsed.expected - parsed.written).toBe(56);
  });

  it('carries the oldest unhealed close so the figure can be acted on, not just counted', () => {
    const at = Date.UTC(2026, 9, 11, 3, 0, 0);
    const parsed = WebFrameCoverageSchema.parse({ ...row, unhealed: 2, oldestUnhealed: at });
    expect(parsed.oldestUnhealed).toBe(at);
  });

  it('rejects a fractional count — frames are counted, never averaged', () => {
    expect(() => WebFrameCoverageSchema.parse({ ...row, unhealed: 0.5 })).toThrow();
  });
});

describe('the frame block inside the coverage response', () => {
  it('defaults to empty, so a client built before IB-015 keeps parsing', () => {
    const parsed = WebCoverageResponseSchema.parse({ rows: [] });
    expect(parsed.frames).toEqual([]);
  });

  it('is its OWN field, not a member of collectors', () => {
    // Deliberate: a stream can be live for every hour of the window while every frame in it
    // refuses. Merging them would make a frame problem read as a collector problem.
    const parsed = WebCoverageResponseSchema.parse({
      rows: [],
      frames: [{
        tf: '4h', expected: 6, written: 6, incomplete: 1, explainedOnly: 0,
        unhealed: 1, oldestUnhealed: Date.UTC(2026, 9, 11, 0, 0, 0),
      }],
    });
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.collectors).toEqual([]);
    expect(Object.keys(parsed)).toContain('frames');
  });
});
