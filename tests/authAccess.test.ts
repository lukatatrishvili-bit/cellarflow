import { describe, expect, it } from 'vitest';
import { parseAuthAccessLink } from '../lib/authAccess';

describe('auth access link parsing', () => {
  it('captures password reset intent and username from the emailed URL', () => {
    expect(parseAuthAccessLink('/', '?reset_token=token-123&u=Cellar_User')).toEqual({
      flow: 'reset-password',
      resetToken: 'token-123',
      username: 'Cellar_User',
      invitationToken: '',
    });
  });

  it('captures invitations only on the invitation route', () => {
    expect(parseAuthAccessLink('/accept-invite/', '?token=invite-123')).toMatchObject({
      flow: 'accept-invite',
      invitationToken: 'invite-123',
    });
    expect(parseAuthAccessLink('/cellar', '?token=not-an-invite')).toMatchObject({
      flow: null,
      invitationToken: '',
    });
  });

  it('restores pending invitation intent after verification or OAuth removes the query string', () => {
    expect(parseAuthAccessLink('/', '', 'stored-invite')).toMatchObject({
      flow: 'accept-invite',
      invitationToken: 'stored-invite',
    });
  });

  it('gives an explicit reset link precedence over stale invitation state', () => {
    expect(parseAuthAccessLink('/reset-password', '?reset_token=reset&u=owner', 'stored-invite')).toEqual({
      flow: 'reset-password',
      resetToken: 'reset',
      username: 'owner',
      invitationToken: 'stored-invite',
    });
  });
});
