import type { Page } from '@playwright/test';
import { apiUrl, expect, routeConfigTo, test, wsUrl } from './fixtures';

/**
 * architecture/chart-layouts.md §11.2 — the OI panel draws a line at 1m (with its caption),
 * wickless-candle caption at 5m, candles with no caption at 15m, in USD (header unit USDT);
 * and a live WS metric point equals the REST point for the same bucket.
 *
 * Ports (E2E_MOCK_PORT, formerly MOCK_API_PORT) come from ./fixtures.
 */
const API = apiUrl();
const WS = wsUrl();

async function openOnMock(page: Page): Promise<void> {
  await routeConfigTo(page);
  await page.goto('/terminal');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });
}

test('OI panel: line + caption at 1m, candles at 5m/15m, caption only where §11.2 says, unit USDT', async ({ page }) => {
  await openOnMock(page);
  const oi = page.locator('.chart-panel[data-panel-id="btc-oi"]');
  const body = oi.locator('.panel-body');
  const caption = oi.getByTestId('metric-caption');

  await expect(oi.locator('.panel-title')).toHaveText('BTCUSDT · Open interest · USDT', { timeout: 15_000 });

  await page.getByRole('button', { name: '1m', exact: true }).click();
  await expect(body).toHaveAttribute('data-metric-style', 'line');
  await expect(caption).toHaveText('line · source is one reading per 5 min');
  await expect(caption).toHaveAttribute('title', /.+/);

  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect(body).toHaveAttribute('data-metric-style', 'candles');
  await expect(caption).toHaveText('candles: change per 5 min, no wicks');

  await page.getByRole('button', { name: '15m', exact: true }).click();
  await expect(body).toHaveAttribute('data-metric-style', 'candles');
  await expect(caption).toHaveCount(0);
  await expect(oi.locator('.chart-container')).toHaveAttribute('data-visible-from', /\d+/, { timeout: 15_000 });

  // candle panels never get a caption or a metric style
  const btc = page.locator('.chart-panel[data-panel-id="btc"]');
  await expect(btc.getByTestId('metric-caption')).toHaveCount(0);
  await expect(btc.locator('.panel-body')).not.toHaveAttribute('data-metric-style', /.*/);
});

interface WsMetricPoint {
  timeframe: string;
  time: number;
  [k: string]: unknown;
}

test('a WS metric point equals the REST point for the same bucket (§11.2)', async ({ request }) => {
  const sub = (timeframe: string) =>
    JSON.stringify({ type: 'subscribe', topic: 'metrics', instrument: 'binance:BTCUSDT', metric: 'openInterest', timeframe });

  // 1m and 5m frames for the SAME observation arrive back to back. That observation lies in the
  // 1m point's bucket and the next one is ≥ 1 min later, so `to` = the end of that 1m bucket
  // makes REST see exactly what the WS frame was built from, even if more bars have closed since.
  const frames = await new Promise<{ one: WsMetricPoint; five: WsMetricPoint }>((resolve, reject) => {
    const ws = new WebSocket(WS);
    const byTf = new Map<string, WsMetricPoint>();
    const timer = setTimeout(() => reject(new Error('no metric frames')), 15_000);
    ws.onopen = () => {
      ws.send(sub('1m'));
      ws.send(sub('5m'));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { type: string; point?: WsMetricPoint };
      if (msg.type !== 'metric' || !msg.point) return;
      byTf.set(msg.point.timeframe, msg.point);
      // Subscribed 1m first, so each observation's 1m frame precedes its 5m frame: pair on the 5m one.
      const one = byTf.get('1m');
      const five = msg.point.timeframe === '5m' ? msg.point : undefined;
      if (one && five && five.time <= one.time && one.time < five.time + 5 * 60_000) {
        clearTimeout(timer);
        ws.close();
        resolve({ one, five });
      }
    };
  });

  for (const point of [frames.one, frames.five]) {
    const res = await request.get(`${API}/metrics`, {
      params: {
        instrument: 'binance:BTCUSDT',
        metric: 'openInterest',
        timeframe: point.timeframe,
        from: point.time,
        to: frames.one.time + 60_000 - 1,
      },
    });
    const body = (await res.json()) as WsMetricPoint[];
    expect(body.at(-1)).toEqual(point);
  }
});
