import { normalizeInternationalPhone } from './phone';

export interface RegistrationIdentity {
  firstName: string;
  lastName: string;
  fullName: string;
}

export interface RegistrationValidationError {
  code:
    | 'first_name_required'
    | 'last_name_required'
    | 'first_name_invalid'
    | 'last_name_invalid'
    | 'phone_required'
    | 'phone_invalid';
  error: string;
}

export type RegistrationIdentityResult =
  | { ok: true; value: RegistrationIdentity }
  | { ok: false; issue: RegistrationValidationError };

export type RegistrationPhoneResult =
  | { ok: true; value: string }
  | { ok: false; issue: RegistrationValidationError };

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

// Unicode letters cover Georgian and international names. Apostrophes,
// periods and hyphens are accepted inside compound names; numbers and markup
// are intentionally rejected because these details are shown to a reviewer.
const NAME_PART = /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}'’.-]*)*$/u;

function validNamePart(value: string, maxLength: number): boolean {
  return value.length <= maxLength && NAME_PART.test(value);
}

/**
 * Require a genuine first/last-name shape for every self-service account.
 * `fullName` remains a compatibility input for older clients, but it must
 * contain at least two name parts and is normalized into the same result.
 */
export function validateRegistrationIdentity(input: {
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
}): RegistrationIdentityResult {
  let firstName = clean(input.firstName);
  let lastName = clean(input.lastName);

  if (!firstName || !lastName) {
    const fullNameParts = clean(input.fullName).split(' ').filter(Boolean);
    if (!firstName) firstName = fullNameParts[0] || '';
    if (!lastName) lastName = fullNameParts.slice(1).join(' ');
  }

  if (!firstName) {
    return { ok: false, issue: { code: 'first_name_required', error: 'First name is required' } };
  }
  if (!lastName) {
    return { ok: false, issue: { code: 'last_name_required', error: 'Last name is required' } };
  }
  if (!validNamePart(firstName, 80)) {
    return { ok: false, issue: { code: 'first_name_invalid', error: 'Enter a valid first name using letters' } };
  }
  if (!validNamePart(lastName, 120)) {
    return { ok: false, issue: { code: 'last_name_invalid', error: 'Enter a valid last name using letters' } };
  }

  const normalizedFullName = `${firstName} ${lastName}`.toLowerCase();
  if (normalizedFullName === 'google user') {
    return { ok: false, issue: { code: 'first_name_invalid', error: 'Enter your real first and last name' } };
  }

  return { ok: true, value: { firstName, lastName, fullName: `${firstName} ${lastName}` } };
}

/**
 * Validate a reachable international-format phone number. This establishes a
 * plausible E.164 contact value for manual review; it does not claim ownership
 * verification, which would require an SMS or voice OTP provider.
 */
export function validateRegistrationPhone(value: unknown): RegistrationPhoneResult {
  const raw = clean(value);
  if (!raw) {
    return { ok: false, issue: { code: 'phone_required', error: 'A reachable phone number is required' } };
  }
  const normalized = normalizeInternationalPhone(raw);
  const digits = normalized?.slice(1) || '';
  if (!normalized || /^(\d)\1+$/.test(digits)) {
    return {
      ok: false,
      issue: {
        code: 'phone_invalid',
        error: 'Enter a valid phone number with country code, for example +995 555 12 34 56',
      },
    };
  }
  return { ok: true, value: normalized };
}

/** Missing details that must block a human approval decision. */
export function registrationApprovalBlockers(user: any, companyProfile?: any): string[] {
  const blockers: string[] = [];
  const identity = validateRegistrationIdentity({ fullName: user?.fullName });
  if (!identity.ok) blockers.push('First and last name');

  const phone = validateRegistrationPhone(user?.phone || companyProfile?.phone);
  if (!phone.ok) blockers.push('Reachable phone number with country code');

  if (!clean(companyProfile?.companyName)) blockers.push('Company or estate name');
  return blockers;
}
