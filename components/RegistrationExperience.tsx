import React, { lazy, Suspense, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Grape,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  PlayCircle,
  ShieldCheck,
  Sprout,
  UserRound,
  Wine,
} from 'lucide-react';
import type { CompanyProfile, UserProfile } from '../lib/wineryState';
import type { PickedLocation } from './LocationPicker';
import { useFocusTrap } from './useFocusTrap';

const LocationPicker = lazy(() => import('./LocationPicker'));

type RegistrationLanguage = 'en' | 'ka';

export interface RegistrationSubmission {
  fullName: string;
  email: string;
  companyName: string;
  passcode: string;
}

interface RegistrationPanelProps {
  lang: RegistrationLanguage;
  error?: string | null;
  submitting?: boolean;
  onSubmit: (submission: RegistrationSubmission) => Promise<void> | void;
  onGoogle: () => void;
  onSignIn: () => void;
  onLanguageChange: (lang: RegistrationLanguage) => void;
}

const COPY = {
  en: {
    eyebrow: 'Your workspace starts here',
    title: 'Run your estate with less friction.',
    description: 'Create the secure account now. We will personalize vineyard, cellar, and location settings after you verify your email.',
    google: 'Continue with Google',
    divider: 'or create with email',
    fullName: 'Full name',
    fullNamePlaceholder: 'Your name',
    email: 'Work email',
    emailPlaceholder: 'you@winery.com',
    company: 'Estate or company',
    companyPlaceholder: 'Kvareli Estate',
    passcode: 'Password',
    passcodePlaceholder: 'At least 8 characters',
    passcodeHint: 'Use 8 or more characters. Passphrases work well.',
    submit: 'Create my workspace',
    submitting: 'Creating workspace…',
    signInPrompt: 'Already have an account?',
    signIn: 'Sign in',
    privacy: 'Your operational data stays private to your workspace.',
    fast: '',
    later: 'Finish details later',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
  },
  ka: {
    eyebrow: 'თქვენი სამუშაო სივრცე აქ იწყება',
    title: 'მართეთ მეურნეობა ნაკლები სირთულით.',
    description: 'ახლა შექმენით უსაფრთხო ანგარიში. ელფოსტის დადასტურების შემდეგ ვენახის, მარნისა და მდებარეობის პარამეტრებს მოარგებთ.',
    google: 'Google-ით გაგრძელება',
    divider: 'ან შექმენით ელფოსტით',
    fullName: 'სრული სახელი',
    fullNamePlaceholder: 'თქვენი სახელი',
    email: 'სამუშაო ელფოსტა',
    emailPlaceholder: 'you@winery.com',
    company: 'მამული ან კომპანია',
    companyPlaceholder: 'ყვარლის მამული',
    passcode: 'პაროლი',
    passcodePlaceholder: 'მინიმუმ 8 სიმბოლო',
    passcodeHint: 'გამოიყენეთ 8 ან მეტი სიმბოლო. გრძელი ფრაზაც გამოდგება.',
    submit: 'სამუშაო სივრცის შექმნა',
    submitting: 'იქმნება სამუშაო სივრცე…',
    signInPrompt: 'უკვე გაქვთ ანგარიში?',
    signIn: 'შესვლა',
    privacy: 'თქვენი საოპერაციო მონაცემები მხოლოდ თქვენს სივრცეში რჩება.',
    fast: '',
    later: 'დეტალები მოგვიანებით',
    showPassword: 'პაროლის ჩვენება',
    hidePassword: 'პაროლის დამალვა',
  },
} as const;

function GoogleMark() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

