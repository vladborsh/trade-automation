import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AppConfigService } from '../config/app-config.service';
import { ApiError } from './api-error';
import { BacktestClient } from './backtest.client';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(response: Response) {
  // a fresh Response per call: a body can be read only once
  const fetchMock = vi.fn().mockImplementation(async () => response.clone());
  vi.stubGlobal('fetch', fetchMock);
  const onUnauthorized = vi.fn();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AppConfigService, useValue: { get: () => ({ apiBaseUrl: 'http://localhost:4330/api', wsUrl: '' }) } },
      { provide: UNAUTHORIZED_HANDLER, useValue: onUnauthorized },
    ],
  });
  return { client: TestBed.inject(BacktestClient), fetchMock, onUnauthorized };
}

const API = 'http://localhost:4330/api';

describe('BacktestClient (backtest-app-system-design.md §7.2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GETs instruments and sessions with the session cookie', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, []));
    await client.getInstruments();
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/instruments`, expect.objectContaining({ method: 'GET', credentials: 'include' }));
    await client.listSessions();
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions`, expect.objectContaining({ method: 'GET' }));
  });

  it('GETs replay history and the 1m ahead page with their query parameters (T-020)', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, { bars: [], forming: null }));
    await client.getReplayHistory('s 1', 'btc', '5m', 1_000, 500);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API}/backtest/sessions/s%201/candles?panelId=btc&timeframe=5m&before=1000&limit=500`,
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    await client.getReplayAhead('s 1', 'btc', 2_000, 5_000);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API}/backtest/sessions/s%201/candles/ahead?panelId=btc&fromMs=2000&limit=5000`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('GETs one order and fetches a screenshot from the API origin with the cookie (T-030)', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, {}));
    await client.getOrder('s1', 'o1');
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders/o1`, expect.objectContaining({ method: 'GET' }));
    const blob = await client.fetchScreenshot('/api/backtest/sessions/s1/orders/o1/screenshots/entry');
    expect(fetchMock).toHaveBeenLastCalledWith('http://localhost:4330/api/backtest/sessions/s1/orders/o1/screenshots/entry', { credentials: 'include' });
    expect(blob).not.toBeNull();
  });

  it('GETs the journal and the stats (T-024)', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, []));
    await client.listOrders('s1');
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders`, expect.objectContaining({ method: 'GET' }));
    await client.listOrders('s1', 'closed');
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders?status=closed`, expect.anything());
    await client.getStats('s1');
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/stats`, expect.anything());
  });

  it('sends the five mutations to their §7.2 paths with the body as given (T-021)', async () => {
    const { client, fetchMock } = setup(jsonResponse(200, {}));
    const body = { opId: '00000000-0000-4000-8000-000000000001', cursorMs: 60_000 };
    await client.advance('s1', { opId: body.opId, toCursorMs: 120_000 });
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/advance`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ opId: body.opId, toCursorMs: 120_000 }),
    }));
    await client.placeOrder('s1', { ...body, panelId: 'btc', side: 'long', type: 'market', sl: 90, riskPct: 1 });
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders`, expect.objectContaining({ method: 'POST' }));
    await client.cancelOrder('s1', 'o1', body);
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders/o1/cancel`, expect.objectContaining({ method: 'POST' }));
    await client.closeOrder('s1', 'o1', body);
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders/o1/close`, expect.objectContaining({ method: 'POST' }));
    await client.modifyOrder('s1', 'o1', { ...body, sl: 95 });
    expect(fetchMock).toHaveBeenLastCalledWith(`${API}/backtest/sessions/s1/orders/o1`, expect.objectContaining({ method: 'PATCH' }));
  });

  it('POSTs a create body as JSON', async () => {
    const { client, fetchMock } = setup(jsonResponse(201, { id: 's1' }));
    await client.createSession({ name: 'x' } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/backtest/sessions`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'x' }), headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('PATCHes and DELETEs by encoded id; a 204 resolves to undefined', async () => {
    const patch = setup(jsonResponse(200, { id: 'a/b' }));
    await patch.client.patchSession('a/b', { timeframe: '1h' });
    expect(patch.fetchMock).toHaveBeenCalledWith(`${API}/backtest/sessions/a%2Fb`, expect.objectContaining({ method: 'PATCH' }));
    const del = setup(jsonResponse(204, null));
    await expect(del.client.deleteSession('s1')).resolves.toBeUndefined();
    expect(del.fetchMock).toHaveBeenCalledWith(`${API}/backtest/sessions/s1`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('a 422 rejects with the contract code; a 401 goes to /login', async () => {
    const bad = setup(jsonResponse(422, { error: { code: 'MIXED_SESSION_CURRENCY', message: 'x' } }));
    await expect(bad.client.createSession({} as never)).rejects.toMatchObject({ status: 422, code: 'MIXED_SESSION_CURRENCY' });
    const out = setup(jsonResponse(401, { statusCode: 401 }));
    await expect(out.client.listSessions()).rejects.toBeInstanceOf(ApiError);
    expect(out.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
