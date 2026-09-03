import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sealIntegrationSecret, openIntegrationSecret } from '../server/integrationSecrets';
import { assertSafeOutboundUrl } from '../server/integrationTransport';

// Sealing derives its key from SESSION_SECRET; set a deterministic one.
const priorSecret = process.env.SESSION_SECRET;
beforeAll(() => { process.env.SESSION_SECRET = 'test-session-secret-for-sealing'; });
afterAll(() => {
  if (priorSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSecret;
});

describe('integration secret sealing', () => {
  it('round-trips a secret through seal/open', () => {
    const sealed = sealIntegrationSecret('1c-Пароль-42!');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('1c-Пароль-42!'); // ciphertext, not plaintext
    expect(openIntegrationSecret(sealed)).toBe('1c-Пароль-42!');
  });

  it('produces a distinct blob each time (random IV) but both open', () => {
    const a = sealIntegrationSecret('same');
    const b = sealIntegrationSecret('same');
    expect(a).not.toBe(b);
    expect(openIntegrationSecret(a)).toBe('same');
    expect(openIntegrationSecret(b)).toBe('same');
  });

  it('returns null for missing, malformed, or tampered blobs', () => {
    expect(openIntegrationSecret(undefined)).toBeNull();
    expect(openIntegrationSecret('')).toBeNull();
    expect(openIntegrationSecret('not-sealed')).toBeNull();
    const sealed = sealIntegrationSecret('secret');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64'); // swap ciphertext
    expect(openIntegrationSecret(parts.join(':'))).toBeNull(); // GCM tag rejects
  });
});

describe('SSRF guard (assertSafeOutboundUrl)', () => {
  it('accepts a public HTTPS host (IP literal, no DNS dependency)', async () => {
    // 8.8.8.8 is an unambiguously public address, so this exercises the accept
    // path deterministically without a network lookup.
    await expect(assertSafeOutboundUrl('https://8.8.8.8/odata/standard.odata')).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-HTTPS', async () => {
    await expect(assertSafeOutboundUrl('http://1c.example.com')).rejects.toThrow(/HTTPS/i);
  });

  it('rejects embedded credentials and non-443 ports', async () => {
    await expect(assertSafeOutboundUrl('https://user:pass@1c.example.com')).rejects.toThrow(/credential/i);
    await expect(assertSafeOutboundUrl('https://1c.example.com:8443/odata')).rejects.toThrow(/port/i);
  });

  it('rejects localhost and private / metadata IP literals', async () => {
    await expect(assertSafeOutboundUrl('https://localhost/odata')).rejects.toThrow();
    await expect(assertSafeOutboundUrl('https://127.0.0.1/odata')).rejects.toThrow(/private|reserved/i);
    await expect(assertSafeOutboundUrl('https://10.0.0.5/odata')).rejects.toThrow(/private|reserved/i);
    await expect(assertSafeOutboundUrl('https://192.168.1.1/odata')).rejects.toThrow(/private|reserved/i);
    await expect(assertSafeOutboundUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/private|reserved/i);
    await expect(assertSafeOutboundUrl('https://[::1]/odata')).rejects.toThrow(/private|reserved/i);
  });

  it('rejects an unresolvable host', async () => {
    await expect(
      assertSafeOutboundUrl('https://1c.example.com/odata', async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }),
    ).rejects.toThrow(/resolved/i);
  });

  it('rejects a hostname that resolves to a private address', async () => {
    await expect(
      assertSafeOutboundUrl('https://1c.example.com/odata', async () => [
        { address: '10.0.0.5', family: 4 },
      ]),
    ).rejects.toThrow(/private|reserved/i);
  });
});
