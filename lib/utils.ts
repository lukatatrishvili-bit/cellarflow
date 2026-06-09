import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '';
  const dateStr = typeof dateInput === 'string' ? dateInput : dateInput.toISOString();
  const datePart = dateStr.split('T')[0];
  const parts = datePart.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mIdx = parseInt(month, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      return `${months[mIdx]} ${parseInt(day, 10)}, ${year}`;
    }
  }
  return dateStr;
}

export function formatDateTime(dateInput: string | Date | undefined | null): string {
  if (!dateInput) return '';
  const dateStr = typeof dateInput === 'string' ? dateInput : dateInput.toISOString();
  const [datePart, timePart] = dateStr.split('T');
  const dFormatted = formatDate(datePart);
  if (timePart) {
    const timeClean = timePart.split('.')[0].split('Z')[0];
    const hms = timeClean.split(':');
    if (hms.length >= 2) {
      return `${dFormatted} ${hms[0]}:${hms[1]}`;
    }
  }
  return dFormatted;
}
