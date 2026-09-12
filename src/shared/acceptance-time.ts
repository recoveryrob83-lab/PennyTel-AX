export function localTimestamp(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number, length = 2): string => String(n).padStart(length, '0')
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

export function acceptanceISO(local: string): string {
  const date = new Date(local)
  const withSeconds = local.length === 16 ? `${local}:00` : local
  const normalized = withSeconds.includes('.') ? withSeconds.padEnd(23, '0') : `${withSeconds}.000`
  if (!Number.isFinite(date.getTime()) || localTimestamp(date.toISOString()) !== normalized)
    throw new Error(
      'This local time does not exist or is invalid. Choose another time or use the exact timestamp option.'
    )
  // During a clock rollback the same wall time names two instants. Require an explicit offset.
  for (let minutes = -180; minutes <= 180; minutes += 1) {
    if (
      minutes &&
      localTimestamp(new Date(date.getTime() + minutes * 60_000).toISOString()) === normalized
    )
      throw new Error(
        'This local time occurs twice during a timezone change. Use the exact timestamp option with an explicit offset.'
      )
  }
  return date.toISOString()
}
