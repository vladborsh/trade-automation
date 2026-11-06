import type { WebInsightsResponse, WebMarketPeriod } from '@trade-automation/contracts';
import type { InsightsService } from '../../src/insights/insights.service';
import type { User } from '../../src/users/user.model';
import { WebMarketController } from '../../src/web/market/market.controller';

/** IB-113 (TL review) — the joint: the signed-in user's ROLE reaches the insights read (R11 is owner-first). */
const user = (role: 'admin' | 'member'): User => ({
  id: 1, tgUserId: 111, chatId: null, role, lang: 'ru', deposit: null, riskPct: 1, dailyLossLimitPct: null, dexAlerts: false,
  calendarAlerts: true, oiAlerts: false, liqAlerts: false, fundingAlerts: false, levelAlerts: false, invitedBy: null, disabled: false, createdAt: new Date(0),
});

describe('GET /market/insights passes the viewer\'s role', () => {
  it('admin → { admin: true }; member → { admin: false }', async () => {
    const seen: Array<{ period: WebMarketPeriod; admin: boolean }> = [];
    const insights = { insights: async (period: WebMarketPeriod, viewer: { admin: boolean }) => { seen.push({ period, admin: viewer.admin }); return {} as WebInsightsResponse; } };
    const c = new WebMarketController(undefined, undefined, undefined, insights as unknown as InsightsService, undefined);
    await c.insights(user('admin'), '24h');
    await c.insights(user('member'), '4h');
    expect(seen).toEqual([{ period: '24h', admin: true }, { period: '4h', admin: false }]);
  });
});
