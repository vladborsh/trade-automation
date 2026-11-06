import { shortDevice, toLoginEventRow } from './login-event-rows';
import { dateTimeSec } from '../../shared/time-format';

describe('login journal rows (IB-079)', () => {
  it('maps a row: the viewer\'s time to the second (IB-152), translated outcome key, failures flagged, nulls shown as a dash', () => {
    const row = toLoginEventRow({ id: 7, at: Date.UTC(2026, 10, 3, 13, 5, 9), userId: null, loginAttempted: null, outcome: 'throttled', ip: null, userAgent: null });
    expect(row).toEqual({ id: 7, time: dateTimeSec(Date.parse('2026-11-03T13:05:09Z') / 1000), login: '—', outcome: 'logins.outcome.throttled', failed: true, ip: '—', device: '—' });
    expect(toLoginEventRow({ id: 8, at: 0, userId: 1, loginAttempted: 'bob', outcome: 'success', ip: '1.2.3.4', userAgent: 'curl/8' }).failed).toBe(false);
  });

  it('the device is browser · platform, and the order of checks does not misname Chrome as Safari', () => {
    const chromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    expect(shortDevice(chromeMac)).toBe('Chrome · macOS');
    const safariIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(shortDevice(safariIphone)).toBe('Safari · iPhone');
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
    expect(shortDevice(edge)).toBe('Edge · Windows');
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    expect(shortDevice(android)).toBe('Chrome · Android');
    expect(shortDevice('curl-ib078-live')).toBe('curl-ib078-live');
  });
});
