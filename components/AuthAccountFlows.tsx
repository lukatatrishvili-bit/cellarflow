import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  RefreshCcw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

export type AuthAccountFlow = 'forgot-password' | 'reset-password' | 'accept-invite';

export interface ReturnToSignInContext {
  flow: AuthAccountFlow;
  reason: 'cancelled' | 'recovery-complete' | 'authentication-required';
  invitationToken?: string;
}

export interface AuthenticatedStateNotice {
  authenticated: boolean;
  reason: 'invitation-accepted' | 'authentication-required';
  activeOrganizationId?: string;
  invitationToken: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AuthAccountFlowsProps {
  /** Only English and Georgian are intentionally supported in this P0 auth journey. */
  lang: 'en' | 'ka';
  /** When omitted, the flow is inferred from the current reset or invitation URL. */
  flow?: AuthAccountFlow;
  resetToken?: string;
  username?: string;
  invitationToken?: string;
  isAuthenticated?: boolean;
  onReturnToSignIn: (context: ReturnToSignInContext) => void;
  /** Lets the app clear a stale session or rehydrate after an invitation changes the active organization. */
  onAuthenticatedStateChange?: (notice: AuthenticatedStateNotice) => void;
  authApiBase?: string;
  organizationApiBase?: string;
  fetchImpl?: FetchLike;
  className?: string;
}

interface InvitationDetails {
  email: string;
  role: string;
  orgName: string;
}

interface AcceptInvitationResponse {
  ok: boolean;
  activeOrganizationId: string;
}

interface ApiError extends Error {
  status: number;
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

const COPY = {
  en: {
    backToSignIn: 'Back to sign in',
    forgotTitle: 'Reset your passcode',
    forgotDescription: 'Enter the email address for your VinOS account. We will send a secure reset link.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@winery.com',
    emailRequired: 'Enter your email address.',
    emailInvalid: 'Enter a valid email address.',
    requestReset: 'Send reset link',
    requestingReset: 'Sending reset link…',
    forgotSuccessTitle: 'Check your inbox',
    forgotSuccessDescription: 'If an account matches that email, reset instructions will arrive shortly. Check spam or junk mail too.',
    useAnotherEmail: 'Use another email',
    resetTitle: 'Choose a new passcode',
    resetDescription: 'Create a new passcode for your VinOS account.',
    usernameLabel: 'Account username',
    usernamePlaceholder: 'username',
    usernameRequired: 'Enter the username from your reset email.',
    passcodeLabel: 'New passcode',
    confirmPasscodeLabel: 'Confirm new passcode',
    passcodeHint: 'Use at least 8 characters.',
    passcodeRequired: 'Enter a new passcode.',
    passcodeLength: 'Your passcode must contain at least 8 characters.',
    passcodeMismatch: 'The passcodes do not match.',
    showPasscode: 'Show passcode',
    hidePasscode: 'Hide passcode',
    updatePasscode: 'Update passcode',
    updatingPasscode: 'Updating passcode…',
    resetSuccessTitle: 'Passcode updated',
    resetSuccessDescription: 'Your new passcode is ready. You can now sign in.',
    resetLinkMissingTitle: 'Reset link is incomplete',
    resetLinkMissingDescription: 'This link is missing its secure reset token. Request a new reset email and try again.',
    resetInvalid: 'This reset link is invalid or has expired. Request a new reset email.',
    inviteLoading: 'Checking your invitation…',
    inviteEyebrow: 'Workspace invitation',
    inviteTitle: 'Join {organization}',
    inviteDescription: 'You have been invited to join this VinOS winery workspace.',
    invitedEmail: 'Invited email',
    invitedRole: 'Workspace role',
    inviteAuthRequired: 'Sign in with your VinOS account to accept this invitation. Your invitation will be preserved.',
    inviteWrongAccount: 'This invitation was sent to a different email address. Sign in with the invited account.',
    inviteVerifyEmail: 'Verify the invited email address before accepting this invitation.',
    signInToAccept: 'Sign in to accept',
    acceptInvitation: 'Accept invitation',
    acceptingInvitation: 'Accepting invitation…',
    inviteAcceptedTitle: 'Invitation accepted',
    inviteAcceptedDescription: 'The workspace is now active. VinOS is refreshing your authenticated workspace.',
    inviteMissingTitle: 'Invitation link is incomplete',
    inviteMissingDescription: 'This link is missing its invitation token. Ask the workspace owner for a new invitation.',
    inviteInvalidTitle: 'Invitation unavailable',
    inviteInvalid: 'This invitation could not be found or is no longer valid.',
    inviteExpired: 'This invitation has expired. Ask the workspace owner to send a new one.',
    inviteAlreadyAccepted: 'This invitation has already been accepted.',
    retry: 'Try again',
    genericError: 'Something went wrong. Check your connection and try again.',
    serverError: 'VinOS could not complete this request. Please try again shortly.',
  },
  ka: {
    backToSignIn: 'შესვლაზე დაბრუნება',
    forgotTitle: 'შესვლის კოდის აღდგენა',
    forgotDescription: 'შეიყვანეთ VinOS ანგარიშთან დაკავშირებული ელფოსტა. უსაფრთხო აღდგენის ბმულს გამოგიგზავნით.',
    emailLabel: 'ელფოსტის მისამართი',
    emailPlaceholder: 'you@winery.com',
    emailRequired: 'შეიყვანეთ ელფოსტის მისამართი.',
    emailInvalid: 'შეიყვანეთ სწორი ელფოსტის მისამართი.',
    requestReset: 'აღდგენის ბმულის გაგზავნა',
    requestingReset: 'ბმული იგზავნება…',
    forgotSuccessTitle: 'შეამოწმეთ ელფოსტა',
    forgotSuccessDescription: 'თუ ამ ელფოსტას ანგარიში შეესაბამება, აღდგენის ინსტრუქციას მალე მიიღებთ. შეამოწმეთ სპამის საქაღალდეც.',
    useAnotherEmail: 'სხვა ელფოსტის გამოყენება',
    resetTitle: 'აირჩიეთ ახალი შესვლის კოდი',
    resetDescription: 'შექმენით ახალი შესვლის კოდი თქვენი VinOS ანგარიშისთვის.',
    usernameLabel: 'ანგარიშის სახელი',
    usernamePlaceholder: 'მომხმარებლის სახელი',
    usernameRequired: 'შეიყვანეთ აღდგენის წერილში მითითებული ანგარიშის სახელი.',
    passcodeLabel: 'ახალი შესვლის კოდი',
    confirmPasscodeLabel: 'გაიმეორეთ ახალი კოდი',
    passcodeHint: 'გამოიყენეთ სულ მცირე 8 სიმბოლო.',
    passcodeRequired: 'შეიყვანეთ ახალი შესვლის კოდი.',
    passcodeLength: 'შესვლის კოდი სულ მცირე 8 სიმბოლოს უნდა შეიცავდეს.',
    passcodeMismatch: 'შესვლის კოდები არ ემთხვევა.',
    showPasscode: 'კოდის ჩვენება',
    hidePasscode: 'კოდის დამალვა',
    updatePasscode: 'კოდის განახლება',
    updatingPasscode: 'კოდი ახლდება…',
    resetSuccessTitle: 'შესვლის კოდი განახლდა',
    resetSuccessDescription: 'ახალი კოდი მზადაა. ახლა შეგიძლიათ შეხვიდეთ ანგარიშში.',
    resetLinkMissingTitle: 'აღდგენის ბმული არასრულია',
    resetLinkMissingDescription: 'ბმულს უსაფრთხო აღდგენის ტოკენი აკლია. მოითხოვეთ ახალი წერილი და ხელახლა სცადეთ.',
    resetInvalid: 'აღდგენის ბმული არასწორია ან ვადა გაუვიდა. მოითხოვეთ ახალი წერილი.',
    inviteLoading: 'მოსაწვევი მოწმდება…',
    inviteEyebrow: 'სამუშაო სივრცის მოსაწვევი',
    inviteTitle: 'შეუერთდით: {organization}',
    inviteDescription: 'თქვენ მიგიწვიეს VinOS-ის ამ მარნის სამუშაო სივრცეში.',
    invitedEmail: 'მოწვეული ელფოსტა',
    invitedRole: 'როლი სამუშაო სივრცეში',
    inviteAuthRequired: 'მოსაწვევის მისაღებად შედით VinOS ანგარიშში. მოსაწვევი შენარჩუნდება.',
    inviteWrongAccount: 'ეს მოსაწვევი სხვა ელფოსტის მისამართზე გაიგზავნა. შედით მოწვეული ანგარიშით.',
    inviteVerifyEmail: 'მოსაწვევის მიღებამდე დაადასტურეთ მოწვეული ელფოსტის მისამართი.',
    signInToAccept: 'შესვლა და მიღება',
    acceptInvitation: 'მოსაწვევის მიღება',
    acceptingInvitation: 'მოსაწვევი მიიღება…',
    inviteAcceptedTitle: 'მოსაწვევი მიღებულია',
    inviteAcceptedDescription: 'სამუშაო სივრცე გააქტიურდა. VinOS თქვენს ავტორიზებულ სივრცეს აახლებს.',
    inviteMissingTitle: 'მოსაწვევის ბმული არასრულია',
    inviteMissingDescription: 'ბმულს მოსაწვევის ტოკენი აკლია. სთხოვეთ სივრცის მფლობელს ახალი მოსაწვევი.',
    inviteInvalidTitle: 'მოსაწვევი მიუწვდომელია',
    inviteInvalid: 'მოსაწვევი ვერ მოიძებნა ან აღარ მოქმედებს.',
    inviteExpired: 'მოსაწვევს ვადა გაუვიდა. სთხოვეთ სივრცის მფლობელს ახალი მოსაწვევის გამოგზავნა.',
    inviteAlreadyAccepted: 'ეს მოსაწვევი უკვე მიღებულია.',
    retry: 'ხელახლა ცდა',
    genericError: 'დაფიქსირდა შეცდომა. შეამოწმეთ კავშირი და ხელახლა სცადეთ.',
    serverError: 'VinOS-მა მოთხოვნა ვერ შეასრულა. ცოტა ხანში ხელახლა სცადეთ.',
  },
} as const;

const inputClass =
  'min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-[#4e0e15] focus:ring-2 focus:ring-[#4e0e15]/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-amber-400 dark:focus:ring-amber-400/15';
const primaryButtonClass =
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#4e0e15] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-amber-50 transition-colors hover:bg-[#34070a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4e0e15] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-amber-300';
const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-xs font-bold text-stone-700 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4e0e15] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800 dark:focus-visible:ring-amber-300';

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(' ');
}

