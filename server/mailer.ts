/**
 * Minimal outbound mail. Sends through SMTP when configured (SMTP_HOST etc.),
 * and otherwise logs the message only outside production so verification flows
 * still work in local development without a mail provider.
 *
 * nodemailer is imported lazily and only when SMTP is configured, so it stays an
 * out of the startup path.
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

export class MailDeliveryError extends Error {
  constructor(message = 'Outbound email delivery failed') {
    super(message);
    this.name = 'MailDeliveryError';
  }
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
        from: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@vinos.app',
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      return { delivered: true, transport: 'smtp' };
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[mailer] SMTP delivery failed.');
        throw new MailDeliveryError();
      }
      console.error('[mailer] SMTP send failed, falling back to console:', err);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('[mailer] SMTP_HOST is not configured; outbound email was not sent.');
    throw new MailDeliveryError('Outbound email is not configured');
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
  const brand = opts.wineryName || 'VinOS';
  const subject = ka ? `${brand} — ელფოსტის დადასტურება` : `${brand} — Verify your email`;
  
  const text = ka
    ? `მოგესალმებით!\n\nთქვენი ${brand}-ის ანგარიშის გასააქტიურებლად დაადასტურეთ ელფოსტა ამ ბმულზე გადასვლით:\n${opts.link}\n\nბმული აქტიურია 24 საათის განმავლობაში. თუ რეგისტრაცია არ განგიხორციელებიათ, უგულებელყავით ეს წერილი.`
    : `Welcome!\n\nConfirm your email to activate your ${brand} account by opening this link:\n${opts.link}\n\nThe link is valid for 24 hours. If you didn't sign up, you can safely ignore this message.`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #fcfbfa; padding: 40px 20px; color: #2c221e; line-height: 1.6; margin: 0;">
      <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border: 1px solid #ebdcd0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(78,14,21,0.03);">
        <div style="background-color: #4e0e15; padding: 32px; text-align: center;">
          <span style="font-family: Georgia, serif; font-size: 28px; font-weight: bold; color: #ffffff; letter-spacing: 0.15em;">${brand}</span>
        </div>
        <div style="padding: 40px 32px;">
          <h2 style="font-family: Georgia, serif; color: #4e0e15; font-size: 20px; margin-top: 0; margin-bottom: 16px; font-weight: 600;">
            ${ka ? 'დაადასტურეთ თქვენი ელფოსტა' : 'Verify Your Email Address'}
          </h2>
          <p style="font-size: 15px; margin-bottom: 24px; color: #4a3e3d;">
            ${ka 
              ? `მადლობა ${brand}-ზე რეგისტრაციისთვის. გთხოვთ, დაადასტუროთ თქვენი ელფოსტა ანგარიშის გასააქტიურებლად და მუშაობის დასაწყებად.` 
              : `Thank you for registering on ${brand}. Please verify your email address to activate your account and start managing your winery.`}
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${opts.link}" style="display: inline-block; background-color: #4e0e15; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; letter-spacing: 0.05em; box-shadow: 0 4px 6px rgba(78,14,21,0.15);">
              ${ka ? 'ელფოსტის დადასტურება' : 'Verify Email'}
            </a>
          </div>
          <p style="font-size: 13px; color: #8c7f7e; margin-bottom: 0;">
            ${ka 
              ? 'ეს ბმული აქტიურია 24 საათის განმავლობაში. თუ ეს რეგისტრაცია თქვენ არ გეკუთვნით, შეგიძლიათ უგულებელყოთ ეს წერილი.' 
              : 'This link is valid for 24 hours. If you did not create this account, you can safely ignore this email.'}
          </p>
          <hr style="border: none; border-top: 1px solid #ebdcd0; margin: 32px 0;" />
          <p style="font-size: 12px; color: #a39695; line-height: 1.5; margin: 0;">
            ${ka 
              ? 'თუ ღილაკი არ მუშაობს, დააკოპირეთ და ჩასვით ეს ბმული ბრაუზერში:' 
              : "If the button above doesn't work, copy and paste this URL into your browser:"}
            <br />
            <a href="${opts.link}" style="color: #4e0e15; text-decoration: underline; word-break: break-all;">${opts.link}</a>
          </p>
        </div>
        <div style="background-color: #f6f3f0; padding: 24px 32px; text-align: center; font-size: 12px; color: #8c7f7e; border-top: 1px solid #ebdcd0;">
          <strong>${brand} Winery &amp; Vineyard Platform</strong><br />
          <span style="color: #a39695;">Operational Control Loop • Offline-capable Traceability</span>
        </div>
      </div>
    </div>
  `;
  return { to: opts.to, subject, text, html };
}

export function buildResetPasswordEmail(opts: {
  to: string; link: string; lang?: string; wineryName?: string;
}): MailMessage {
  const ka = opts.lang === 'ka';
  const brand = opts.wineryName || 'VinOS';
  const subject = ka ? `${brand} — პაროლის აღდგენა` : `${brand} — Reset your passcode`;
  
  const text = ka
    ? `მოგესალმებით!\n\nთქვენი ${brand}-ის ანგარიშის პაროლის აღსადგენად გადადით ამ ბმულზე:\n${opts.link}\n\nბმული აქტიურია 24 საათის განმავლობაში. თუ ეს მოთხოვნა თქვენ არ გეკუთვნით, უგულებელყავით ეს წერილი.`
    : `Hello!\n\nTo reset your ${brand} passcode, please open this link:\n${opts.link}\n\nThe link is valid for 24 hours. If you did not request a passcode reset, you can safely ignore this email.`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #fcfbfa; padding: 40px 20px; color: #2c221e; line-height: 1.6; margin: 0;">
      <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border: 1px solid #ebdcd0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(78,14,21,0.03);">
        <div style="background-color: #4e0e15; padding: 32px; text-align: center;">
          <span style="font-family: Georgia, serif; font-size: 28px; font-weight: bold; color: #ffffff; letter-spacing: 0.15em;">${brand}</span>
        </div>
        <div style="padding: 40px 32px;">
          <h2 style="font-family: Georgia, serif; color: #4e0e15; font-size: 20px; margin-top: 0; margin-bottom: 16px; font-weight: 600;">
            ${ka ? 'პაროლის აღდგენა' : 'Reset Your Passcode'}
          </h2>
          <p style="font-size: 15px; margin-bottom: 24px; color: #4a3e3d;">
            ${ka 
              ? `თქვენ მოითხოვეთ ${brand}-ის ანგარიშის პაროლის აღდგენა. გთხოვთ, დააჭიროთ ქვემოთ მოცემულ ღილაკს ახალი პაროლის დასაყენებლად.` 
              : `You requested a passcode reset for your ${brand} account. Please click the button below to choose a new passcode.`}
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${opts.link}" style="display: inline-block; background-color: #4e0e15; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; letter-spacing: 0.05em; box-shadow: 0 4px 6px rgba(78,14,21,0.15);">
              ${ka ? 'პაროლის შეცვლა' : 'Reset Passcode'}
            </a>
          </div>
          <p style="font-size: 13px; color: #8c7f7e; margin-bottom: 0;">
            ${ka 
              ? 'ეს ბმული აქტიურია 24 საათის განმავლობაში. თუ ეს მოთხოვნა თქვენ არ გაგიკეთებიათ, შეგიძლიათ უგულებელყოთ ეს წერილი.' 
              : 'This link is valid for 24 hours. If you did not request this, you can safely ignore this email.'}
          </p>
          <hr style="border: none; border-top: 1px solid #ebdcd0; margin: 32px 0;" />
          <p style="font-size: 12px; color: #a39695; line-height: 1.5; margin: 0;">
            ${ka 
              ? 'თუ ღილაკი არ მუშაობს, დააკოპირეთ და ჩასვით ეს ბმული ბრაუზერში:' 
              : "If the button above doesn't work, copy and paste this URL into your browser:"}
            <br />
            <a href="${opts.link}" style="color: #4e0e15; text-decoration: underline; word-break: break-all;">${opts.link}</a>
          </p>
        </div>
        <div style="background-color: #f6f3f0; padding: 24px 32px; text-align: center; font-size: 12px; color: #8c7f7e; border-top: 1px solid #ebdcd0;">
          <strong>${brand} Winery &amp; Vineyard Platform</strong><br />
          <span style="color: #a39695;">Operational Control Loop • Offline-capable Traceability</span>
        </div>
      </div>
    </div>
  `;
  return { to: opts.to, subject, text, html };
}

export function buildInvitationEmail(opts: {
  to: string; inviterName: string; orgName: string; link: string; lang?: string;
}): MailMessage {
  const ka = opts.lang === 'ka';
  const subject = ka
    ? `მოწვევა ვენახისა და მარნის მართვის პლატფორმაზე — ${opts.orgName}`
    : `Invitation to join ${opts.orgName} on VinOS`;

  const text = ka
    ? `მოგესალმებით!\n\n${opts.inviterName}-მა მოგიწვიათ შეუერთდეთ მარნის „${opts.orgName}“ სამუშაო სივრცეს VinOS პლატფორმაზე.\n\nმოსაწვევის მისაღებად გადადით ამ ბმულზე:\n${opts.link}\n\nეს ბმული აქტიურია 24 საათის განმავლობაში.`
    : `Hello!\n\n${opts.inviterName} has invited you to join the "${opts.orgName}" winery workspace on VinOS.\n\nTo accept the invitation, please open the link below:\n${opts.link}\n\nThis link is valid for 24 hours.`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #fcfbfa; padding: 40px 20px; color: #2c221e; line-height: 1.6; margin: 0;">
      <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border: 1px solid #ebdcd0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(78,14,21,0.03);">
        <div style="background-color: #4e0e15; padding: 32px; text-align: center;">
          <span style="font-family: Georgia, serif; font-size: 28px; font-weight: bold; color: #ffffff; letter-spacing: 0.15em;">VinOS</span>
        </div>
        <div style="padding: 40px 32px;">
          <h2 style="font-family: Georgia, serif; color: #4e0e15; font-size: 20px; margin-top: 0; margin-bottom: 16px; font-weight: 600;">
            ${ka ? 'მოწვევა სამუშაო სივრცეში' : 'Workspace Invitation'}
          </h2>
          <p style="font-size: 15px; margin-bottom: 24px; color: #4a3e3d;">
            ${ka 
              ? `მოგესალმებით! <strong>${opts.inviterName}</strong> გიწვევთ შეუერთდეთ მარნის <strong>„${opts.orgName}“</strong> ციფრულ სამუშაო სივრცეს <strong>VinOS</strong> პლატფორმაზე.` 
              : `Hello! <strong>${opts.inviterName}</strong> has invited you to join the <strong>"${opts.orgName}"</strong> digital winery workspace on the <strong>VinOS</strong> platform.`}
          </p>
          <p style="font-size: 14px; margin-bottom: 24px; color: #665a59;">
            ${ka
              ? 'შეუერთდით თქვენს გუნდს, რათა აწარმოოთ ვენახის მოვლის, ყურძნის მიღების, ღვინის ტექნოლოგიური პროცესებისა და მარაგების აღრიცხვა რეალურ დროში.'
              : 'Join your team to collaborate on block-to-bottle traceability, live fermentation curves, lab analytics, and cellar operations in real-time.'}
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${opts.link}" style="display: inline-block; background-color: #4e0e15; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; letter-spacing: 0.05em; box-shadow: 0 4px 6px rgba(78,14,21,0.15);">
              ${ka ? 'მოწვევის მიღება' : 'Accept Invitation'}
            </a>
          </div>
          <p style="font-size: 13px; color: #8c7f7e; margin-bottom: 0;">
            ${ka 
              ? 'ეს ბმული აქტიურია 24 საათის განმავლობაში. თუ ეს მოწვევა თქვენ არ გეკუთვნით, შეგიძლიათ უგულებელყოთ ეს წერილი.' 
              : 'This link is valid for 24 hours. If you did not expect this invitation, you can safely ignore this email.'}
          </p>
          <hr style="border: none; border-top: 1px solid #ebdcd0; margin: 32px 0;" />
          <p style="font-size: 12px; color: #a39695; line-height: 1.5; margin: 0;">
            ${ka 
              ? 'თუ ღილაკი არ მუშაობს, დააკოპირეთ და ჩასვით ეს ბმული ბრაუზერში:' 
              : "If the button above doesn't work, copy and paste this URL into your browser:"}
            <br />
            <a href="${opts.link}" style="color: #4e0e15; text-decoration: underline; word-break: break-all;">${opts.link}</a>
          </p>
        </div>
        <div style="background-color: #f6f3f0; padding: 24px 32px; text-align: center; font-size: 12px; color: #8c7f7e; border-top: 1px solid #ebdcd0;">
          <strong>VinOS Winery &amp; Vineyard Platform</strong><br />
          <span style="color: #a39695;">Unified Estate ERP • Offline-capable Traceability</span>
        </div>
      </div>
    </div>
  `;
  return { to: opts.to, subject, text, html };
}
