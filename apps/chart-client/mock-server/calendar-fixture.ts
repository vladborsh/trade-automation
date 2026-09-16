/**
 * §7.2 — committed fixture standing in for the real ForexFactory 2026-09-16
 * capture (architecture/economic-calendar.md §1.2), re-dated to "this week"
 * at mock-server startup (calendar-state.ts) so the "now" line always lands
 * mid-week. A representative subset of the note's own examples (Federal
 * Funds Rate, the twice-a-week Lagarde speech, the `All`-country BRICS
 * Summit row, a Low/Medium/High spread, empty forecast/previous on
 * speeches) rather than the full 105-row real capture, which is
 * SE-CAL-1's fixture under `apps/signal-server/test/fixtures/calendar/`.
 *
 * `dayOffset` is 0=Sunday..6=Saturday and `hour`/`minute` are ET wall-clock
 * — re-dating just adds `dayOffset` days plus the wall-clock offset onto
 * this week's Sunday-00:00-ET instant (calendar-state.ts), which is exact
 * as long as the week doesn't straddle a DST change.
 */
export interface CalendarFixtureTemplate {
  seriesId: string;
  title: string;
  country: string;
  impact: 'low' | 'medium' | 'high' | 'holiday';
  dayOffset: number;
  hour: number;
  minute: number;
  forecast: string | null;
  previous: string | null;
}

export const CALENDAR_FIXTURE_TEMPLATE: CalendarFixtureTemplate[] = [
  { seriesId: '61', title: 'BRICS Summit', country: 'All', impact: 'low', dayOffset: 0, hour: 8, minute: 15, forecast: null, previous: null },
  { seriesId: '58', title: 'Unemployment Rate', country: 'GBP', impact: 'medium', dayOffset: 1, hour: 2, minute: 0, forecast: '4.7%', previous: '4.7%' },
  { seriesId: '771', title: 'Unemployment Rate', country: 'CNY', impact: 'low', dayOffset: 1, hour: 1, minute: 30, forecast: '5.1%', previous: '5.1%' },
  { seriesId: '223', title: 'CPI m/m', country: 'CAD', impact: 'high', dayOffset: 2, hour: 8, minute: 30, forecast: '0.1%', previous: '-0.1%' },
  { seriesId: '832', title: 'ECB President Lagarde Speaks', country: 'EUR', impact: 'high', dayOffset: 1, hour: 9, minute: 0, forecast: null, previous: null },
  { seriesId: '832', title: 'ECB President Lagarde Speaks', country: 'EUR', impact: 'high', dayOffset: 5, hour: 7, minute: 30, forecast: null, previous: null },
  { seriesId: '504', title: 'ECOFIN Meetings', country: 'EUR', impact: 'low', dayOffset: 1, hour: 5, minute: 0, forecast: null, previous: null },
  { seriesId: '504', title: 'ECOFIN Meetings', country: 'EUR', impact: 'low', dayOffset: 2, hour: 5, minute: 0, forecast: null, previous: null },
  { seriesId: '9', title: 'Federal Funds Rate', country: 'USD', impact: 'high', dayOffset: 3, hour: 14, minute: 0, forecast: '4.00%', previous: '3.75%' },
  { seriesId: '10', title: 'FOMC Statement', country: 'USD', impact: 'high', dayOffset: 3, hour: 14, minute: 0, forecast: null, previous: null },
  { seriesId: '11', title: 'FOMC Press Conference', country: 'USD', impact: 'medium', dayOffset: 3, hour: 14, minute: 30, forecast: null, previous: null },
  { seriesId: '17', title: 'Retail Sales m/m', country: 'USD', impact: 'medium', dayOffset: 3, hour: 8, minute: 30, forecast: '0.4%', previous: '0.6%' },
  { seriesId: '43', title: 'Trade Balance', country: 'JPY', impact: 'low', dayOffset: 4, hour: 19, minute: 50, forecast: '-480B', previous: '-2.57B' },
  { seriesId: '81', title: 'Overnight Rate', country: 'CAD', impact: 'high', dayOffset: 3, hour: 9, minute: 45, forecast: '2.75%', previous: '2.75%' },
  { seriesId: '112', title: 'BoJ Policy Rate', country: 'JPY', impact: 'high', dayOffset: 4, hour: 23, minute: 0, forecast: '<1.25%', previous: '<1.25%' },
  { seriesId: '140', title: 'Employment Change', country: 'AUD', impact: 'medium', dayOffset: 4, hour: 19, minute: 30, forecast: '25.0K', previous: '8.3K' },
  { seriesId: '205', title: 'SNB Monetary Policy Assessment', country: 'CHF', impact: 'high', dayOffset: 4, hour: 3, minute: 30, forecast: null, previous: null },
  { seriesId: '260', title: 'GDP q/q', country: 'NZD', impact: 'medium', dayOffset: 4, hour: 18, minute: 45, forecast: '0.3-0-6', previous: '3-0-6' },
];
