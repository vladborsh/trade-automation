import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ru } from '../../i18n/ru';
import { SIDE_VERDICT_MIN, sideVerdict } from './liq-side-verdict';

/** IB-108 — «лонги ×2.2 / шорты ×3.3 / поровну»: the bigger side over the smaller, 1.5× threshold. */
describe('sideVerdict', () => {
  it('the bigger side over the smaller, with the page’s × format', () => {
    expect(sideVerdict(6.2e6, 2.8e6)).toEqual({ key: 'liq.side.moreLongs', params: { ratio: '×2.2' }, side: 'long' });
    expect(sideVerdict(5e6, 16.5e6)).toEqual({ key: 'liq.side.moreShorts', params: { ratio: '×3.3' }, side: 'short' });
    expect(sideVerdict(1e5, 1.2e6)?.params.ratio).toBe('×12');
  });

  it('the threshold is 1.5×: just under is «поровну», at it is a side', () => {
    expect(SIDE_VERDICT_MIN).toBe(1.5);
    expect(sideVerdict(1.49, 1)?.side).toBe('even');
    expect(sideVerdict(1, 1.49)?.key).toBe('liq.side.even');
    expect(sideVerdict(1.5, 1)).toMatchObject({ side: 'long', params: { ratio: '×1.5' } });
    expect(sideVerdict(1, 1)?.side).toBe('even');
  });

  it('one side empty is not «×∞»: it names the side alone; both empty — no verdict', () => {
    expect(sideVerdict(3e5, 0)).toEqual({ key: 'liq.side.onlyLongs', params: { ratio: '' }, side: 'long' });
    expect(sideVerdict(0, 3e5)?.key).toBe('liq.side.onlyShorts');
    expect(sideVerdict(0, 0)).toBeNull();
  });

  it('every verdict reads in both languages', () => {
    for (const key of ['liq.side.moreLongs', 'liq.side.moreShorts', 'liq.side.even', 'liq.side.onlyLongs', 'liq.side.onlyShorts']) {
      for (const t of [ru, en]) expect((t as Record<string, string>)[key]).toBeTruthy();
    }
    expect(ru['liq.side.moreLongs' as keyof typeof ru]).toBe('лонги {ratio}');
  });
});
