import { describe, expect, it } from 'vitest'
import { displayDate, displayTimestamp, qualityLabel } from '../src/shared/presentation'

describe('human display without changing timestamp authority', () => {
  it('formats the same instant in the local zone with timezone context', () => {
    expect(displayTimestamp('2026-09-12T02:47:00Z', 'en-US', 'America/Chicago')).toMatch(
      /Sep 11, 2026.*9:47 PM CDT/
    )
    expect(displayTimestamp('2026-01-12T02:47:00Z', 'en-US', 'America/Chicago')).toMatch(
      /Jan 11, 2026.*8:47 PM CST/
    )
  })
  it('does not shift calendar-only dates and shows the numeric quality scale', () => {
    expect(displayDate('2026-09-11', 'en-US')).toBe('Sep 11, 2026')
    expect(qualityLabel(5)).toBe('5 / 5')
    expect(qualityLabel(undefined)).toBe('Ungraded')
  })
})
