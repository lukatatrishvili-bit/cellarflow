import { UserProfile } from './wineryState';

/**
 * CLIENT-SIDE demo authentication gate.
 *
 * This validates credentials against a seeded account list so the app no longer
 * accepts arbitrary logins. It is intentionally simple and is NOT a substitute
 * for real server-side authentication — anyone can read this source. When the
 * Firebase cloud phase lands, replace `authenticate()` with Firebase Auth; the
 * rules in firestore.rules already assume a real `request.auth`.
 */

interface SeededAccount {
  passcode: string;
  profile: UserProfile;
}

/** Shared demo passcode, surfaced on the sign-in screen so the app is usable. */
export const DEMO_PASSCODE = 'vinea2026';

const ACCOUNTS: SeededAccount[] = [
  {
    passcode: DEMO_PASSCODE,
    profile: {
      username: 'luka_winemaker',
      email: 'luka@vinea.com',
      fullName: 'Luka Tatrishvili',
      role: 'Owner/Admin',
      language: 'en',
    },
  },
  {
    passcode: DEMO_PASSCODE,
    profile: {
      username: 'sophia_enology',
      email: 's.rossi@vinea.com',
      fullName: 'Sophia Rossi',
      role: 'Winemaker',
      language: 'en',
    },
  },
  {
    passcode: DEMO_PASSCODE,
    profile: {
      username: 'luka_viticulture',
      email: 'luka.t@vinea.com',
      fullName: 'Luka Tatrishvili',
      role: 'Viticulturist',
      language: 'en',
    },
  },
];

/**
 * Returns the matching user profile when the identifier (username or email)
 * resolves to a seeded account and the passcode matches; otherwise `null`.
 */
export function authenticate(identifier: string, passcode: string): UserProfile | null {
  const id = identifier.trim().toLowerCase();
  if (!id || !passcode) return null;

  const account = ACCOUNTS.find(
    (a) => a.profile.username.toLowerCase() === id || a.profile.email.toLowerCase() === id
  );
  if (!account || account.passcode !== passcode) return null;

  return account.profile;
}
