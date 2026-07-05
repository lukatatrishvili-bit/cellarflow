import { describe, expect, it } from 'vitest';
import { clientIp } from '../server/config';

describe('clientIp', () => {
  it('uses Express-resolved req.ip (respecting trust proxy), not raw X-Forwarded-For', () => {
    const req = {
      ip: '203.0.113.9', // what Express computed as the real client
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, // attacker-supplied
      socket: { remoteAddress: '10.0.0.1' },
    };
    expect(clientIp(req)).toBe('203.0.113.9');
  });

  it('falls back to the socket address when req.ip is unavailable', () => {
    const req = { headers: {}, socket: { remoteAddress: '10.0.0.2' } };
    expect(clientIp(req)).toBe('10.0.0.2');
  });

  it('never trusts a spoofed X-Forwarded-For header on its own', () => {
    const req = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.3' } };
    expect(clientIp(req)).toBe('10.0.0.3');
  });
});
