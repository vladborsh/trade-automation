import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator';
import { AuthController } from '../../src/api/rest/auth.controller';
import { BacktestInstrumentsController } from '../../src/api/rest/backtest/instruments.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { BacktestCandlesController } from '../../src/api/rest/backtest/candles.controller';
import { CalendarController } from '../../src/api/rest/calendar.controller';
import { CandlesController } from '../../src/api/rest/candles.controller';
import { IndicatorsController } from '../../src/api/rest/indicators.controller';
import { InstrumentsController } from '../../src/api/rest/instruments.controller';
import { LayoutsController } from '../../src/api/rest/layouts.controller';
import { MetricsController as OpenInterestController } from '../../src/api/rest/metrics.controller';
import { SignalsController } from '../../src/api/rest/signals.controller';
import { StrategiesController } from '../../src/api/rest/strategies.controller';
import { HealthController } from '../../src/observability/health.controller';
import { MetricsController as PrometheusController } from '../../src/observability/metrics.controller';

const isPublic = (target: object) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true;

/** backtest-app-system-design.md §7.1 — the @Public() allow-list is exactly this, nothing more. */
describe('@Public() allow-list', () => {
  it('health and the Prometheus endpoint are public', () => {
    expect(isPublic(HealthController)).toBe(true);
    expect(isPublic(PrometheusController)).toBe(true);
  });

  it('every existing user-facing REST controller is authenticated', () => {
    for (const c of [
      InstrumentsController,
      CandlesController,
      SignalsController,
      StrategiesController,
      IndicatorsController,
      LayoutsController,
      OpenInterestController,
      CalendarController,
      BacktestInstrumentsController,
      SessionsController,
      BacktestCandlesController,
    ]) {
      expect([c.name, isPublic(c)]).toEqual([c.name, false]);
      for (const key of Object.getOwnPropertyNames(c.prototype)) {
        expect([c.name, key, isPublic(c.prototype[key])]).toEqual([c.name, key, false]);
      }
    }
  });

  it('auth: login and the invite endpoints are public; me and logout are not', () => {
    const p = AuthController.prototype;
    expect(isPublic(AuthController)).toBe(false);
    expect([p.login, p.invite, p.acceptInvite].map(isPublic)).toEqual([true, true, true]);
    expect([p.me, p.logout].map(isPublic)).toEqual([false, false]);
  });
});
