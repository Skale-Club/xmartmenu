import { describe, expect, it } from 'vitest'
import { ADDONS, PLANS, PROJECTS, estimateProject, threeDCost } from '@/lib/marketing/pricing'

describe('3D dish tiers', () => {
  it('prices each tier', () => {
    expect(threeDCost(0)).toBe(0)
    expect(threeDCost(9)).toBe(351)
    expect(threeDCost(10)).toBe(349)
    expect(threeDCost(19)).toBe(663.1)
    expect(threeDCost(20)).toBe(600)
  })
})

describe('estimateProject', () => {
  it('we, 40 items, no 3D = 770', () => {
    expect(estimateProject({ mode: 'we', items: 40, threeDDishes: 0, extraLanguages: 0 }).project).toBe(770)
  })
  it('we, 20 items, 20 in 3D = 1,190', () => {
    expect(estimateProject({ mode: 'we', items: 20, threeDDishes: 20, extraLanguages: 0 }).project).toBe(1190)
  })
  it('diy, any items, 10 in 3D = 639', () => {
    expect(estimateProject({ mode: 'diy', items: 25, threeDDishes: 10, extraLanguages: 0 }).project).toBe(639)
    expect(estimateProject({ mode: 'diy', items: 80, threeDDishes: 10, extraLanguages: 0 }).project).toBe(639)
  })
  it('we, 40 items, 20 in 3D = 1,370', () => {
    expect(estimateProject({ mode: 'we', items: 40, threeDDishes: 20, extraLanguages: 0 }).project).toBe(1370)
    expect(estimateProject({ mode: 'we', items: 40, threeDDishes: 20, extraLanguages: 2 }).project).toBe(1550)
  })
  it('clamps 3D dishes to the item count and ignores bad input', () => {
    expect(estimateProject({ mode: 'we', items: 5, threeDDishes: 50, extraLanguages: 0 }).threeDCount).toBe(5)
    expect(estimateProject({ mode: 'we', items: NaN, threeDDishes: -3, extraLanguages: -1 }).project).toBe(590)
  })
  it('photo touch-ups only count in diy mode', () => {
    expect(estimateProject({ mode: 'diy', items: 30, threeDDishes: 0, extraLanguages: 0, photos: 10 }).project).toBe(340)
    expect(estimateProject({ mode: 'we', items: 20, threeDDishes: 0, extraLanguages: 0, photos: 10 }).project).toBe(590)
  })
  it('first year = project + 11 months of the plan', () => {
    const e = estimateProject({ mode: 'we', items: 20, threeDDishes: 0, extraLanguages: 0, plan: 'waiter' })
    expect(e.firstYear).toBe(590 + 179 * 11)
    expect(estimateProject({ mode: 'we', items: 20, threeDDishes: 0, extraLanguages: 0, plan: 'payments' }).paymentFeePercent).toBe(1)
  })
})

describe('price constants', () => {
  it('yearly is 10x monthly', () => {
    for (const p of Object.values(PLANS)) expect(p.yearly).toBe(p.monthly * 10)
  })
  it('launch is always below list', () => {
    expect(PROJECTS.diy.launch).toBeLessThan(PROJECTS.diy.list)
    expect(ADDONS.extraLanguage.launch).toBeLessThan(ADDONS.extraLanguage.list)
  })
})
