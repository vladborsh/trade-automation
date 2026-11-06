import { WatchdogService } from '../../src/ops/watchdog.service';
import { StreamRegistry } from '../../src/ops/stream-registry';
import { validateEnv } from '../../src/config/env.schema';
import type { AppConfigService } from '../../src/config/config.service';
import type { TelegramSender } from '../../src/delivery/telegram-sender';

/** IB-BUG-051 follow-up: the alert names the threshold its stream was judged by, not the global one. */
describe('WatchdogService — per-venue threshold', () => {
  it('a bybit silence is judged and rendered against bybit\'s own threshold', async () => {
    const env = validateEnv({ WATCHDOG_SILENCE_MIN_BY_VENUE: 'bybit=30', OPS_TELEGRAM_ALERTS: 'true' });
    const config = { env: { get: (k: keyof typeof env) => env[k] } } as unknown as AppConfigService;
    const sent: string[] = [];
    const telegram = { send: async (t: string) => (sent.push(t), true) } as unknown as TelegramSender;
    const registry = new StreamRegistry();
    const T0 = Date.UTC(2026, 10, 7, 0, 0, 0);
    registry.register('bybit:allLiquidation', 'bybit');
    registry.recordMessage('bybit:allLiquidation', T0);
    const service = new WatchdogService(config, registry, telegram);

    await service.tick(T0 + 29 * 60_000);
    expect(sent).toEqual([]); // the global 3 min would have fired here

    await service.tick(T0 + 31 * 60_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('порога в 30 мин');
  });
});
