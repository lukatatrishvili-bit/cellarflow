/**
 * Minimal outbound mail. Sends through SMTP when configured (SMTP_HOST etc.),
 * and otherwise logs the message to the server console so verification flows
 * still work in development and self-hosted setups without a mail provider.
 *
 * nodemailer is imported lazily and only when SMTP is configured, so it stays an
 * optional dependency — the app builds and runs without it.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  delivered: boolean;
  transport: 'smtp' | 'console';
}

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

export async function sendMail(msg: MailMessage): Promise<MailResult> {
  if (smtpConfigured()) {
    try {
      // Non-literal specifier keeps this an optional, lazily-resolved dependency.
      const moduleName = 'nodemailer';
      const nodemailer: any = await import(moduleName);
      const lib = nodemailer.default || nodemailer;
      const transport = lib.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transport.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@maranios.app',
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      return { delivered: true, transport: 'smtp' };
    } catch (err) {
      console.error('[mailer] SMTP send failed, falling back to console:', err);
    }
  }
  // Dev / no-provider fallback: make the message (and any link) visible in logs.
  console.log(
    `\n──────── [mailer:console] ────────\nTo:      ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n──────────────────────────────────\n`,
  );
  return { delivered: false, transport: 'console' };
}

export function buildVerificationEmail(opts: {
  to: string; link: string; lang?: string; wineryName?: string;
}): MailMessage {
  const ka = opts.lang === 'ka';
  const brand = opts.wineryName || 'MaraniOS';
  const subject = ka ? `${brand} — ელფოსტის დადასტურება` : `${brand} — verify your email`;
  const text = ka
    ? `მოგესალმებით!\n\nთქვენი ${brand}-ის ანგარიშის გასააქტიურებლად დაადასტურეთ ელფოსტა ამ ბმულზე გადასვლით:\n${opts.link}\n\nბმული აქტიურია 24 საათის განმავლობაში. თუ რეგისტრაცია არ განგიხორციელებიათ, უგულებელყავით ეს წერილი.`
    : `Welcome!\n\nConfirm your email to activate your ${brand} account by opening this link:\n${opts.link}\n\nThe link is valid for 24 hours. If you didn't sign up, you can safely ignore this message.`;
  const html = ka
    ? `<p>დაადასტურეთ თქვენი ელფოსტა ${brand}-ის ანგარიშის გასააქტიურებლად:</p>`
      + `<p><a href="${opts.link}">${opts.link}</a></p>`
      + `<p style="color:#888;font-size:12px">ბმული აქტიურია 24 საათის განმავლობაში.</p>`
    : `<p>Confirm your email to activate your ${brand} account:</p>`
      + `<p><a href="${opts.link}">${opts.link}</a></p>`
      + `<p style="color:#888;font-size:12px">This link is valid for 24 hours.</p>`;
  return { to: opts.to, subject, text, html };
}
