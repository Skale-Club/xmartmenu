/**
 * Augmented reality: makes the iOS file (USDZ, for AR Quick Look) from a dish's
 * GLB, in the browser. The back office runs it right after a GLB upload, so
 * every dish opens on an iPhone without the restaurant making a second file;
 * the public menu runs it only for an old model that has no USDZ yet.
 *
 * three.js (GLTFLoader + USDZExporter) is imported on demand: it is heavy and
 * only needed here. The exporter writes only MeshStandardMaterial, so unlit
 * materials (photogrammetry scans) are turned into matte standard ones, and
 * meshes without normals get them computed (Quick Look lights the dish).
 * Units stay metres, so the dish keeps its real size on the table.
 */

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'

/**
 * Largest texture side written to the USDZ. The exporter stores textures as
 * PNG and geometry as text, uncompressed (USDZ is a stored zip), so 2048 px
 * makes a photographed dish ~14 MB; 1024 keeps it a few MB and still looks
 * sharp at plate size.
 */
export const USDZ_MAX_TEXTURE_SIZE = 1024

export async function glbToUsdz(glb: ArrayBuffer): Promise<Uint8Array> {
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js')

  const loader = new GLTFLoader()
  const draco = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH)
  loader.setDRACOLoader(draco)
  try {
    const gltf = await loader.parseAsync(glb, '')
    const scene = gltf.scene
    scene.updateMatrixWorld(true)

    scene.traverse(object => {
      const mesh = object as InstanceType<typeof THREE.Mesh>
      if (!mesh.isMesh) return
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals()
      const toStandard = (material: InstanceType<typeof THREE.Material>) => {
        if ((material as InstanceType<typeof THREE.MeshStandardMaterial>).isMeshStandardMaterial) return material
        const source = material as InstanceType<typeof THREE.MeshBasicMaterial>
        const standard = new THREE.MeshStandardMaterial({
          name: source.name,
          map: source.map ?? null,
          color: source.color ?? new THREE.Color(0xffffff),
          opacity: source.opacity,
          transparent: source.transparent,
          alphaTest: source.alphaTest,
          side: source.side,
          roughness: 1,
          metalness: 0,
        })
        material.dispose()
        return standard
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toStandard) : toStandard(mesh.material)
    })

    const exporter = new USDZExporter()
    const result = await exporter.parseAsync(scene, {
      quickLookCompatible: true,
      maxTextureSize: USDZ_MAX_TEXTURE_SIZE,
      ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
    })
    return new Uint8Array(result)
  } finally {
    draco.dispose()
  }
}
