export type AuthAccessFlow = 'reset-password' | 'accept-invite' | null;

export interface AuthAccessLinkContext {
  flow: AuthAccessFlow;
  resetToken: string;
  username: string;
  invitationToken: string;
}

/** Parse auth-link intent without touching browser state, so URL handling is testable. */
export function parseAuthAccessLink(
  pathname: string,
  search: string,
  storedInvitationToken = '',
): AuthAccessLinkContext {
  const params = new URLSearchParams(search);
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const resetToken = (params.get('reset_token') || '').trim();
  const username = (params.get('u') || params.get('username') || '').trim();
  const invitationFromUrl = normalizedPath === '/accept-invite'
    ? (params.get('token') || '').trim()
    : '';
  const invitationToken = invitationFromUrl || storedInvitationToken.trim();

  return {
    flow: resetToken ? 'reset-password' : invitationToken ? 'accept-invite' : null,
    resetToken,
    username,
    invitationToken,
  };
}
