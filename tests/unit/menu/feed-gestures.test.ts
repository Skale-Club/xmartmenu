import { describe, expect, it } from 'vitest'
import { AXIS_LOCK_PX, dragOffset, lockAxis, resolveSwipe, RUBBER_MAX_PX, SWIPE_PX } from '@/components/menu/feed-gestures'

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

describe('feed gestures: drag offset', () => {
  it('follows the finger between photos of the same dish', () => {
    expect(dragOffset(100, 3)).toBe(60)
    expect(dragOffset(-100, 2)).toBe(-60)
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
    expect(resolveSwipe(SWIPE_PX, 400, 3)).toBe(-1)
    // 30 px in 20 ms is a flick
    expect(resolveSwipe(-30, 20, 3)).toBe(1)
  })

  it('maps direction: drag left shows the next photo, drag right the previous', () => {
    expect(resolveSwipe(-120, 200, 2)).toBe(1)
    expect(resolveSwipe(120, 200, 2)).toBe(-1)
  })
})
