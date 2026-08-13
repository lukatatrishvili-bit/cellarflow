import crypto from 'crypto';
import { hashToken, isVerificationTokenValid, isValidEmail } from './emailVerification';
import { buildRegistrationDecisionEmail, sendMail } from './mailer';

/**
 * Manual gate in front of every self-service account. A new registration lands
 * as `pending`: the applicant proves their address through the normal
 * verification link, and an operator separately approves the person before a
 * session can ever be issued. Accounts written before this gate existed have no
 * `approvalStatus` and are treated as approved, so the change cannot lock out
 * the existing tenant base.
 *
 * The emailed review link carries a raw token that is never stored — only its
 * SHA-256 digest lives on the user record — and the link itself only *renders*
 * the request. The decision is a separate POST, so a mailbox link scanner that
 * prefetches URLs cannot approve anybody.
 */

export type RegistrationApprovalStatus = 'pending' | 'approved' | 'rejected';
export type RegistrationApprovalDecision = 'approve' | 'reject';

/** How long an emailed review link stays usable. */
export const APPROVAL_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface ApprovalToken {
  token: string;     // raw token for the review link (never persisted)
  tokenHash: string; // SHA-256 of token (persisted on the user)
  expiresAt: number; // epoch ms
}

export interface RegistrationApprovalDetails {
  username: string;
  fullName: string;
  email: string;
  phone?: string;
  companyName?: string;
  wineryName?: string;
  country?: string;
  region?: string;
  language?: string;
  role?: string;
  provider?: 'password' | 'google';
  requestedAt?: string;
  emailVerified?: boolean;
}

const OPT_OUT_VALUES = new Set(['0', 'false', 'no', 'off']);

/**
 * Approval is the default posture — a deployment has to opt out explicitly.
 * Anything else would silently open registration after an env typo.
 */
export function registrationApprovalRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return !OPT_OUT_VALUES.has(String(env.REQUIRE_REGISTRATION_APPROVAL ?? '').trim().toLowerCase());
}

function extractAddress(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const angled = raw.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : raw).trim().toLowerCase();
  return isValidEmail(address) ? address : '';
}

/** Mailbox that receives new-account requests, in order of explicitness. */
export function approvalNotificationRecipient(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    env.REGISTRATION_APPROVAL_EMAIL,
    env.ADMIN_EMAIL,
    env.MAIL_FROM,
    env.SMTP_USER,
  ];
  for (const candidate of candidates) {
    const address = extractAddress(candidate);
    if (address) return address;
  }
  return '';
}

export function approvalStatusForUser(user: any): RegistrationApprovalStatus {
  const raw = String(user?.approvalStatus ?? '').trim().toLowerCase();
  if (raw === 'pending') return 'pending';
  if (raw === 'rejected') return 'rejected';
  return 'approved';
}

export function userAwaitsApproval(user: any): boolean {
  return approvalStatusForUser(user) === 'pending';
}

export function generateApprovalToken(now: number = Date.now()): ApprovalToken {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token), expiresAt: now + APPROVAL_TTL_MS };
}

/** Constant-time check that a raw review token matches the stored digest. */
export function approvalTokenMatches(user: any, token: string | undefined | null, now: number = Date.now()): boolean {
  return isVerificationTokenValid(
    { verifyTokenHash: user?.approvalTokenHash, verifyTokenExpires: user?.approvalTokenExpires },
    token,
    now,
  );
}

export function markAwaitingApproval(user: any, token: ApprovalToken, now: Date = new Date()): void {
  user.approvalStatus = 'pending';
  user.approvalRequestedAt = now.toISOString();
  user.approvalTokenHash = token.tokenHash;
  user.approvalTokenExpires = token.expiresAt;
  delete user.approvalDecidedAt;
  delete user.approvalDecidedBy;
}

export function applyApprovalDecision(
  user: any,
  decision: RegistrationApprovalDecision,
  decidedBy: string,
  now: Date = new Date(),
): RegistrationApprovalStatus {
  user.approvalStatus = decision === 'approve' ? 'approved' : 'rejected';
  user.approvalDecidedAt = now.toISOString();
  user.approvalDecidedBy = decidedBy;
  // The review link is single-use: a decided account must be re-opened from the
  // master console, not by replaying an old email.
  delete user.approvalTokenHash;
  delete user.approvalTokenExpires;
  return user.approvalStatus;
}

/**
 * Best-effort note to the applicant once a decision has been recorded. Delivery
 * failure never blocks the decision — the account state is already written.
 */
export async function sendApprovalDecisionNotice(user: any, approved: boolean, appUrl: string): Promise<boolean> {
  if (!user?.email) return false;
  try {
    await sendMail(buildRegistrationDecisionEmail({
      to: user.email,
      approved,
      fullName: user.fullName,
      link: appUrl,
      lang: user.language,
    }));
    return true;
  } catch {
    console.error('[auth] Registration decision notice could not be delivered.');
    return false;
  }
}

