import React, { useEffect, useRef, useState } from 'react';

interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (isoDate: string) => void;
  lang?: string;
}

function isoToDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function displayToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function maskDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Controlled ISO date field displayed and entered explicitly as day/month/year. */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput({
  value,
  onValueChange,
  lang = 'en',
  required,
  className,
  onBlur,
  min,
  max,
  ...props
}, forwardedRef) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => isoToDisplay(value));
  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  useEffect(() => {
    setDraft(isoToDisplay(value));
  }, [value]);

  const validate = (nextDraft: string) => {
    const iso = displayToIso(nextDraft);
    const outsideRange = Boolean(iso && ((min && iso < String(min)) || (max && iso > String(max))));
    const invalid = nextDraft.length > 0 && (!iso || outsideRange);
    inputRef.current?.setCustomValidity(invalid
      ? (outsideRange
          ? (lang === 'ka' ? 'თარიღი დასაშვებ დიაპაზონს სცდება.' : 'Date is outside the allowed range.')
          : (lang === 'ka' ? 'შეიყვანეთ თარიღი ფორმატით დღე/თვე/წელი.' : 'Enter a valid date as day/month/year.'))
      : '');
    return outsideRange ? null : iso;
  };

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      required={required}
      placeholder={lang === 'ka' ? 'დღე/თვე/წელი' : 'DD/MM/YYYY'}
      aria-label={props['aria-label'] || (lang === 'ka' ? 'თარიღი: დღე, თვე, წელი' : 'Date: day, month, year')}
      className={className}
      onChange={(event) => {
        const nextDraft = maskDate(event.target.value);
        setDraft(nextDraft);
        if (!nextDraft) {
          inputRef.current?.setCustomValidity(required ? (lang === 'ka' ? 'თარიღი სავალდებულოა.' : 'Date is required.') : '');
          onValueChange('');
          return;
        }
        const iso = validate(nextDraft);
        if (iso) onValueChange(iso);
      }}
      onBlur={(event) => {
        const iso = validate(draft);
        if (iso) setDraft(isoToDisplay(iso));
        else if (!draft || !required) setDraft(isoToDisplay(value));
        onBlur?.(event);
      }}
    />
  );
});

DateInput.displayName = 'DateInput';

export default DateInput;
