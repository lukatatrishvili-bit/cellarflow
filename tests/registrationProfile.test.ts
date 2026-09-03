import { describe, expect, it } from 'vitest';
import {
  registrationApprovalBlockers,
  validateRegistrationIdentity,
  validateRegistrationPhone,
} from '../server/registrationProfile';

describe('required registration profile', () => {
  it('requires both first and last name for email and Google registrations', () => {
    expect(validateRegistrationIdentity({ fullName: 'Nino' })).toEqual({
      ok: false,
      issue: { code: 'last_name_required', error: 'Last name is required' },
    });
    expect(validateRegistrationIdentity({ firstName: 'ნინო', lastName: 'ხარაიშვილი' })).toEqual({
      ok: true,
      value: {
        firstName: 'ნინო',
        lastName: 'ხარაიშვილი',
        fullName: 'ნინო ხარაიშვილი',
      },
    });
  });

  it('requires a plausible international phone number', () => {
    expect(validateRegistrationPhone('')).toEqual(expect.objectContaining({
      ok: false,
      issue: expect.objectContaining({ code: 'phone_required' }),
    }));
    expect(validateRegistrationPhone('555 12 34')).toEqual(expect.objectContaining({
      ok: false,
      issue: expect.objectContaining({ code: 'phone_invalid' }),
    }));
    expect(validateRegistrationPhone('+995 555 12 34 56')).toEqual({
      ok: true,
      value: '+995555123456',
    });
    expect(validateRegistrationPhone('+999 999 99 99')).toEqual(expect.objectContaining({ ok: false }));
  });

  it('blocks approval when legacy requests are missing review details', () => {
    expect(registrationApprovalBlockers(
      { fullName: 'Google User', phone: '' },
      { companyName: '' },
    )).toEqual([
      'First and last name',
      'Reachable phone number with country code',
      'Company or estate name',
    ]);
    expect(registrationApprovalBlockers(
      { fullName: 'Nino Kharaishvili', phone: '+995555123456' },
      { companyName: 'Kharaishvili Marani' },
    )).toEqual([]);
  });
});
