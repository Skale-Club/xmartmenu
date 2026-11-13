import { describe, expect, it } from 'vitest'
import {
  AXIS_LOCK_PX, RUBBER_MAX_PX, SWIPE_PX,
  dishAt, dragOffset, lockAxis, loops, recenter, resolveSwipe, startPosition,
} from '@/components/menu/feed-gestures'

describe('feed gestures: axis lock', () => {
  it('waits for a few pixels before deciding', () => {
    expect(lockAxis(3, 2, null)).toBeNull()
    expect(lockAxis(AXIS_LOCK_PX, 0, null)).toBe('horizontal')
    expect(lockAxis(0, -AXIS_LOCK_PX, null)).toBe('vertical')
  })

  it('leans to the dominant axis and never changes its mind mid-drag', () => {
    expect(lockAxis(30, 12, null)).toBe('horizontal')
    expect(lockAxis(12, 30, null)).toBe('vertical')
    expect(lockAxis(80, 5, 'vertical')).toBe('vertical')
    expect(lockAxis(5, 80, 'horizontal')).toBe('horizontal')
  })
})

describe('feed gestures: drag offset (photo carousel)', () => {
  it('follows the finger 1:1 between photos of the same dish', () => {
    expect(dragOffset(-100, 3, 0)).toBe(-100)
    expect(dragOffset(100, 3, 1)).toBe(100)
  })

  it('only stretches past the first or the last photo', () => {
    expect(dragOffset(100, 3, 0)).toBe(25)
    expect(dragOffset(-1000, 3, 2)).toBe(-RUBBER_MAX_PX)
  })

  it('only stretches a little on a dish with one photo', () => {
    expect(dragOffset(100, 1)).toBe(25)
    expect(dragOffset(-1000, 1)).toBe(-RUBBER_MAX_PX)
    expect(dragOffset(0, 0)).toBe(0)
  })
})

describe('feed gestures: swipe resolution', () => {
  it('never swipes a single-media dish', () => {
    expect(resolveSwipe(-300, 100, 1)).toBe(0)
    expect(resolveSwipe(300, 100, 0)).toBe(0)
  })

  it('needs enough travel or a quick flick', () => {
    expect(resolveSwipe(-20, 400, 3)).toBe(0)
    expect(resolveSwipe(-SWIPE_PX, 400, 3)).toBe(1)
    expect(resolveSwipe(SWIPE_PX, 400, 3, 1)).toBe(-1)
    // 30 px in 20 ms is a flick
    expect(resolveSwipe(-30, 20, 3)).toBe(1)
  })

  it('maps direction: drag left shows the next photo, drag right the previous', () => {
    expect(resolveSwipe(-120, 200, 2, 0)).toBe(1)
    expect(resolveSwipe(120, 200, 2, 1)).toBe(-1)
  })

  it('stops at the first and the last photo', () => {
    expect(resolveSwipe(120, 200, 3, 0)).toBe(0)
    expect(resolveSwipe(-120, 200, 3, 2)).toBe(0)
  })
})

describe('feed: endless loop of dishes', () => {
  it('loops only with two dishes or more', () => {
    expect(loops(1)).toBe(false)
    expect(loops(2)).toBe(true)
  })

  it('maps rendered positions to dishes', () => {
    expect(dishAt(0, 5)).toBe(0)
    expect(dishAt(7, 5)).toBe(2)
    expect(dishAt(14, 5)).toBe(4)
    expect(dishAt(-1, 5)).toBe(4)
  })

  it('starts on the wanted dish in the middle copy', () => {
    expect(startPosition(0, 5)).toBe(5)
    expect(startPosition(3, 5)).toBe(8)
    expect(startPosition(99, 5)).toBe(9)
    expect(startPosition(0, 1)).toBe(0)
  })

  it('jumps back to the middle copy after resting in the first or last one', () => {
    // past the last dish of the middle copy: the first dish again, in the middle
    expect(recenter(10, 5)).toBe(5)
    // before the first dish: the last dish, in the middle
    expect(recenter(4, 5)).toBe(9)
    expect(recenter(7, 5)).toBe(7)
    expect(recenter(0, 1)).toBe(0)
  })
})
