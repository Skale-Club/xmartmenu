/** Save scale and its iOS artifact together, preserving the current model on failure. */
export async function saveRealSizeArtifacts<T extends object>(options: {
  scale: number
  modelWidthCm: number
  generate: () => Promise<T | null>
  save: (patch: T & { scale: number; model_width_cm: number }) => Promise<boolean>
}): Promise<boolean> {
  const artifact = await options.generate()
  if (!artifact) throw new Error('Could not prepare the iOS file. The previous real size was kept. Try again.')
  return options.save({ ...artifact, scale: options.scale, model_width_cm: options.modelWidthCm })
}
