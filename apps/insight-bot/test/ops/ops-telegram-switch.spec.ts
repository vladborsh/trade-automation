import { Logger } from '@nestjs/common';
import type { EconomicEvent } from '@trade-automation/contracts';
import { EnvSchema } from '../../src/config/env.schema';
import { CalendarNotifierService } from '../../src/delivery/calendar-notifier.service';
import type { CalendarNotifyStore } from '../../src/delivery/pg/calendar-notify.repo';
import type { StreamHealth } from '../../src/ops/stream-registry';
import { WatchdogService } from '../../src/ops/watchdog.service';

/**
 * IB-094 (owner ruling 2026-11-03) — the operator's Telegram pushes are OFF unless
 * OPS_TELEGRAM_ALERTS is explicitly true. The watchdog then logs what it would have sent;
 * detection and storage are unchanged. (WD-011 deleted the daily gap report and its half of this
 * spec with it.) The calendar notifier shares the sender and
 * is NOT behind the switch.
 */

const T = Date.UTC(2026, 10, 3, 12, 0, 0);
const MIN = 60_000;

const configWith = (ops: unknown) =>
  ({ env: { get: (k: string) => (k === 'OPS_TELEGRAM_ALERTS' ? ops : '3') } }) as never;

const spySender = () => {
  const sent: string[] = [];
  const sentTo: Array<number | string> = [];
  return {
    sent, sentTo,
    sender: {
      send: async (text: string) => (sent.push(text), true),
      sendTo: async (chatId: number | string) => (sentTo.push(chatId), true),
    } as never,
  };
};

const logged = () => {
  const lines: string[] = [];
  jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void lines.push(String(m)));
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return lines;
};

afterEach(() => jest.restoreAllMocks());

describe('OPS_TELEGRAM_ALERTS in the env schema', () => {
  it.each([
    [undefined, false], ['false', false], ['0', false], ['FALSE', false], ['true', true], ['1', true],
  ])('%p parses to %p (explicit mapping — never Boolean("false") === true)', (raw, expected) => {
    const env = EnvSchema.parse(raw === undefined ? {} : { OPS_TELEGRAM_ALERTS: raw });
    expect(env.OPS_TELEGRAM_ALERTS).toBe(expected);
  });
});

describe('WatchdogService', () => {
  const silent: StreamHealth = {
    id: 'bybit:allLiquidation', venue: 'bybit', lastMessageAgeSec: 10 * 60,
    reconnects24h: 0, gapsOpen: 0, mode: 'ws', degradedReason: null, expectedIntervalSec: null,
  };
  const registry = { snapshot: () => [silent] } as never;

  it('default (false): detects the silence, never calls the sender, and logs what it would have sent', async () => {
    const lines = logged();
    const { sent, sender } = spySender();
    await new WatchdogService(configWith(false), registry, sender).tick(T);
    expect(sent).toEqual([]);
    expect(lines.some((l) => l.startsWith('OPS_TELEGRAM_ALERTS=false — would have sent to Telegram:') && l.includes('bybit:allLiquidation'))).toBe(true);
  });

  it('true: the old behaviour — the alert is sent', async () => {
    logged();
    const { sent, sender } = spySender();
    await new WatchdogService(configWith(true), registry, sender).tick(T);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('bybit:allLiquidation');
  });
});

describe('the calendar notifier is NOT behind the switch', () => {
  it('with OPS_TELEGRAM_ALERTS=false it still sends a member\'s reminder through the shared sender', async () => {
    const at = Date.UTC(2026, 9, 29, 12, 30);
    const cpi: EconomicEvent = {
      id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
      country: 'USD', impact: 'high', scheduledAt: at, scheduledDay: '2026-10-29', forecast: '0.3%',
      previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'scheduled',
      firstSeenAt: at - 12 * 60 * MIN, lastSeenAt: at - 12 * 60 * MIN, revision: 1,
    };
    const journal = new Set<string>(['3|digest:2026-10-29']);
    const store: CalendarNotifyStore = {
      events: async () => [cpi],
      collected: async () => true,
      recipients: async () => [{ userId: 3, chatId: 333, lang: 'en' }],
      sentKeys: async () => new Map([[3, new Set(['digest:2026-10-29'])]]),
      claim: async (userId, key) => (journal.has(`${userId}|${key}`) ? false : (journal.add(`${userId}|${key}`), true)),
    };
    const { sentTo, sender } = spySender();
    const config = {
      env: { get: (k: string) => ({ CALENDAR_ENABLED: true, CALENDAR_DIGEST_TIME: '07:00', CALENDAR_REMIND_LEAD_MIN: 15, OPS_TELEGRAM_ALERTS: false })[k] },
    };
    await new CalendarNotifierService(config as never, null, sender, store).tick(at - 15 * MIN);
    expect(sentTo).toEqual([333]);
  });
});
