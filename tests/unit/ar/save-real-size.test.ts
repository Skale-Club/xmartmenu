import { describe, expect, it, vi } from 'vitest'
import { saveRealSizeArtifacts } from '@/lib/ar/save-real-size'

describe('atomic real-size artifact save', () => {
  it('keeps the previous scale and iOS file when generation or upload fails', async () => {
    const save = vi.fn()
    await expect(saveRealSizeArtifacts({ scale: 0.3, modelWidthCm: 100, generate: async () => null, save }))
      .rejects.toThrow(/previous real size was kept/)
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps the previous record when conversion throws', async () => {
    const save = vi.fn()
    await expect(saveRealSizeArtifacts({ scale: 0.3, modelWidthCm: 100,
      generate: async () => { throw new Error('conversion failed') }, save })).rejects.toThrow('conversion failed')
    expect(save).not.toHaveBeenCalled()
  })
  it('saves corrected scale and matching iOS fields in one update', async () => {
    const artifact = { usdz_url: 'https://images.example/new.usdz', usdz_storage_path: 'tenant/ar/new.usdz', usdz_bytes: 1000 }
    const save = vi.fn().mockResolvedValue(true)
    expect(await saveRealSizeArtifacts({ scale: 0.3, modelWidthCm: 100, generate: async () => artifact, save })).toBe(true)
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...artifact, scale: 0.3, model_width_cm: 100 })
  })
})
