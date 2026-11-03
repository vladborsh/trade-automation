import { clientIp } from '../../../src/web/auth/client-ip';

/** IB-078 P8 as amended by H6 (architecture/https-without-domain-2026-11-03.md). */
describe('clientIp', () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers, socketAddress: '10.0.0.5' });

  it('CLIENT_IP_HEADER unset: the socket address, and every forwarding header is IGNORED', () => {
    const r = req({ 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '7.7.7.7', 'cf-connecting-ip': '8.8.8.8' });
    expect(clientIp(r, undefined)).toEqual({ ip: '10.0.0.5', fellBack: false });
  });

  it('set: exactly that header, by its lower-cased name, and no other', () => {
    const r = req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '7.7.7.7' });
    expect(clientIp(r, 'X-Real-IP')).toEqual({ ip: '203.0.113.7', fellBack: false });
    expect(clientIp(r, 'x-forwarded-for')).toEqual({ ip: '7.7.7.7', fellBack: false });
  });

  it('a list: the first address, trimmed', () => {
    expect(clientIp(req({ 'x-real-ip': ' 203.0.113.7 , 10.0.0.1' }), 'x-real-ip').ip).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-real-ip': ['198.51.100.1', '1.1.1.1'] }), 'x-real-ip').ip).toBe('198.51.100.1');
  });

  it('set but missing or empty: the socket address, flagged so the caller warns', () => {
    expect(clientIp(req({}), 'x-real-ip')).toEqual({ ip: '10.0.0.5', fellBack: true });
    expect(clientIp(req({ 'x-real-ip': '  ' }), 'x-real-ip')).toEqual({ ip: '10.0.0.5', fellBack: true });
  });
});
