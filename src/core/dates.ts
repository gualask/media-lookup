// Calendar dates travel as `YYYY-MM-DD` keys: they compare as strings and match TMDB's dates.

/** Later than any real date, to leave a date range open-ended. */
export const LAST_DATE_KEY = '9999-12-31';

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar day of `date` in `timeZone`. */
export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const match = DATE_KEY.exec(dateKey);
  const [, year, month, day] = match ?? [];

  if (!year || !month || !day) {
    return dateKey;
  }

  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return shifted.toISOString().slice(0, 10);
}

export function addYearsToDateKey(dateKey: string, years: number): string {
  const year = Number(dateKey.slice(0, 4));

  return Number.isInteger(year) ? `${year + years}${dateKey.slice(4)}` : dateKey;
}

/** False for anything that is not a full date key, such as TMDB's empty dates. */
export function isDateKeyInRange(dateKey: string, startDate: string, endDate: string): boolean {
  return DATE_KEY.test(dateKey) && dateKey >= startDate && dateKey <= endDate;
}

/** The year at the start of a TMDB date such as `2024-02-27`. */
export function yearOfDate(date: string | undefined): number | undefined {
  const match = /^(\d{4})/.exec(date ?? '');
  return match ? Number(match[1]) : undefined;
}
