import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailDeliveryError, sendMail } from '../server/mailer';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('production mail delivery safety', () => {
  it('fails closed without SMTP and never writes the bearer message to logs', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_HOST;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(sendMail({
      to: 'owner@example.com',
      subject: 'Reset',
      text: 'https://example.com/reset?token=live-bearer',
    })).rejects.toBeInstanceOf(MailDeliveryError);

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.not.stringContaining('live-bearer'));
  });

  it('retains the console transport only for development', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SMTP_HOST;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await sendMail({
      to: 'owner@example.com',
      subject: 'Reset',
      text: 'development-only-link',
    });

    expect(result).toEqual({ delivered: false, transport: 'console' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('development-only-link'));
  });
});