function trimBase(value: string): string {
  return value.replace(/\/+$/, '');
}

function locationHints() {
  if (typeof window === 'undefined') {
    return { pathname: '', resetToken: '', username: '', invitationToken: '' };
  }
  const search = new URLSearchParams(window.location.search);
  return {
    pathname: window.location.pathname,
    resetToken: search.get('reset_token')?.trim() ?? '',
    username: (search.get('u') ?? search.get('username') ?? '').trim(),
    invitationToken: search.get('token')?.trim() ?? '',
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ({ error?: unknown } & T) | null;
  if (!response.ok) {
    const error = new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`) as ApiError;
    error.status = response.status;
    throw error;
  }
  return (body ?? {}) as T;
}

function statusOf(error: unknown): number {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : '';
}

function StatusPanel({
  icon,
  title,
  description,
  tone = 'success',
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  tone?: 'success' | 'danger' | 'neutral';
  children?: ReactNode;
}) {
  const tones = {
    success: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100',
    danger: 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-100',
    neutral: 'border-stone-200 bg-stone-50 text-stone-800 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-100',
  };
  return (
    <div className={joinClasses('rounded-2xl border p-5 text-center', tones[tone])} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/80 shadow-sm dark:bg-stone-900">
        {icon}
      </div>
      <h2 className="font-serif text-xl font-black">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-relaxed opacity-80">{description}</p>
      {children && <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">{children}</div>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300" role="alert">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

export default function AuthAccountFlows({
  lang,
  flow,
  resetToken,
  username: suppliedUsername,
  invitationToken,
  isAuthenticated = false,
  onReturnToSignIn,
  onAuthenticatedStateChange,
  authApiBase = '/api/auth',
  organizationApiBase = '/api/org',
  fetchImpl = defaultFetch,
  className,
}: AuthAccountFlowsProps) {
  const t = COPY[lang];
  const id = useId();
  const emailId = `${id}-email`;
  const usernameId = `${id}-username`;
  const passcodeId = `${id}-passcode`;
  const confirmationId = `${id}-confirmation`;
  const formErrorId = `${id}-form-error`;

  const resolved = useMemo(() => {
    const hints = locationHints();
    const pathIsInvitation = /\/accept-invite\/?$/.test(hints.pathname);
    const resolvedResetToken = resetToken?.trim() || hints.resetToken;
    const resolvedInvitationToken = invitationToken?.trim()
      || ((pathIsInvitation || flow === 'accept-invite') ? hints.invitationToken : '');
    const resolvedFlow = flow
      ?? (pathIsInvitation || resolvedInvitationToken
        ? 'accept-invite'
        : resolvedResetToken
          ? 'reset-password'
          : 'forgot-password');
    return {
      flow: resolvedFlow,
      resetToken: resolvedResetToken,
      username: suppliedUsername?.trim() || hints.username,
      invitationToken: resolvedInvitationToken,
    };
  }, [flow, invitationToken, resetToken, suppliedUsername]);

  const authBase = trimBase(authApiBase);
  const organizationBase = trimBase(organizationApiBase);

  const [email, setEmail] = useState('');
  const [resetUsername, setResetUsername] = useState(resolved.username);
  const [passcode, setPasscode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'email' | 'username' | 'passcode' | 'confirmation', string>>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationError, setInvitationError] = useState('');
  const [invitationAccepted, setInvitationAccepted] = useState(false);
  const [sessionRejected, setSessionRejected] = useState(false);
  const [invitationReload, setInvitationReload] = useState(0);

  useEffect(() => {
    setResetUsername(resolved.username);
  }, [resolved.username]);

  useEffect(() => {
    if (resolved.flow !== 'accept-invite') return;
    setInvitation(null);
    setInvitationError('');
    setInvitationAccepted(false);
    setSessionRejected(false);
    setInvitationLoading(false);

    if (!resolved.invitationToken) {
      setInvitationError(t.inviteMissingDescription);
      return;
    }

    const controller = new AbortController();
    setInvitationLoading(true);

    fetchImpl(`${organizationBase}/invitations/${encodeURIComponent(resolved.invitationToken)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(responseJson<InvitationDetails>)
      .then((details) => {
        setInvitation(details);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message = messageOf(error);
        if (message.includes('expired')) setInvitationError(t.inviteExpired);
        else if (message.includes('already been accepted')) setInvitationError(t.inviteAlreadyAccepted);
        else if (statusOf(error) === 404) setInvitationError(t.inviteInvalid);
        else if (statusOf(error) >= 500) setInvitationError(t.serverError);
        else setInvitationError(t.genericError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setInvitationLoading(false);
      });

    return () => controller.abort();
  }, [fetchImpl, invitationReload, organizationBase, resolved.flow, resolved.invitationToken, t]);

  const returnToSignIn = (reason: ReturnToSignInContext['reason']) => {
    onReturnToSignIn({
      flow: resolved.flow,
      reason,
      ...(resolved.flow === 'accept-invite' && resolved.invitationToken
        ? { invitationToken: resolved.invitationToken }
        : {}),
    });
  };

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: typeof fieldErrors = {};
    if (!normalizedEmail) nextErrors.email = t.emailRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) nextErrors.email = t.emailInvalid;
    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    try {
      const response = await fetchImpl(`${authBase}/forgot-password`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      // A known and unknown address intentionally resolve to the same screen.
      if (!response.ok && response.status >= 500) await responseJson(response);
      setForgotSent(true);
    } catch (error) {
      setFormError(statusOf(error) >= 500 ? t.serverError : t.genericError);
    } finally {
      setPending(false);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = resetUsername.trim().toLowerCase();
    const nextErrors: typeof fieldErrors = {};
    if (!normalizedUsername) nextErrors.username = t.usernameRequired;
    if (!passcode) nextErrors.passcode = t.passcodeRequired;
    else if (passcode.length < 8) nextErrors.passcode = t.passcodeLength;
    if (confirmation !== passcode) nextErrors.confirmation = t.passcodeMismatch;
    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length > 0 || !resolved.resetToken) return;

    setPending(true);
    try {
      const response = await fetchImpl(`${authBase}/reset-password`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token: resolved.resetToken, username: normalizedUsername, passcode }),
      });
      await responseJson<{ ok: boolean }>(response);
      setPasscode('');
      setConfirmation('');
      setResetComplete(true);
    } catch (error) {
      setFormError(statusOf(error) === 400 ? t.resetInvalid : statusOf(error) >= 500 ? t.serverError : t.genericError);
    } finally {
      setPending(false);
    }
  };

  const requireAuthentication = () => {
    onAuthenticatedStateChange?.({
      authenticated: false,
      reason: 'authentication-required',
      invitationToken: resolved.invitationToken,
    });
    returnToSignIn('authentication-required');
  };

  const handleAcceptInvitation = async () => {
    if (!resolved.invitationToken || pending) return;
    if (!isAuthenticated || sessionRejected) {
      requireAuthentication();
      return;
    }

    setPending(true);
    setInvitationError('');
    try {
      const response = await fetchImpl(`${organizationBase}/accept-invite`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token: resolved.invitationToken }),
      });
      const result = await responseJson<AcceptInvitationResponse>(response);
      setInvitationAccepted(true);
      onAuthenticatedStateChange?.({
        authenticated: true,
        reason: 'invitation-accepted',
        activeOrganizationId: result.activeOrganizationId,
        invitationToken: resolved.invitationToken,
      });
    } catch (error) {
      const message = messageOf(error);
      if (statusOf(error) === 401) {
        setSessionRejected(true);
        setInvitationError(t.inviteAuthRequired);
        onAuthenticatedStateChange?.({
          authenticated: false,
          reason: 'authentication-required',
          invitationToken: resolved.invitationToken,
        });
      } else if (statusOf(error) === 403) {
        setSessionRejected(true);
        setInvitationError(message.includes('verify your email') ? t.inviteVerifyEmail : t.inviteWrongAccount);
        onAuthenticatedStateChange?.({
          authenticated: false,
          reason: 'authentication-required',
          invitationToken: resolved.invitationToken,
        });
      } else if (message.includes('expired')) setInvitationError(t.inviteExpired);
      else if (message.includes('already been accepted')) setInvitationError(t.inviteAlreadyAccepted);
      else if (statusOf(error) === 404) setInvitationError(t.inviteInvalid);
      else if (statusOf(error) >= 500) setInvitationError(t.serverError);
      else setInvitationError(t.genericError);
    } finally {
      setPending(false);
    }
  };

  const renderForgotPassword = () => {
    if (forgotSent) {
      return (
        <StatusPanel
          icon={<Mail className="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />}
          title={t.forgotSuccessTitle}
          description={t.forgotSuccessDescription}
        >
          <button type="button" className={secondaryButtonClass} onClick={() => { setForgotSent(false); setEmail(''); }}>
            {t.useAnotherEmail}
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => returnToSignIn('recovery-complete')}>
            {t.backToSignIn}
          </button>
        </StatusPanel>
      );
    }

    return (
      <>
        <div>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#4e0e15]/10 text-[#4e0e15] dark:bg-amber-400/10 dark:text-amber-300">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 id={`${id}-title`} className="font-serif text-2xl font-black text-stone-900 dark:text-amber-100">{t.forgotTitle}</h1>
          <p className="mt-2 text-sm font-medium leading-relaxed text-stone-500 dark:text-stone-400">{t.forgotDescription}</p>
        </div>
        <form className="mt-6 space-y-5" onSubmit={handleForgotPassword} noValidate aria-busy={pending} aria-describedby={formError ? formErrorId : undefined}>
          <div>
            <label htmlFor={emailId} className="mb-1.5 block text-xs font-bold text-stone-700 dark:text-stone-200">{t.emailLabel}</label>
            <input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setFieldErrors(current => ({ ...current, email: undefined })); }}
              placeholder={t.emailPlaceholder}
              className={inputClass}
              disabled={pending}
              required
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
            />
            <FieldError id={`${emailId}-error`}>{fieldErrors.email}</FieldError>
          </div>
          {formError && <FieldError id={formErrorId}>{formError}</FieldError>}
          <button type="submit" className={primaryButtonClass} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? t.requestingReset : t.requestReset}
          </button>
        </form>
      </>
    );
  };

  const renderResetPassword = () => {
    if (!resolved.resetToken) {
      return (
        <StatusPanel
          icon={<AlertCircle className="h-5 w-5 text-rose-700 dark:text-rose-300" aria-hidden="true" />}
          title={t.resetLinkMissingTitle}
          description={t.resetLinkMissingDescription}
          tone="danger"
        >
          <button type="button" className={primaryButtonClass} onClick={() => returnToSignIn('cancelled')}>{t.backToSignIn}</button>
        </StatusPanel>
      );
    }
    if (resetComplete) {
      return (
        <StatusPanel
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />}
          title={t.resetSuccessTitle}
          description={t.resetSuccessDescription}
        >
          <button type="button" className={primaryButtonClass} onClick={() => returnToSignIn('recovery-complete')}>{t.backToSignIn}</button>
        </StatusPanel>
      );
    }

    const passwordDescription = fieldErrors.passcode ? `${passcodeId}-hint ${passcodeId}-error` : `${passcodeId}-hint`;
    return (
      <>
        <div>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#4e0e15]/10 text-[#4e0e15] dark:bg-amber-400/10 dark:text-amber-300">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 id={`${id}-title`} className="font-serif text-2xl font-black text-stone-900 dark:text-amber-100">{t.resetTitle}</h1>
          <p className="mt-2 text-sm font-medium leading-relaxed text-stone-500 dark:text-stone-400">{t.resetDescription}</p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={handleResetPassword} noValidate aria-busy={pending} aria-describedby={formError ? formErrorId : undefined}>
          <div>
            <label htmlFor={usernameId} className="mb-1.5 block text-xs font-bold text-stone-700 dark:text-stone-200">{t.usernameLabel}</label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
              <input
                id={usernameId}
                type="text"
                autoComplete="username"
                value={resetUsername}
                onChange={(event) => { setResetUsername(event.target.value); setFieldErrors(current => ({ ...current, username: undefined })); }}
                placeholder={t.usernamePlaceholder}
                className={joinClasses(inputClass, 'pl-9')}
                readOnly={Boolean(resolved.username)}
                disabled={pending}
                required
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={fieldErrors.username ? `${usernameId}-error` : undefined}
              />
            </div>
            <FieldError id={`${usernameId}-error`}>{fieldErrors.username}</FieldError>
          </div>
          <div>
            <label htmlFor={passcodeId} className="mb-1.5 block text-xs font-bold text-stone-700 dark:text-stone-200">{t.passcodeLabel}</label>
            <div className="relative">
              <input
                id={passcodeId}
                type={showPasscode ? 'text' : 'password'}
                autoComplete="new-password"
                value={passcode}
                onChange={(event) => { setPasscode(event.target.value); setFieldErrors(current => ({ ...current, passcode: undefined })); }}
                className={joinClasses(inputClass, 'pr-12')}
                minLength={8}
                disabled={pending}
                required
                aria-invalid={Boolean(fieldErrors.passcode)}
                aria-describedby={passwordDescription}
              />
              <button
                type="button"
                onClick={() => setShowPasscode(current => !current)}
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4e0e15] dark:hover:bg-stone-800 dark:hover:text-stone-100 dark:focus-visible:ring-amber-300"
                aria-label={showPasscode ? t.hidePasscode : t.showPasscode}
                aria-pressed={showPasscode}
                disabled={pending}
              >
                {showPasscode ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            <p id={`${passcodeId}-hint`} className="mt-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">{t.passcodeHint}</p>
            <FieldError id={`${passcodeId}-error`}>{fieldErrors.passcode}</FieldError>
          </div>
          <div>
            <label htmlFor={confirmationId} className="mb-1.5 block text-xs font-bold text-stone-700 dark:text-stone-200">{t.confirmPasscodeLabel}</label>
            <input
              id={confirmationId}
              type={showPasscode ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => { setConfirmation(event.target.value); setFieldErrors(current => ({ ...current, confirmation: undefined })); }}
              className={inputClass}
              minLength={8}
              disabled={pending}
              required
              aria-invalid={Boolean(fieldErrors.confirmation)}
              aria-describedby={fieldErrors.confirmation ? `${confirmationId}-error` : undefined}
            />
            <FieldError id={`${confirmationId}-error`}>{fieldErrors.confirmation}</FieldError>
          </div>
          {formError && <FieldError id={formErrorId}>{formError}</FieldError>}
          <button type="submit" className={primaryButtonClass} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? t.updatingPasscode : t.updatePasscode}
          </button>
        </form>
      </>
    );
  };

  const renderInvitation = () => {
    if (!resolved.invitationToken) {
      return (
        <StatusPanel
          icon={<AlertCircle className="h-5 w-5 text-rose-700 dark:text-rose-300" aria-hidden="true" />}
          title={t.inviteMissingTitle}
          description={t.inviteMissingDescription}
          tone="danger"
        >
          <button type="button" className={primaryButtonClass} onClick={() => returnToSignIn('cancelled')}>{t.backToSignIn}</button>
        </StatusPanel>
      );
    }
    if (invitationAccepted) {
      return (
        <StatusPanel
          icon={<ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />}
          title={t.inviteAcceptedTitle}
          description={t.inviteAcceptedDescription}
        />
      );
    }
    if (invitationLoading) {
      return (
        <StatusPanel
          icon={<Loader2 className="h-5 w-5 animate-spin text-[#4e0e15] dark:text-amber-300" aria-hidden="true" />}
          title={t.inviteLoading}
          description=""
          tone="neutral"
        />
      );
    }
    if (!invitation) {
      return (
        <StatusPanel
          icon={<AlertCircle className="h-5 w-5 text-rose-700 dark:text-rose-300" aria-hidden="true" />}
          title={t.inviteInvalidTitle}
          description={invitationError || t.inviteInvalid}
          tone="danger"
        >
          <button type="button" className={secondaryButtonClass} onClick={() => setInvitationReload(current => current + 1)}>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" /> {t.retry}
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => returnToSignIn('cancelled')}>{t.backToSignIn}</button>
        </StatusPanel>
      );
    }

    const needsSignIn = !isAuthenticated || sessionRejected;
    return (
      <>
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#4e0e15] dark:text-amber-300">{t.inviteEyebrow}</span>
          <div className="mt-2 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#4e0e15]/10 text-[#4e0e15] dark:bg-amber-400/10 dark:text-amber-300">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 id={`${id}-title`} className="font-serif text-2xl font-black text-stone-900 dark:text-amber-100">
                {t.inviteTitle.replace('{organization}', invitation.orgName)}
              </h1>
              <p className="mt-1 text-sm font-medium leading-relaxed text-stone-500 dark:text-stone-400">{t.inviteDescription}</p>
            </div>
          </div>
        </div>
        <dl className="mt-6 divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50/70 text-sm dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-950/30">
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:items-center">
            <dt className="text-xs font-bold text-stone-500 dark:text-stone-400">{t.invitedEmail}</dt>
            <dd className="break-all font-semibold text-stone-900 dark:text-stone-100">{invitation.email}</dd>
          </div>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:items-center">
            <dt className="text-xs font-bold text-stone-500 dark:text-stone-400">{t.invitedRole}</dt>
            <dd className="font-semibold text-stone-900 dark:text-stone-100">{invitation.role}</dd>
          </div>
        </dl>
        {needsSignIn && !invitationError && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200" role="status">
            {t.inviteAuthRequired}
          </p>
        )}
        {invitationError && <div className="mt-4"><FieldError id={formErrorId}>{invitationError}</FieldError></div>}
        <button type="button" className={joinClasses(primaryButtonClass, 'mt-5')} onClick={handleAcceptInvitation} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {pending ? t.acceptingInvitation : needsSignIn ? t.signInToAccept : t.acceptInvitation}
        </button>
      </>
    );
  };

  return (
    <section
      className={joinClasses('w-full max-w-lg rounded-3xl border border-[#e8dfd5] bg-white/95 p-5 shadow-xl shadow-[#4e0e15]/5 sm:p-7 dark:border-stone-800 dark:bg-stone-900/95', className)}
      aria-label={resolved.flow === 'forgot-password' ? t.forgotTitle : resolved.flow === 'reset-password' ? t.resetTitle : t.inviteEyebrow}
    >
      {!forgotSent && !resetComplete && !invitationAccepted && (
        <button type="button" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-xs font-bold text-stone-500 hover:text-[#4e0e15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4e0e15] dark:text-stone-400 dark:hover:text-amber-300 dark:focus-visible:ring-amber-300" onClick={() => returnToSignIn('cancelled')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t.backToSignIn}
        </button>
      )}
      <div>
        {resolved.flow === 'forgot-password'
          ? renderForgotPassword()
          : resolved.flow === 'reset-password'
            ? renderResetPassword()
            : renderInvitation()}
      </div>
    </section>
  );
}