/** Flatten a user + their organization profile into the fields a reviewer needs. */
export function describeApprovalRequest(user: any, companyProfile?: any): RegistrationApprovalDetails {
  return {
    username: String(user?.username || ''),
    fullName: String(user?.fullName || ''),
    email: String(user?.email || ''),
    phone: String(user?.phone || companyProfile?.phone || ''),
    companyName: String(companyProfile?.companyName || ''),
    wineryName: String(companyProfile?.wineryName || ''),
    country: String(companyProfile?.country || ''),
    region: String(companyProfile?.region || ''),
    language: String(user?.language || 'en'),
    role: String(user?.role || ''),
    provider: user?.passwordHash ? 'password' : 'google',
    requestedAt: String(user?.approvalRequestedAt || user?.createdAt || ''),
    emailVerified: user?.emailVerified === true,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PAGE_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f6f2; color: #1b1715; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
  .card { background: #fff; border: 1px solid #e8dfd5; padding: 36px; border-radius: 20px; max-width: 620px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.04); box-sizing: border-box; }
  h1 { font-family: Georgia, serif; color: #4e0e15; margin: 0 0 6px; font-size: 22px; }
  p.lead { color: #6b5f5c; font-size: 14px; margin: 0 0 24px; }
  dl { display: grid; grid-template-columns: 170px 1fr; gap: 10px 16px; margin: 0 0 28px; font-size: 14px; }
  dt { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: #8c7f76; align-self: center; }
  dd { margin: 0; word-break: break-word; }
  .actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; border-top: 1px solid #e8dfd5; padding-top: 24px; }
  button { font: inherit; font-weight: 700; font-size: 13px; border-radius: 10px; padding: 12px 24px; border: none; cursor: pointer; }
  .approve { background: #4e0e15; color: #fff; }
  .approve:disabled { background: #d6d3d1; color: #78716c; cursor: not-allowed; }
  .reject { background: #fff; color: #9a3412; border: 1px solid #fed7aa; }
  .blocked { border: 1px solid #fed7aa; background: #fff7ed; color: #9a3412; border-radius: 12px; padding: 12px 14px; margin: -10px 0 22px; font-size: 13px; line-height: 1.5; }
  .note { font-size: 12px; color: #8c7f76; margin: 18px 0 0; line-height: 1.5; }
  a { color: #4e0e15; font-weight: 700; }
`;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">
${body}
  </div>
</body>
</html>`;
}

function detailRow(label: string, value: string | undefined): string {
  if (!value) return '';
  return `      <dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>\n`;
}

/**
 * The review page itself changes nothing — it renders the request and offers the
 * two decisions as same-origin POSTs.
 */
export function renderApprovalReviewPage(opts: {
  details: RegistrationApprovalDetails;
  blockingIssues?: string[];
  token: string;
  actionPath: string;
}): string {
  const { details } = opts;
  const blockingIssues = opts.blockingIssues || [];
  const rows = [
    detailRow('Full name', details.fullName),
    detailRow('Email', details.email),
    detailRow('Account', `@${details.username}`),
    detailRow('Company / estate', details.companyName),
    detailRow('Winery', details.wineryName),
    detailRow('Region', [details.region, details.country].filter(Boolean).join(', ')),
    detailRow('Phone', details.phone),
    detailRow('Requested role', details.role),
    detailRow('Sign-in method', details.provider === 'google' ? 'Google' : 'Email + passcode'),
    detailRow('Language', details.language === 'ka' ? 'Georgian' : 'English'),
    detailRow('Email confirmed', details.emailVerified ? 'Yes' : 'Not yet'),
    detailRow('Requested at', details.requestedAt ? new Date(details.requestedAt).toUTCString() : ''),
  ].join('');

  return pageShell('Review account request', `    <h1>Account request</h1>
    <p class="lead">This person asked for access to VinOS. Nobody can sign in until you approve it.</p>
    <dl>
${rows}    </dl>
    ${blockingIssues.length > 0
      ? `<div class="blocked"><strong>Approval blocked.</strong> The applicant still needs to provide: ${escapeHtml(blockingIssues.join(', '))}.</div>`
      : ''}
    <form method="POST" action="${escapeHtml(opts.actionPath)}" class="actions">
      <input type="hidden" name="token" value="${escapeHtml(opts.token)}" />
      <button type="submit" name="decision" value="approve" class="approve"${blockingIssues.length > 0 ? ' disabled aria-disabled="true"' : ''}>Approve access</button>
      <button type="submit" name="decision" value="reject" class="reject">Reject</button>
    </form>
    <p class="note">Approving lets this account sign in once its email address is confirmed. Rejecting keeps the account permanently locked; you can still change either decision later from the master admin console.</p>`);
}

export function renderApprovalResultPage(opts: {
  title: string;
  message: string;
  appUrl?: string;
}): string {
  return pageShell(opts.title, `    <h1>${escapeHtml(opts.title)}</h1>
    <p class="lead">${escapeHtml(opts.message)}</p>
    ${opts.appUrl ? `<p><a href="${escapeHtml(opts.appUrl)}">Return to VinOS</a></p>` : ''}`);
}
