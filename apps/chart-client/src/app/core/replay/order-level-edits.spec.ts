import type { PositionToolState } from '../../features/chart/overlay/position-tool.model';
import { OrderLevelEdits, modifyFromDrop } from './order-level-edits';

const ORDER = { id: 'o1', slCurrent: 99, tpCurrent: 110 };
const tool = (over: Partial<PositionToolState>): PositionToolState => ({
  id: 'o1', orderId: 'o1', side: 'long', mode: 'market', entry: 100.25, sl: 99, tp: 110, kind: 'position', active: true, anchorTime: 0, ...over,
});

describe('modifyFromDrop (T-033)', () => {
  it('an unchanged drop is nothing', () => {
    expect(modifyFromDrop(ORDER, tool({}), 102, 5)).toBeNull();
  });

  it('a stop moved to break-even or trailed into profit is a modify with only the changed level', () => {
    expect(modifyFromDrop(ORDER, tool({ sl: 100.25 }), 102, 5)).toEqual({ input: { kind: 'modify', cursorMs: 5, orderId: 'o1', sl: 100.25 } });
    expect(modifyFromDrop(ORDER, tool({ sl: 101, tp: 105 }), 102, 5)).toEqual({ input: { kind: 'modify', cursorMs: 5, orderId: 'o1', sl: 101, tp: 105 } });
  });

  it('a level dropped into the market is a hint, never a request (the server rule)', () => {
    expect(modifyFromDrop(ORDER, tool({ sl: 102.5 }), 102, 5)).toEqual({ hint: 'A long stop must stay below the last close.' });
    expect(modifyFromDrop(ORDER, tool({ sl: 102 }), 102, 5)).toEqual({ hint: 'The stop is too close to the last close.' });
    expect(modifyFromDrop(ORDER, tool({ tp: 101 }), 102, 5)).toEqual({ hint: 'A long target must stay above the last close.' });
  });

  it('a pending order is checked against its limit', () => {
    const pending = tool({ kind: 'pending', mode: 'limit', entry: 99.5 });
    expect(modifyFromDrop(ORDER, { ...pending, sl: 99.6 }, 100, 5)).toEqual({ hint: 'A long stop must stay below the limit.' });
    expect(modifyFromDrop(ORDER, { ...pending, sl: 98.5 }, 100, 5)).toEqual({ input: { kind: 'modify', cursorMs: 5, orderId: 'o1', sl: 98.5 } });
  });
});

describe('OrderLevelEdits', () => {
  it('draws an edit over the order, until cleared', () => {
    const edits = new OrderLevelEdits();
    expect(edits.levelsOf(ORDER)).toEqual({ sl: 99, tp: 110 });
    edits.set('o1', { sl: 100, tp: 110 });
    expect(edits.levelsOf(ORDER)).toEqual({ sl: 100, tp: 110 });
    edits.clear('o1');
    expect(edits.levelsOf(ORDER)).toEqual({ sl: 99, tp: 110 });
    edits.set('o1', { sl: 100, tp: 110 });
    edits.clearAll();
    expect(edits.levelsOf(ORDER)).toEqual({ sl: 99, tp: 110 });
  });
});
