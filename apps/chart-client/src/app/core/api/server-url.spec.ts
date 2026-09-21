import { serverUrl } from './server-url';

describe('serverUrl', () => {
  it('resolves a server path against the API origin, not the page', () => {
    expect(serverUrl('http://localhost:3010/api', '/api/backtest/sessions/s/orders/o/screenshots/entry', 'http://localhost:4210')).toBe(
      'http://localhost:3010/api/backtest/sessions/s/orders/o/screenshots/entry',
    );
  });

  it('works with a same-origin (relative) API base in production', () => {
    expect(serverUrl('/api', '/api/x', 'https://app.example')).toBe('https://app.example/api/x');
  });
});