function FieldShell({
  id,
  label,
  icon,
  labelAction,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  labelAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-sm font-semibold text-stone-800 dark:text-stone-100">
          {label}
        </label>
        {labelAction}
      </div>
      <div className="group relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-stone-400 transition-colors group-focus-within:text-[#7a1723] dark:group-focus-within:text-amber-300">
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}

const inputClassName = 'h-12 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-[15px] font-medium text-stone-950 outline-none transition placeholder:text-stone-400 hover:border-stone-300 focus:border-[#7a1723] focus:ring-4 focus:ring-[#7a1723]/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50 dark:focus:border-amber-400 dark:focus:ring-amber-400/10';

function LanguageSwitcher({
  lang,
  onLanguageChange,
}: {
  lang: RegistrationLanguage;
  onLanguageChange: (lang: RegistrationLanguage) => void;
}) {
  return (
    <div className="flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-[11px] font-black dark:border-stone-700 dark:bg-stone-800" aria-label={lang === 'ka' ? 'ენის არჩევა' : 'Choose language'}>
      {(['en', 'ka'] as const).map(code => (
        <button
          key={code}
          type="button"
          onClick={() => onLanguageChange(code)}
          aria-pressed={lang === code}
          className={`rounded-md px-2.5 py-1.5 transition ${lang === code ? 'bg-white text-[#68121d] shadow-sm dark:bg-stone-700 dark:text-amber-200' : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'}`}
        >
          {code === 'en' ? 'EN' : 'ქართული'}
        </button>
      ))}
    </div>
  );
}

export function RegistrationPanel({
  lang,
  error,
  submitting = false,
  onSubmit,
  onGoogle,
  onSignIn,
  onLanguageChange,
}: RegistrationPanelProps) {
  const copy = COPY[lang];
  const [showPasscode, setShowPasscode] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    await onSubmit({
      fullName: String(form.get('fullName') || '').trim(),
      email: String(form.get('email') || '').trim(),
      companyName: String(form.get('companyName') || '').trim(),
      passcode: String(form.get('passcode') || ''),
    });
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#7a1723]/10 bg-[#7a1723]/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a1723] dark:border-amber-300/15 dark:bg-amber-300/10 dark:text-amber-200">
            <Grape className="h-3.5 w-3.5" aria-hidden="true" /> {copy.eyebrow}
          </div>
          <LanguageSwitcher lang={lang} onLanguageChange={onLanguageChange} />
        </div>
        <h1 className="max-w-md font-serif text-3xl font-black leading-tight tracking-[-0.025em] text-stone-950 dark:text-stone-50 sm:text-[2.15rem]">
          {copy.title}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">
          {copy.description}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-stone-600 dark:text-stone-300">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-800"><Check className="h-3.5 w-3.5 text-emerald-700" />{copy.later}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onGoogle}
        disabled={submitting}
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-stone-250 bg-white px-4 text-sm font-bold text-stone-800 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] disabled:cursor-wait disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        <GoogleMark /> {copy.google}
      </button>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">{copy.divider}</span>
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
        <FieldShell id="registration-full-name" label={copy.fullName} icon={<UserRound className="h-4 w-4" />}>
          <input id="registration-full-name" name="fullName" type="text" autoComplete="name" placeholder={copy.fullNamePlaceholder} className={inputClassName} style={{ paddingLeft: '2.75rem' }} required />
        </FieldShell>

        <FieldShell id="registration-email" label={copy.email} icon={<Mail className="h-4 w-4" />}>
          <input id="registration-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder={copy.emailPlaceholder} className={inputClassName} style={{ paddingLeft: '2.75rem' }} required />
        </FieldShell>

        <FieldShell id="registration-company" label={copy.company} icon={<Building2 className="h-4 w-4" />}>
          <input id="registration-company" name="companyName" type="text" autoComplete="organization" placeholder={copy.companyPlaceholder} className={inputClassName} style={{ paddingLeft: '2.75rem' }} required />
        </FieldShell>

        <FieldShell id="registration-passcode" label={copy.passcode} icon={<LockKeyhole className="h-4 w-4" />}>
          <input
            id="registration-passcode"
            name="passcode"
            type={showPasscode ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            placeholder={copy.passcodePlaceholder}
            className={`${inputClassName} pr-11`}
            style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
            aria-describedby="registration-passcode-hint"
            required
          />
          <button
            type="button"
            onClick={() => setShowPasscode(value => !value)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-400 transition hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#7a1723] dark:hover:text-stone-100"
            aria-label={showPasscode ? copy.hidePassword : copy.showPassword}
          >
            {showPasscode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </FieldShell>
        <p id="registration-passcode-hint" className="-mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{copy.passcodeHint}</p>

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold leading-5 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#68121d] px-5 text-sm font-black text-white shadow-[0_14px_30px_-16px_rgba(104,18,29,0.9)] transition hover:-translate-y-0.5 hover:bg-[#7d1724] hover:shadow-[0_18px_34px_-16px_rgba(104,18,29,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-65"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? copy.submitting : copy.submit}
          {!submitting ? <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /> : null}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
        <span>{copy.signInPrompt}</span>
        <button type="button" onClick={onSignIn} className="font-bold text-[#68121d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] dark:text-amber-300">
          {copy.signIn}
        </button>
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs leading-5 text-stone-400">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {copy.privacy}
      </p>
    </div>
  );
}

export interface SignInSubmission {
  identifier: string;
  passcode: string;
  rememberMe: boolean;
}

interface SignInPanelProps {
  lang: RegistrationLanguage;
  error?: string | null;
  submitting?: boolean;
  demoEnabled?: boolean;
  invitationPending?: boolean;
  onSubmit: (submission: SignInSubmission) => Promise<void> | void;
  onGoogle: () => void;
  onForgotPassword: () => void;
  onRegister: () => void;
  onDemo: () => Promise<void> | void;
  onLanguageChange: (lang: RegistrationLanguage) => void;
}

const SIGN_IN_COPY = {
  en: {
    eyebrow: 'Secure workspace access',
    title: 'Welcome back to your estate.',
    description: 'Continue your vineyard and cellar work exactly where your team left it.',
    invitation: 'Sign in with the email address that received the workspace invitation.',
    identifier: 'Email or username',
    identifierPlaceholder: 'you@winery.com',
    password: 'Password',
    passwordPlaceholder: 'Enter your password',
    forgot: 'Forgot password?',
    remember: 'Keep me signed in on this device',
    submit: 'Enter workspace',
    submitting: 'Signing in…',
    divider: 'or continue with',
    google: 'Continue with Google',
    demoTitle: 'Open demo workspace',
    demoDescription: 'Explore the real interface and services without creating production records.',
    newPrompt: 'New to VinOS?',
    register: 'Create a workspace',
    privacy: 'Protected access to your private operational workspace.',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
  },
  ka: {
    eyebrow: 'უსაფრთხო წვდომა სამუშაო სივრცეზე',
    title: 'კეთილი იყოს თქვენი დაბრუნება.',
    description: 'გააგრძელეთ ვენახისა და მარნის სამუშაო ზუსტად იქიდან, სადაც გუნდმა დატოვა.',
    invitation: 'შედით იმ ელფოსტით, რომელზეც სამუშაო სივრცის მოსაწვევი მიიღეთ.',
    identifier: 'ელფოსტა ან მომხმარებელი',
    identifierPlaceholder: 'you@winery.com',
    password: 'პაროლი',
    passwordPlaceholder: 'შეიყვანეთ პაროლი',
    forgot: 'დაგავიწყდათ პაროლი?',
    remember: 'დამიმახსოვრე ამ მოწყობილობაზე',
    submit: 'სამუშაო სივრცეში შესვლა',
    submitting: 'შესვლა მიმდინარეობს…',
    divider: 'ან გააგრძელეთ',
    google: 'Google-ით გაგრძელება',
    demoTitle: 'დემო სივრცის გახსნა',
    demoDescription: 'დაათვალიერეთ რეალური ინტერფეისი და სერვისები საწარმოო ჩანაწერების შექმნის გარეშე.',
    newPrompt: 'ახალი ხართ VinOS-ში?',
    register: 'სამუშაო სივრცის შექმნა',
    privacy: 'დაცული წვდომა თქვენს პირად საოპერაციო სივრცეზე.',
    showPassword: 'პაროლის ჩვენება',
    hidePassword: 'პაროლის დამალვა',
  },
} as const;

export function SignInPanel({
  lang,
  error,
  submitting = false,
  demoEnabled = false,
  invitationPending = false,
  onSubmit,
  onGoogle,
  onForgotPassword,
  onRegister,
  onDemo,
  onLanguageChange,
}: SignInPanelProps) {
  const copy = SIGN_IN_COPY[lang];
  const [showPasscode, setShowPasscode] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    await onSubmit({
      identifier: String(form.get('identifier') || '').trim(),
      passcode: String(form.get('passcode') || ''),
      rememberMe: form.get('rememberMe') === 'true',
    });
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="mb-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#7a1723]/10 bg-[#7a1723]/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a1723] dark:border-amber-300/15 dark:bg-amber-300/10 dark:text-amber-200">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {copy.eyebrow}
          </div>
          <LanguageSwitcher lang={lang} onLanguageChange={onLanguageChange} />
        </div>
        <h1 className="max-w-md font-serif text-3xl font-black leading-tight tracking-[-0.025em] text-stone-950 dark:text-stone-50 sm:text-[2.15rem]">
          {copy.title}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">
          {copy.description}
        </p>
      </div>

      {invitationPending && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm font-semibold leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{copy.invitation}</span>
        </div>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
        <FieldShell id="auth-login-identifier" label={copy.identifier} icon={<Mail className="h-4 w-4" />}>
          <input
            id="auth-login-identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            inputMode="email"
            placeholder={copy.identifierPlaceholder}
            className={inputClassName}
            style={{ paddingLeft: '2.75rem' }}
            required
          />
        </FieldShell>

        <FieldShell
          id="auth-login-passcode"
          label={copy.password}
          icon={<LockKeyhole className="h-4 w-4" />}
          labelAction={(
            <button
              type="button"
              onClick={onForgotPassword}
              className="rounded-md px-1.5 py-1 text-xs font-bold text-[#68121d] transition hover:bg-[#68121d]/5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] dark:text-amber-300"
            >
              {copy.forgot}
            </button>
          )}
        >
          <input
            id="auth-login-passcode"
            name="passcode"
            type={showPasscode ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={copy.passwordPlaceholder}
            className={`${inputClassName} pr-11`}
            style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
            required
          />
          <button
            type="button"
            onClick={() => setShowPasscode(value => !value)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-400 transition hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#7a1723] dark:hover:text-stone-100"
            aria-label={showPasscode ? copy.hidePassword : copy.showPassword}
          >
            {showPasscode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </FieldShell>

        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg text-sm font-semibold text-stone-600 dark:text-stone-300">
          <input
            type="checkbox"
            name="rememberMe"
            defaultChecked
            value="true"
            className="h-4 w-4 rounded border-stone-300 accent-[#68121d] focus:ring-[#68121d]"
          />
          <span>{copy.remember}</span>
        </label>

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold leading-5 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#68121d] px-5 text-sm font-black text-white shadow-[0_14px_30px_-16px_rgba(104,18,29,0.9)] transition hover:-translate-y-0.5 hover:bg-[#7d1724] hover:shadow-[0_18px_34px_-16px_rgba(104,18,29,0.95)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-65"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? copy.submitting : copy.submit}
          {!submitting ? <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /> : null}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">{copy.divider}</span>
        <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
      </div>

      <button
        type="button"
        onClick={onGoogle}
        disabled={submitting}
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-stone-250 bg-white px-4 text-sm font-bold text-stone-800 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] disabled:cursor-wait disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        <GoogleMark /> {copy.google}
      </button>

      {demoEnabled && (
        <button
          type="button"
          onClick={() => void onDemo()}
          disabled={submitting}
          className="mt-3 flex w-full items-center gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-wait disabled:opacity-60 dark:border-amber-900/60 dark:bg-amber-950/20"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"><PlayCircle className="h-4 w-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-black text-[#68121d] dark:text-amber-200">{copy.demoTitle}</span>
            <span className="mt-0.5 block text-xs leading-5 text-stone-500 dark:text-stone-400">{copy.demoDescription}</span>
          </span>
        </button>
      )}

      <div className="mt-5 flex items-center justify-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
        <span>{copy.newPrompt}</span>
        <button type="button" onClick={onRegister} className="font-bold text-[#68121d] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] dark:text-amber-300">
          {copy.register}
        </button>
      </div>

      <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs leading-5 text-stone-400">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {copy.privacy}
      </p>
    </div>
  );
}

export interface WorkspaceSetupSubmission {
  companyName: string;
  enabledModules: string[];
  enabledWidgets: string[];
  location: PickedLocation | null;
}

interface WorkspaceSetupDialogProps {
  lang: RegistrationLanguage;
  required: boolean;
  user: UserProfile;
  companyProfile: Partial<CompanyProfile>;
  error?: string | null;
  onSubmit: (submission: WorkspaceSetupSubmission) => Promise<boolean>;
  onClose: () => void;
}

const SETUP_COPY = {
  en: {
    setup: 'Workspace setup',
    step: 'Step',
    of: 'of',
    firstTitle: 'What do you manage?',
    firstDescription: 'Choose the work you want at hand. You can change this later without losing data.',
    workspaceName: 'Workspace name',
    workspaceHint: 'This is the estate or company your team will recognize.',
    vineyard: 'Vineyard',
    vineyardDescription: 'Blocks, weather, scouting, sprays, and harvest.',
    cellar: 'Cellar',
    cellarDescription: 'Intake, vessels, fermentation, lab, and bottling.',
    both: 'Both',
    bothDescription: 'A connected block-to-bottle workspace.',
    secondTitle: 'Make insights local',
    secondDescription: 'An estate location powers relevant weather and disease-risk models. It is optional.',
    search: 'Search your estate… e.g. Telavi, Kakheti',
    locationSelected: 'Location selected',
    privateLocation: 'Used for estate intelligence inside your workspace.',
    back: 'Back',
    next: 'Continue',
    finish: 'Enter workspace',
    saving: 'Preparing workspace…',
    skip: 'Skip for now',
    close: 'Close setup',
  },
  ka: {
    setup: 'სამუშაო სივრცის გამართვა',
    step: 'ნაბიჯი',
    of: '/',
    firstTitle: 'რას მართავთ?',
    firstDescription: 'აირჩიეთ თქვენთვის საჭირო სამუშაო. მოგვიანებით შეცვლა მონაცემების დაკარგვის გარეშე შეგიძლიათ.',
    workspaceName: 'სამუშაო სივრცის სახელი',
    workspaceHint: 'მამულის ან კომპანიის სახელი, რომელსაც თქვენი გუნდი ამოიცნობს.',
    vineyard: 'ვენახი',
    vineyardDescription: 'ნაკვეთები, ამინდი, მონიტორინგი, წამლობა და რთველი.',
    cellar: 'მარანი',
    cellarDescription: 'მიღება, ჭურჭელი, დუღილი, ლაბორატორია და ჩამოსხმა.',
    both: 'ორივე',
    bothDescription: 'ერთიანი სივრცე ვენახიდან ბოთლამდე.',
    secondTitle: 'მიიღეთ ადგილობრივი ანალიზი',
    secondDescription: 'მამულის მდებარეობა ამინდისა და დაავადების რისკის მოდელებს აამუშავებს. ეს არჩევითია.',
    search: 'მოძებნეთ მამული… მაგ. თელავი, კახეთი',
    locationSelected: 'მდებარეობა არჩეულია',
    privateLocation: 'გამოიყენება მხოლოდ თქვენი სამუშაო სივრცის ანალიზისთვის.',
    back: 'უკან',
    next: 'გაგრძელება',
    finish: 'სამუშაო სივრცეში შესვლა',
    saving: 'მზადდება სამუშაო სივრცე…',
    skip: 'ახლა გამოტოვება',
    close: 'დახურვა',
  },
} as const;

type WorkspaceFocus = 'vineyard' | 'cellar' | 'both';

function focusFromModules(modules: string[] | undefined): WorkspaceFocus {
  const hasVineyard = modules?.includes('vazi') ?? true;
  const hasCellar = modules?.includes('gvino') ?? true;
  if (hasVineyard && !hasCellar) return 'vineyard';
  if (!hasVineyard && hasCellar) return 'cellar';
  return 'both';
}

function modulesForFocus(focus: WorkspaceFocus): string[] {
  if (focus === 'vineyard') return ['vazi'];
  if (focus === 'cellar') return ['gvino'];
  return ['vazi', 'gvino'];
}

function widgetsForModules(modules: string[]): string[] {
  const widgets = ['notes', 'tasks'];
  if (modules.includes('vazi')) widgets.push('weather', 'scouting');
  if (modules.includes('gvino')) widgets.push('chemistry', 'fermentation');
  return widgets;
}

export function WorkspaceSetupDialog({
  lang,
  required,
  user,
  companyProfile,
  error,
  onSubmit,
  onClose,
}: WorkspaceSetupDialogProps) {
  const copy = SETUP_COPY[lang];
  const [step, setStep] = useState(1);
  const [focus, setFocus] = useState<WorkspaceFocus>(() => focusFromModules(user.enabledModules));
  const [companyName, setCompanyName] = useState(() => companyProfile.companyName || `${user.fullName || 'My'} Estate`);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const modules = useMemo(() => modulesForFocus(focus), [focus]);
  useFocusTrap(dialogRef, { active: true, onClose: required ? undefined : onClose });

  const finish = async () => {
    const normalizedCompanyName = companyName.trim();
    if (required && !normalizedCompanyName) {
      setLocalError(lang === 'ka' ? 'შეიყვანეთ სამუშაო სივრცის სახელი.' : 'Enter a workspace name.');
      setStep(1);
      return;
    }
    setLocalError('');
    setSubmitting(true);
    try {
      const complete = await onSubmit({
        companyName: normalizedCompanyName,
        enabledModules: modules,
        enabledWidgets: widgetsForModules(modules),
        location,
      });
      if (complete) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const focusOptions: Array<{ id: WorkspaceFocus; title: string; description: string; icon: React.ReactNode }> = [
    { id: 'vineyard', title: copy.vineyard, description: copy.vineyardDescription, icon: <Sprout className="h-5 w-5" /> },
    { id: 'cellar', title: copy.cellar, description: copy.cellarDescription, icon: <Wine className="h-5 w-5" /> },
    { id: 'both', title: copy.both, description: copy.bothDescription, icon: <Grape className="h-5 w-5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-3 backdrop-blur-md sm:p-6" role="dialog" aria-modal="true" aria-labelledby="workspace-setup-title">
      <div ref={dialogRef} tabIndex={-1} className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#fbfaf8] shadow-[0_40px_100px_-35px_rgba(0,0,0,0.8)] dark:bg-stone-950">
        <div className="h-1 bg-gradient-to-r from-[#68121d] via-[#b5904b] to-emerald-700" />
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800 sm:px-8">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#7a1723] dark:text-amber-300">{copy.setup}</p>
            <p className="mt-1 text-xs font-semibold text-stone-400">{copy.step} {step} {copy.of} 2</p>
          </div>
          {!required && (
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-bold text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label={copy.close}>
              {copy.close}
            </button>
          )}
        </div>

        <div className="h-1 bg-stone-100 dark:bg-stone-900">
          <div className="h-full bg-[#7a1723] transition-[width] duration-300 dark:bg-amber-400" style={{ width: `${step * 50}%` }} />
        </div>

        <div className="overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
          {step === 1 ? (
            <div>
              <h2 id="workspace-setup-title" className="font-serif text-2xl font-black tracking-tight text-stone-950 dark:text-stone-50 sm:text-3xl">{copy.firstTitle}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500 dark:text-stone-400">{copy.firstDescription}</p>

              {required && (
                <div className="mt-6 max-w-md">
                  <label htmlFor="workspace-name" className="mb-2 block text-sm font-bold text-stone-800 dark:text-stone-100">{copy.workspaceName}</label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-stone-400" />
                    <input id="workspace-name" value={companyName} onChange={event => setCompanyName(event.target.value)} className={inputClassName} autoComplete="organization" required />
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-stone-400">{copy.workspaceHint}</p>
                </div>
              )}

              <fieldset className="mt-6">
                <legend className="sr-only">{copy.firstTitle}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {focusOptions.map(option => {
                    const selected = focus === option.id;
                    return (
                      <label key={option.id} className={`relative cursor-pointer rounded-2xl border p-4 transition focus-within:ring-4 focus-within:ring-[#7a1723]/10 ${selected ? 'border-[#7a1723] bg-[#7a1723]/5 shadow-sm dark:border-amber-400 dark:bg-amber-400/10' : 'border-stone-200 bg-white hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900'}`}>
                        <input type="radio" name="workspace-focus" value={option.id} checked={selected} onChange={() => setFocus(option.id)} className="sr-only" />
                        <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${selected ? 'bg-[#7a1723] text-white dark:bg-amber-400 dark:text-stone-950' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'}`}>{option.icon}</div>
                        <span className="block text-base font-black text-stone-900 dark:text-stone-50">{option.title}</span>
                        <span className="mt-1.5 block text-xs leading-5 text-stone-500 dark:text-stone-400">{option.description}</span>
                        {selected && <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-[#7a1723] dark:text-amber-300" aria-hidden="true" />}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          ) : (
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"><MapPin className="h-5 w-5" /></div>
              <h2 id="workspace-setup-title" className="mt-4 font-serif text-2xl font-black tracking-tight text-stone-950 dark:text-stone-50 sm:text-3xl">{copy.secondTitle}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500 dark:text-stone-400">{copy.secondDescription}</p>
              <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900 sm:p-5">
                <Suspense fallback={<div className="h-12 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800" />}>
                  <LocationPicker
                    lang={lang}
                    latitude={location?.latitude ?? companyProfile.latitude ?? 41.9056}
                    longitude={location?.longitude ?? companyProfile.longitude ?? 45.474}
                    showManual={false}
                    placeholder={copy.search}
                    onChange={setLocation}
                  />
                </Suspense>
                {location?.label && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{copy.locationSelected}: {location.label}</span>
                  </div>
                )}
                <p className="mt-3 flex items-center gap-2 text-xs leading-5 text-stone-400"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />{copy.privateLocation}</p>
              </div>
            </div>
          )}

          {(localError || error) && (
            <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">{localError || error}</div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-stone-200 bg-white px-5 py-4 dark:border-stone-800 dark:bg-stone-950 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <button type="button" onClick={() => void finish()} disabled={submitting} className="rounded-xl px-3 py-2.5 text-sm font-bold text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-stone-800 dark:hover:text-stone-100">
            {copy.skip}
          </button>
          <div className="flex gap-3">
            {step === 2 && (
              <button type="button" onClick={() => setStep(1)} disabled={submitting} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800">
                <ArrowLeft className="h-4 w-4" /> {copy.back}
              </button>
            )}
            <button
              type="button"
              onClick={() => step === 1 ? setStep(2) : void finish()}
              disabled={submitting}
              className="flex h-11 min-w-36 flex-1 items-center justify-center gap-2 rounded-xl bg-[#68121d] px-5 text-sm font-black text-white transition hover:bg-[#7d1724] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7a1723] disabled:cursor-wait disabled:opacity-65 sm:flex-none"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? copy.saving : step === 1 ? copy.next : copy.finish}
              {!submitting && step === 1 ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
