import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TTL_MS,
  applyApprovalDecision,
  approvalNotificationRecipient,
  approvalStatusForUser,
  approvalTokenMatches,
  describeApprovalRequest,
  generateApprovalToken,
  markAwaitingApproval,
  registrationApprovalRequired,
  renderApprovalReviewPage,
  userAwaitsApproval,
} from '../server/registrationApproval';

describe('registration approval policy', () => {
  it('requires approval unless a deployment opts out explicitly', () => {
    expect(registrationApprovalRequired({} as NodeJS.ProcessEnv)).toBe(true);
    expect(registrationApprovalRequired({ REQUIRE_REGISTRATION_APPROVAL: 'true' } as any)).toBe(true);
    // A typo must not silently reopen self-service registration.
    expect(registrationApprovalRequired({ REQUIRE_REGISTRATION_APPROVAL: 'flase' } as any)).toBe(true);
    expect(registrationApprovalRequired({ REQUIRE_REGISTRATION_APPROVAL: 'false' } as any)).toBe(false);
    expect(registrationApprovalRequired({ REQUIRE_REGISTRATION_APPROVAL: ' OFF ' } as any)).toBe(false);
  });

  it('resolves the reviewer mailbox through the documented fallback chain', () => {
    expect(approvalNotificationRecipient({
      REGISTRATION_APPROVAL_EMAIL: 'owner@estate.ge',
      ADMIN_EMAIL: 'other@estate.ge',
    } as any)).toBe('owner@estate.ge');
    expect(approvalNotificationRecipient({ ADMIN_EMAIL: 'Admin@Estate.GE' } as any)).toBe('admin@estate.ge');
    expect(approvalNotificationRecipient({ MAIL_FROM: 'VinOS <no-reply@estate.ge>' } as any)).toBe('no-reply@estate.ge');
    expect(approvalNotificationRecipient({ SMTP_USER: 'smtp@estate.ge' } as any)).toBe('smtp@estate.ge');
    expect(approvalNotificationRecipient({ MAIL_FROM: 'not-an-address' } as any)).toBe('');
    expect(approvalNotificationRecipient({} as any)).toBe('');
  });
});

describe('approval state on the user record', () => {
  it('treats accounts stored before the gate existed as approved', () => {
    expect(approvalStatusForUser({ username: 'legacy' })).toBe('approved');
    expect(approvalStatusForUser({ approvalStatus: 'PENDING' })).toBe('pending');
    expect(approvalStatusForUser({ approvalStatus: 'rejected' })).toBe('rejected');
    expect(approvalStatusForUser({ approvalStatus: 'nonsense' })).toBe('approved');
    expect(approvalStatusForUser(null)).toBe('approved');
  });

  it('marks a new signup pending and stores only the token digest', () => {
    const user: any = { username: 'applicant' };
    const token = generateApprovalToken();
    markAwaitingApproval(user, token);

    expect(userAwaitsApproval(user)).toBe(true);
    expect(user.approvalTokenHash).toBe(token.tokenHash);
    expect(JSON.stringify(user)).not.toContain(token.token);
    expect(user.approvalTokenExpires - Date.now()).toBeGreaterThan(APPROVAL_TTL_MS - 5000);
  });

  it('accepts only the matching, unexpired review token', () => {
    const user: any = { username: 'applicant' };
    const token = generateApprovalToken();
    markAwaitingApproval(user, token);

    expect(approvalTokenMatches(user, token.token)).toBe(true);
    expect(approvalTokenMatches(user, 'wrong-token')).toBe(false);
    expect(approvalTokenMatches(user, '')).toBe(false);
    expect(approvalTokenMatches(user, token.token, Date.now() + APPROVAL_TTL_MS + 1000)).toBe(false);
  });

  it('burns the review token when a decision is recorded', () => {
    const user: any = { username: 'applicant' };
    const token = generateApprovalToken();
    markAwaitingApproval(user, token);

    expect(applyApprovalDecision(user, 'approve', 'master')).toBe('approved');
    expect(user.approvalDecidedBy).toBe('master');
    expect(user.approvalTokenHash).toBeUndefined();
    expect(approvalTokenMatches(user, token.token)).toBe(false);

    expect(applyApprovalDecision(user, 'reject', 'master')).toBe('rejected');
    expect(approvalStatusForUser(user)).toBe('rejected');
  });
});

describe('reviewer page', () => {
  const applicant = {
    username: 'applicant',
    fullName: 'Nino <script>alert(1)</script>',
    email: 'nino@estate.ge',
    passwordHash: 'hash',
    language: 'ka',
    role: 'Owner/Admin',
    approvalRequestedAt: '2026-08-03T09:00:00.000Z',
    emailVerified: false,
  };

  it('describes the request from the account and its estate profile', () => {
    const details = describeApprovalRequest(applicant, { companyName: 'Marani LLC', country: 'Georgia', phone: '+995555123456' });
    expect(details).toEqual(expect.objectContaining({
      username: 'applicant',
      email: 'nino@estate.ge',
      companyName: 'Marani LLC',
      country: 'Georgia',
      phone: '+995555123456',
      provider: 'password',
    }));
    expect(describeApprovalRequest({ ...applicant, passwordHash: '' }).provider).toBe('google');
  });

  it('escapes applicant-controlled text so a name cannot inject markup', () => {
    const html = renderApprovalReviewPage({
      details: describeApprovalRequest(applicant, { companyName: '"><img src=x>' }),
      token: 'review-token',
      actionPath: '/api/auth/registration-approval',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('value="review-token"');
    expect(html).toContain('name="decision" value="approve"');
  });
});
