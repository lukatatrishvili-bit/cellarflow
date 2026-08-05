export const LOGIN_ROUTE = '/login';
export const DEFAULT_AUTHENTICATED_ROUTE = '/dashboard';
export const POST_LOGIN_RETURN_TO_KEY = 'vinos_post_login_return_to';

const PUBLIC_ROUTES = [
  '/',
  LOGIN_ROUTE,
  '/welcome',
  '/pricing',
  '/terroir-pulse',
  '/reset-password',
  '/accept-invite',
];

export function normalizeAppPath(route: string): string {
  const pathname = route.split(/[?#]/, 1)[0];
  return (pathname.startsWith('/') ? pathname : `/${pathname}`).replace(/\/+$/, '') || '/';
}

export function isPublicAppRoute(route: string): boolean {
  return PUBLIC_ROUTES.includes(normalizeAppPath(route));
}

/** Keep the post-login destination inside the application's protected pages. */
export function safeProtectedReturnTo(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (
    !candidate
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
  ) return null;

  const pathname = normalizeAppPath(candidate);
  if (pathname === '/' || isPublicAppRoute(pathname) || pathname === '/api' || pathname.startsWith('/api/')) {
    return null;
  }
  return `${pathname}${candidate.slice(candidate.search(/[?#]/) < 0 ? candidate.length : candidate.search(/[?#]/))}`;
}

/** Return the replacement URL required for the current authentication state. */
export function authRedirectTarget(
  route: string,
  isAuthenticated: boolean,
  pendingReturnTo?: string | null,
): string | null {
  const pathname = normalizeAppPath(route);
  const suffixAt = route.search(/[?#]/);
  const suffix = suffixAt < 0 ? '' : route.slice(suffixAt);
  const returnTo = safeProtectedReturnTo(pendingReturnTo);

  if (pathname === '/') {
    return isAuthenticated ? returnTo || `${DEFAULT_AUTHENTICATED_ROUTE}${suffix}` : null;
  }
  if (pathname === LOGIN_ROUTE) return isAuthenticated ? returnTo || DEFAULT_AUTHENTICATED_ROUTE : null;
  if (isPublicAppRoute(pathname)) return null;
  return isAuthenticated ? null : LOGIN_ROUTE;
}

export function resolveAuthRoute(
  route: string,
  isAuthenticated: boolean,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): string | null {
  try {
    const targetStorage = storage || sessionStorage;
    const pendingReturnTo = safeProtectedReturnTo(targetStorage.getItem(POST_LOGIN_RETURN_TO_KEY));
    const target = authRedirectTarget(route, isAuthenticated, pendingReturnTo);
    if (!target) return null;

    if (isAuthenticated) targetStorage.removeItem(POST_LOGIN_RETURN_TO_KEY);
    else {
      const returnTo = safeProtectedReturnTo(route);
      if (returnTo) targetStorage.setItem(POST_LOGIN_RETURN_TO_KEY, returnTo);
    }
    return target;
  } catch {
    return authRedirectTarget(route, isAuthenticated);
  }
}
