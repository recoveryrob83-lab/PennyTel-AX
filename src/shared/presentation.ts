// Display only: persistence and analysis exports keep original machine-readable timestamps.
export function displayTimestamp(value: string, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {})
  }).format(new Date(value))
}
export function displayDate(value: string, locale?: string): string {
  // Calendar dates have no local timezone; avoid moving them to the previous day.
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T00:00:00Z`))
}
export const qualityLabel = (grade: number | undefined): string =>
  grade === undefined ? 'Ungraded' : `${grade} / 5`
export const burnLabel = (value: number | null): string =>
  value === null ? 'Unknown' : `${Number(value.toFixed(4))} pp`
