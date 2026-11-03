import { fngBand, fundingSide, liqSide } from '../../../../src/web/market/positioning/kpis.rules';

describe('KPI context words (D10)', () => {
  it('F&G bands are the ones alternative.me uses', () => {
    expect([0, 24, 25, 44, 45, 55, 56, 75, 76, 100].map(fngBand)).toEqual([
      'extreme_fear', 'extreme_fear', 'fear', 'fear', 'neutral', 'neutral', 'greed', 'greed', 'extreme_greed', 'extreme_greed',
    ]);
  });

  it('liquidation side and share; funding side', () => {
    expect(liqSide(5_813_960, 11_580_111)).toEqual({ side: 'short', sharePct: 67 });
    expect(liqSide(0, 0)).toEqual({ side: 'long', sharePct: 0 });
    expect([0.0001, -0.0001, 0].map(fundingSide)).toEqual(['longs_pay', 'shorts_pay', 'flat']);
  });
});
