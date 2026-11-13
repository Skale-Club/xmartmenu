import { describe, expect, it } from 'vitest'
import { dishFeature, normalizeTags, primaryTag, sortTags, tagColor } from '@/lib/menu/dish-tags'

describe('dish tags', () => {
  it('shows the highest-ranked known tag', () => {
    expect(primaryTag(['Vegetarian', "Chef's special"])).toBe("Chef's special")
    expect(primaryTag(['Gluten-Free', 'Vegetarian'])).toBe('Vegetarian')
    expect(primaryTag(['Spicy', 'Vegan'])).toBe('Spicy')
  })

  it('prefers a known tag over free text, else the first free-text tag', () => {
    expect(primaryTag(['House favourite', 'Vegan'])).toBe('Vegan')
    expect(primaryTag(['House favourite', 'Local'])).toBe('House favourite')
  })

  it('returns null when there is nothing to show', () => {
    expect(primaryTag([])).toBeNull()
    expect(primaryTag(null)).toBeNull()
    expect(primaryTag(['  '])).toBeNull()
  })

  it('matches known tags regardless of case', () => {
    expect(primaryTag(['gluten-free', 'vegan'])).toBe('vegan')
    expect(tagColor('VEGAN')).toEqual(tagColor('Vegan'))
  })

  it('gives free-text tags the neutral colour', () => {
    expect(tagColor('House favourite')).toEqual({ background: '#f4f4f5', text: '#52525b' })
    expect(tagColor('Spicy')).not.toEqual(tagColor('House favourite'))
  })

  it('sorts known tags by priority and keeps free text after them in order', () => {
    expect(sortTags(['Local', 'Vegetarian', "Chef's special", 'Organic'])).toEqual(["Chef's special", 'Vegetarian', 'Local', 'Organic'])
  })

  it('saves at most one tag, the most important', () => {
    expect(normalizeTags(['Vegetarian', 'Gluten-Free', "Chef's special"])).toEqual(["Chef's special"])
    expect(normalizeTags([' House favourite '])).toEqual(['House favourite'])
    expect(normalizeTags([])).toEqual([])
    expect(normalizeTags(undefined)).toEqual([])
  })
})

describe('one feature per dish', () => {
  it('shows the tag, never the tag and the featured flag together', () => {
    expect(dishFeature({ tags: ['Spicy'], is_featured: true })).toBe('Spicy')
    expect(dishFeature({ tags: ['Vegan', "Chef's special"], is_featured: false })).toBe("Chef's special")
  })

  it("marks a featured dish without a tag as the chef's special", () => {
    expect(dishFeature({ tags: [], is_featured: true })).toBe("Chef's special")
    expect(dishFeature({ tags: null, is_featured: false })).toBeNull()
  })
})
