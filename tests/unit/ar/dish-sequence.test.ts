import { describe, expect, it } from 'vitest'
import { mayPreload, neighbours, progressPercent, stepDish } from '@/lib/ar/dish-sequence'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('dish sequence', () => {
  it('steps to the previous and next dish without wrapping around', () => {
    expect(stepDish(items, 'b', 'next')?.id).toBe('c')
    expect(stepDish(items, 'b', 'prev')?.id).toBe('a')
    expect(stepDish(items, 'c', 'next')).toBeNull()
    expect(stepDish(items, 'a', 'prev')).toBeNull()
    expect(stepDish(items, 'zz', 'next')).toBeNull()
  })

  it('preloads only the dishes next to the one on screen', () => {
    expect(neighbours(items, 'b').map(item => item.id)).toEqual(['a', 'c'])
    expect(neighbours(items, 'a').map(item => item.id)).toEqual(['b'])
    expect(neighbours([{ id: 'a' }], 'a')).toEqual([])
  })

  it('reports download progress, or null when the size is unknown', () => {
    expect(progressPercent(50, 200)).toBe(25)
    expect(progressPercent(300, 200)).toBe(100)
    expect(progressPercent(10, 0)).toBeNull()
    expect(progressPercent(10, Number.NaN)).toBeNull()
  })

  it('skips preloading when the browser is in data-saving mode', () => {
    expect(mayPreload(undefined)).toBe(true)
    expect(mayPreload({ saveData: false })).toBe(true)
    expect(mayPreload({ saveData: true })).toBe(false)
  })
})
