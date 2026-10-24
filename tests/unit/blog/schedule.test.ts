// tests/unit/blog/schedule.test.ts
// Auto-blog parity XM-10. Ported with lib/blog/schedule.ts from Xkedule and kept
// equivalent on purpose: the module is shared, so two products answering "when
// is the next post?" differently would be the bug.
import { describe, it, expect } from 'vitest'

import { isRunDue, nextScheduledRun, scheduledHours, zonedHourAndDay } from '@/lib/blog/schedule'

describe('scheduledHours', () => {
  it('returns nothing without an anchor hour — the drifting cadence still governs', () => {
    expect(scheduledHours(null, 1)).toEqual([])
    expect(scheduledHours(undefined, 2)).toEqual([])
  })

  it('spreads postsPerDay evenly from the anchor', () => {
    expect(scheduledHours(9, 1)).toEqual([9])
    expect(scheduledHours(9, 2)).toEqual([9, 21])
    expect(scheduledHours(9, 4)).toEqual([3, 9, 15, 21])
  })

  it('wraps past midnight rather than falling off the day', () => {
    expect(scheduledHours(22, 2)).toEqual([10, 22])
  })

  it('collapses a rounded collision so a slot never doubles up', () => {
    const hours = scheduledHours(0, 5)
    expect(new Set(hours).size).toBe(hours.length)
  })

  it('rejects out-of-range or zero-frequency configuration', () => {
    expect(scheduledHours(24, 1)).toEqual([])
    expect(scheduledHours(-1, 1)).toEqual([])
    expect(scheduledHours(9, 0)).toEqual([])
  })
})

describe('zonedHourAndDay', () => {
  it('reads the wall clock in the given timezone, not UTC', () => {
    // 2026-06-15T23:30Z is still the 15th in New York, five hours earlier.
    const at = new Date('2026-06-15T23:30:00Z')
    expect(zonedHourAndDay(at, 'America/New_York')).toEqual({ hour: 19, day: '2026-06-15' })
    expect(zonedHourAndDay(at, 'UTC')).toEqual({ hour: 23, day: '2026-06-15' })
  })

  it('falls back to UTC on an unusable timezone instead of throwing', () => {
    const at = new Date('2026-06-15T23:30:00Z')
    expect(zonedHourAndDay(at, 'Not/AZone')).toEqual({ hour: 23, day: '2026-06-15' })
  })
})

describe('isRunDue', () => {
  const base = { timeZone: 'UTC', postingHour: 9, postsPerDay: 1 }

  it('is due inside the scheduled hour', () => {
    expect(isRunDue({ ...base, now: new Date('2026-06-15T09:10:00Z'), lastRunAt: null }).due).toBe(true)
  })

  it('is not due outside it', () => {
    expect(isRunDue({ ...base, now: new Date('2026-06-15T10:10:00Z'), lastRunAt: null }).due).toBe(false)
  })

  it('does not fire twice in the same slot', () => {
    // Comparing the hour SLOT, not elapsed time, is what makes this idempotent
    // against a cron that fires twice in an hour, without reintroducing drift.
    const decision = isRunDue({
      ...base,
      now: new Date('2026-06-15T09:50:00Z'),
      lastRunAt: new Date('2026-06-15T09:05:00Z'),
    })
    expect(decision.due).toBe(false)
    expect(decision.reason).toBe('already_ran_this_hour')
  })

  it('fires again in the same slot the NEXT day', () => {
    expect(
      isRunDue({
        ...base,
        now: new Date('2026-06-16T09:05:00Z'),
        lastRunAt: new Date('2026-06-15T09:05:00Z'),
      }).due,
    ).toBe(true)
  })

  it('is never due without an anchor hour', () => {
    expect(isRunDue({ ...base, postingHour: null, now: new Date(), lastRunAt: null }).due).toBe(false)
  })
})

describe('nextScheduledRun', () => {
  it('returns null when no hour is pinned — the drifting cadence has no answer', () => {
    expect(
      nextScheduledRun({ now: new Date(), timeZone: 'UTC', postingHour: null, postsPerDay: 1 }),
    ).toBeNull()
  })

  it('finds the next slot, not the current one', () => {
    const next = nextScheduledRun({
      now: new Date('2026-06-15T09:30:00Z'),
      timeZone: 'UTC',
      postingHour: 9,
      postsPerDay: 1,
    })
    expect(next?.toISOString()).toBe('2026-06-16T09:00:00.000Z')
  })
})
