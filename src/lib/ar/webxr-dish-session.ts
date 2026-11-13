/**
 * Augmented reality on Android: our own WebXR viewer for a dish, in the
 * browser (three.js). Replaces <model-viewer> in the menu because a dish must
 * land where the guest points, on a real surface, at its real size:
 * <model-viewer> shows the model at once, floating in front of the camera,
 * and then only snaps its height to the first floor it finds.
 *
 *   1 scanning  the camera is on; the dish is not shown until a surface that
 *               faces up (a table) is found under the screen centre
 *   2 surface   minimal white dots cover the table area the phone actually
 *               detected (several hit-test rays, src/lib/ar/surface-finder.ts),
 *               steady and smoothed; no ring, no ghost dish. A tap places it
 *   3 placed    the dish stays on the table (an XR anchor when the phone has
 *               them); one finger drags it along the table, two fingers turn
 *               it. It is never resized: it always shows at its real size.
 *               reposition() lifts it and goes back to step 1.
 *
 * Gestures come from DOM touch events on a transparent layer of the WebXR DOM
 * overlay (the React UI around it is src/components/ar/WebXrDishViewer.tsx);
 * dragging intersects the finger's ray with the table plane, so no transient
 * hit test is needed. XR "select" events are not used.
 *
 * Load order matters: the module and the model are loaded while the dish is
 * open (preloadDish), and startDishSession calls requestSession before any
 * await, because WebXR only starts inside the guest's tap.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { angle, angleDelta, distance, isHorizontalSurface, twistYaw, type Point } from './gestures'
import { progressPercent } from './dish-sequence'
import {
  SCENE_COOLDOWN_MS, TWIST_START_RAD, grabsDish, isTap, regionAt, sceneStart, twistActive,
  type ArRegion, type ArZones, type DishOnScreen,
} from './gesture-router'
import {
  createSurfaceTracker, isTrackingLost, offsetDirections, patchRadius, sameTableExtent, smoothToward,
  type SurfaceSample, type Vec3,
} from './surface-finder'

export type DishStage = 'scanning' | 'surface' | 'placed'

export interface DishSessionOptions {
  glbUrl: string
  /** Real-size correction from the back office (1 = the file's own size). */
  modelScale?: number
  /** WebXR DOM overlay root: the React UI, shown over the camera. */
  overlay: HTMLElement
  /** Full-screen transparent element inside the overlay that receives the gestures. */
  gestureLayer: HTMLElement
  /**
   * The overlay's regions, measured when a touch starts (gesture zoning: only
   * touches that start in the scene reach the dish). Without it every touch
   * counts as the scene.
   */
  zones?: () => ArZones | null
  /** Pause after placing during which scene taps and drags are ignored (default 300 ms). */
  cooldownMs?: number
  onStage: (stage: DishStage) => void
  /** A placed dish lost its table (tracking or anchor gone for a moment), or found it again. */
  onTracking?: (lost: boolean) => void
  onEnd: () => void
  /** Cancels startup as well as an active camera session (for unmount). */
  signal?: AbortSignal
}

export interface DishSession {
  /** Lifts a placed dish and returns to finding a surface, to place it again. */
  reposition(): void
  /**
   * Shows another dish without leaving the camera: on the table at the same
   * spot when one is placed. Resolves true once it shows, false when a newer
   * swap or the end of the session replaced it.
   */
  swapDish(glbUrl: string, modelScale?: number, onProgress?: (percent: number | null) => void): Promise<boolean>
  end(): void
}

const loaded = new Map<string, Promise<THREE.Object3D>>()
const finished = new Set<string>()
const progressListeners = new Map<string, Set<(percent: number | null) => void>>()
const lastProgress = new Map<string, number | null>()

/**
 * Downloads and parses the dish once; call it when the dish sheet opens (and
 * for the dishes next to the one on screen). `onProgress` gets the download
 * percentage (null when the server does not give the size), then 100.
 */
export function preloadDish(glbUrl: string, onProgress?: (percent: number | null) => void): Promise<THREE.Object3D> {
  if (onProgress) {
    if (finished.has(glbUrl)) onProgress(100)
    else {
      const listeners = progressListeners.get(glbUrl) ?? new Set()
      listeners.add(onProgress)
      progressListeners.set(glbUrl, listeners)
      if (lastProgress.has(glbUrl)) onProgress(lastProgress.get(glbUrl) ?? null)
    }
  }
  let pending = loaded.get(glbUrl)
  if (!pending) {
    const report = (percent: number | null) => {
      lastProgress.set(glbUrl, percent)
      progressListeners.get(glbUrl)?.forEach(listener => listener(percent))
    }
    pending = new GLTFLoader().loadAsync(glbUrl, event => report(progressPercent(event.loaded, event.total))).then(gltf => gltf.scene)
    pending.then(() => {
      finished.add(glbUrl)
      report(100)
    }, () => {
      loaded.delete(glbUrl)
    }).finally(() => {
      progressListeners.delete(glbUrl)
      lastProgress.delete(glbUrl)
    })
    loaded.set(glbUrl, pending)
  }
  return pending
}

/** Whether this browser can open the camera with WebXR AR. */
export async function webXrArSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-ar')) === true
  } catch {
    return false
  }
}

/** A soft round shadow under the dish (the camera image gets no real shadow). */
function contactShadow(radius: number): THREE.Mesh {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(0,0,0,0.45)')
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.18)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false })
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2), material)
  mesh.position.y = 0.001
  mesh.renderOrder = -1
  return mesh
}

/** Dot patch: a grid of tiny flat dots; only those within the detected radius show. */
const DOT_SPACING = 0.016
const DOT_GRID = 11
const DOT_SIZE = 0.0032
const DOT_OPACITY = 0.85

function dotPatch() {
  const geometry = new THREE.CircleGeometry(DOT_SIZE, 10).rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
  const mesh = new THREE.InstancedMesh(geometry, material, DOT_GRID * DOT_GRID)
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  const offsets: [number, number][] = []
  const half = (DOT_GRID - 1) / 2
  for (let row = 0; row < DOT_GRID; row++) {
    for (let col = 0; col < DOT_GRID; col++) offsets.push([(col - half) * DOT_SPACING, (row - half) * DOT_SPACING])
  }
  let radius = -1
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const size = new THREE.Vector3()
  /** Shows the dots within `next` metres of the centre, shrinking towards the edge. */
  const layout = (next: number) => {
    if (Math.abs(next - radius) < 0.002) return
    radius = next
    offsets.forEach(([x, z], index) => {
      const d = Math.hypot(x, z)
      const scale = d <= radius ? 1 - 0.45 * (d / radius) ** 2 : 0
      matrix.compose(position.set(x, 0, z), rotation, size.setScalar(scale))
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }
  return { mesh, geometry, material, layout }
}

/**
 * Opens the camera and runs the viewer. Must be called inside the tap, after
 * preloadDish(glbUrl) has resolved (the session starts before any await).
 */
export async function startDishSession(options: DishSessionOptions): Promise<DishSession> {
  const xr = navigator.xr
  if (!xr) throw new Error('WebXR unavailable')
  // First statement that matters: WebXR needs the tap's user activation.
  const sessionPromise = xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay', 'anchors'],
    domOverlay: { root: options.overlay },
  })
  let ended = false
  let activeSession: XRSession | null = null
  let releaseResources = () => {}
  let endRequested = false
  const endSession = () => {
    if (!activeSession || endRequested) return
    endRequested = true
    activeSession.end().catch(() => {})
  }
  const cleanup = () => {
    if (ended) return
    ended = true
    rejectAbort(new DOMException('AR session ended', 'AbortError'))
    options.signal?.removeEventListener('abort', abort)
    activeSession?.removeEventListener('end', cleanup)
    releaseResources()
    options.onEnd()
  }
  let rejectAbort: (reason: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = () => {
    cleanup()
    endSession()
    rejectAbort(new DOMException('AR session cancelled', 'AbortError'))
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  const acquired = sessionPromise.then(session => {
    activeSession = session
    if (ended) endSession()
    else session.addEventListener('end', cleanup)
    return session
  })
  if (options.signal?.aborted) abort()
  const ensureActive = () => {
    if (ended) throw new DOMException('AR session ended', 'AbortError')
  }
  try {
    const [source, session] = await Promise.race([
      Promise.all([preloadDish(options.glbUrl), acquired]), aborted,
    ])
    ensureActive()

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: false })
    releaseResources = () => renderer.dispose()
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local')

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(0.5, 1, 0.4)
    scene.add(sun)

    // The dish: its bottom centre at the group's origin, at real size × the
    // back office's correction; the group carries position and turn (never a resize).
    // A dish ready for the group: real size × correction, bottom centre at the origin.
    const prepare = (from: THREE.Object3D, correction: number | undefined) => {
      const copy = from.clone(true)
      copy.scale.multiplyScalar(correction && correction > 0 ? correction : 1)
      copy.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(copy)
      const middle = bounds.getCenter(new THREE.Vector3())
      copy.position.sub(new THREE.Vector3(middle.x, bounds.min.y, middle.z))
      return { model: copy, footprint: Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) }
    }
    let { model, footprint } = prepare(source, options.modelScale)
    const dish = new THREE.Group()
    dish.add(model)
    let shadow = contactShadow(Math.max(0.04, footprint * 0.55))
    dish.add(shadow)
    dish.visible = false
    scene.add(dish)

    const patch = dotPatch()
    patch.layout(patchRadius(0))
    scene.add(patch.mesh)

    let stage: DishStage = 'scanning'
    let yaw = 0
    let lastSurface: THREE.Matrix4 | null = null
    let anchor: XRAnchor | null = null
    let pendingAnchorAtDish = false
    let anchorGeneration = 0
    // eslint-disable-next-line prefer-const -- cleanup can run before asynchronous source assignment
    let hitSource: XRHitTestSource | undefined
    // Extra rays around the centre, to measure how much of the table was detected.
    const extraSources: XRHitTestSource[] = []
    const tracker = createSurfaceTracker()
    let smoothed: Vec3 | null = null
    let patchOpacity = 0
    let lastFrameTime: number | null = null
    let anchorSeenAt: number | null = null
    let trackingLost = false
    const setTracking = (lost: boolean) => {
      if (lost === trackingLost) return
      trackingLost = lost
      options.onTracking?.(lost)
    }
    const clearAnchor = () => {
      anchorGeneration++
      pendingAnchorAtDish = false
      anchor?.delete()
      anchor = null
      anchorSeenAt = null
    }
    releaseResources = () => {
      renderer.setAnimationLoop(null)
      hitSource?.cancel()
      for (const source of extraSources.splice(0)) source.cancel()
      clearAnchor()
      patch.geometry.dispose()
      patch.material.dispose()
      patch.mesh.dispose()
      shadow.geometry.dispose()
      ;(shadow.material as THREE.MeshBasicMaterial).map?.dispose()
      ;(shadow.material as THREE.Material).dispose()
      renderer.dispose()
    }

    const setStage = (next: DishStage) => {
      if (stage === next) return
      stage = next
      options.onStage(next)
    }
    options.onStage(stage)

    await Promise.race([renderer.xr.setSession(session), aborted])
    const refSpace = renderer.xr.getReferenceSpace()
    ensureActive()
    const viewerSpace = await Promise.race([session.requestReferenceSpace('viewer'), aborted])
    ensureActive()
    const hitSourcePromise = session.requestHitTestSource?.({ space: viewerSpace })?.then(source => {
      if (ended) source.cancel()
      return source
    })
    hitSource = await Promise.race([hitSourcePromise, aborted])
    ensureActive()
    // Extra rays (offsetRay) where the browser supports them; the centre ray alone still works.
    if (typeof XRRay !== 'undefined') {
      for (const direction of offsetDirections()) {
        session.requestHitTestSource?.({
          space: viewerSpace,
          offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: direction.x, y: direction.y, z: direction.z, w: 0 }),
        })?.then(source => {
          if (ended) source.cancel()
          else extraSources.push(source)
        }).catch(() => {})
      }
    }

    // ── placing and anchoring ────────────────────────────────────────────────
    const facingCamera = (position: THREE.Vector3) => {
      const eye = renderer.xr.getCamera().position
      return Math.atan2(eye.x - position.x, eye.z - position.z)
    }
    // A dish swap in progress: placing waits until the new dish is ready.
    let swapping = false
    let swapGeneration = 0
    const place = () => {
      if (stage !== 'surface' || !lastSurface || swapping) return
      // Land where the dots are (the smoothed table point), at the table's height.
      if (smoothed) dish.position.set(smoothed.x, smoothed.y, smoothed.z)
      else dish.position.setFromMatrixPosition(lastSurface)
      yaw = facingCamera(dish.position)
      dish.rotation.set(0, yaw, 0)
      dish.visible = true
      clearAnchor()
      pendingAnchorAtDish = true
      settledAt = performance.now()
      setStage('placed')
    }

    // ── gestures (DOM touch events on the overlay layer) ─────────────────────
    const raycaster = new THREE.Raycaster()
    const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hitPoint = new THREE.Vector3()
    const touchPoint = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY })
    const onTable = (point: Point): THREE.Vector3 | null => {
      const xrCamera = renderer.xr.getCamera()
      const view = xrCamera.cameras[0] ?? xrCamera
      const ndc = new THREE.Vector2((point.x / window.innerWidth) * 2 - 1, -(point.y / window.innerHeight) * 2 + 1)
      raycaster.setFromCamera(ndc, view)
      tablePlane.constant = -dish.position.y
      return raycaster.ray.intersectPlane(tablePlane, hitPoint) ? hitPoint.clone() : null
    }

    // The dish's outline on screen, to know whether a drag starts on it.
    const dishOnScreen = (): DishOnScreen | null => {
      if (!dish.visible) return null
      const xrCamera = renderer.xr.getCamera()
      const view = xrCamera.cameras[0] ?? xrCamera
      const toScreen = (v: THREE.Vector3) => {
        const ndc = v.clone().project(view)
        return { x: (ndc.x + 1) / 2 * window.innerWidth, y: (1 - ndc.y) / 2 * window.innerHeight }
      }
      const centre = toScreen(dish.position)
      const half = footprint / 2
      const edges = [new THREE.Vector3(half, 0, 0), new THREE.Vector3(0, 0, half)]
        .map(offset => toScreen(dish.position.clone().add(offset)))
      const radius = Math.max(30, ...edges.map(edge => Math.hypot(edge.x - centre.x, edge.y - centre.y)))
      return { x: centre.x, y: centre.y, radius }
    }

    const cooldownMs = options.cooldownMs ?? SCENE_COOLDOWN_MS
    let settledAt = -Infinity
    // The region where the first finger landed owns the gesture until every finger lifts.
    let owner: ArRegion | null = null
    let tapStart: { point: Point; time: number } | null = null
    let drag: { offset: THREE.Vector3 } | null = null
    let twoFinger: { angle: number; yaw: number; active: boolean; sign: number } | null = null

    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault()
      const touches = event.touches
      if (touches.length === 1) {
        const point = touchPoint(touches[0])
        const zones = options.zones?.() ?? null
        owner = zones ? regionAt(point, zones) : 'scene'
        tapStart = null
        drag = null
        if (owner !== 'scene') return
        const start = sceneStart({
          stage, fingers: 1, onDish: stage === 'placed' && grabsDish(point, dishOnScreen()),
          sinceSettled: performance.now() - settledAt, cooldownMs,
        })
        if (start === 'tap-candidate') tapStart = { point, time: performance.now() }
        if (start === 'drag-dish') {
          clearAnchor()
          const at = onTable(point)
          drag = at ? { offset: dish.position.clone().sub(at) } : null
        }
      } else if (touches.length >= 2) {
        // Both fingers landed together: the first one decides the region.
        if (owner === null) {
          const zones = options.zones?.() ?? null
          owner = zones ? regionAt(touchPoint(touches[0]), zones) : 'scene'
        }
        if (owner !== 'scene' || stage !== 'placed') return
        tapStart = null
        drag = null
        const a = touchPoint(touches[0]), b = touchPoint(touches[1])
        twoFinger = { angle: angle(a, b), yaw, active: false, sign: 1 }
      }
    }
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      const touches = event.touches
      if (twoFinger && touches.length >= 2) {
        const a = touchPoint(touches[0]), b = touchPoint(touches[1])
        const current = angle(a, b)
        const delta = angleDelta(twoFinger.angle, current)
        if (!twoFinger.active && twistActive(delta)) {
          twoFinger.active = true
          twoFinger.sign = Math.sign(delta) || 1
        }
        if (twoFinger.active) {
          // Rotate by the turn beyond the start angle, so the dish does not jump.
          yaw = twistYaw(twoFinger.yaw, twoFinger.angle + twoFinger.sign * TWIST_START_RAD, current)
          dish.rotation.set(0, yaw, 0)
        }
        return
      }
      if (drag && touches.length === 1) {
        const at = onTable(touchPoint(touches[0]))
        if (at) {
          clearAnchor()
          dish.position.set(at.x + drag.offset.x, dish.position.y, at.z + drag.offset.z)
        }
      }
    }
    const onTouchEnd = (event: TouchEvent) => {
      event.preventDefault()
      if (tapStart && event.touches.length === 0) {
        const end = event.changedTouches[0]
        const moved = end ? distance(tapStart.point, touchPoint(end)) : 0
        if (isTap(moved, performance.now() - tapStart.time)) place()
      }
      if (event.touches.length < 2) twoFinger = null
      if (event.touches.length === 0) {
        if (drag) reanchorAtDish()
        drag = null
        tapStart = null
        owner = null
      }
    }
    // After a drag, anchor again where the dish now is (no hit result to anchor from: use the frame).
    const reanchorAtDish = () => { pendingAnchorAtDish = true }

    const layer = options.gestureLayer
    layer.addEventListener('touchstart', onTouchStart, { passive: false })
    layer.addEventListener('touchmove', onTouchMove, { passive: false })
    layer.addEventListener('touchend', onTouchEnd, { passive: false })
    layer.addEventListener('touchcancel', onTouchEnd, { passive: false })
    // Taps on the overlay never become XR selects (they would reach the scene).
    const blockSelect = (event: Event) => event.preventDefault()
    options.overlay.addEventListener('beforexrselect', blockSelect)

    // ── frame loop ───────────────────────────────────────────────────────────
    const surface = new THREE.Matrix4()
    const sampleOf = (source: XRHitTestSource, frame: XRFrame, matrix: THREE.Matrix4): SurfaceSample | null => {
      const pose = refSpace ? frame.getHitTestResults(source)[0]?.getPose(refSpace) : undefined
      if (!pose) return null
      matrix.fromArray(pose.transform.matrix)
      return { x: matrix.elements[12], y: matrix.elements[13], z: matrix.elements[14], up: matrix.elements[5] }
    }
    const scratch = new THREE.Matrix4()
    renderer.setAnimationLoop((time, frame) => {
      if (!frame || !refSpace) return
      const dt = lastFrameTime === null ? 16 : Math.min(100, Math.max(0, time - lastFrameTime))
      lastFrameTime = time
      if (stage !== 'placed' && hitSource) {
        const center = sampleOf(hitSource, frame, surface)
        // Only a surface that faces up (a table or floor, not a wall) counts.
        const table = center && isHorizontalSurface(center.up) ? center : null
        const found = tracker.update(table !== null, time)
        if (table) {
          lastSurface = surface.clone()
          smoothed = smoothToward(smoothed, table)
          patch.layout(patchRadius(sameTableExtent(table, extraSources.map(source => sampleOf(source, frame, scratch)))))
        }
        if (found && smoothed) {
          patch.mesh.position.set(smoothed.x, smoothed.y + 0.001, smoothed.z)
          setStage('surface')
        } else if (!found && stage === 'surface') {
          lastSurface = null
          smoothed = null
          setStage('scanning')
        }
      }
      // The dots fade in on a steady table and out when it goes or the dish lands.
      const targetOpacity = stage === 'surface' ? DOT_OPACITY : 0
      patchOpacity += (targetOpacity - patchOpacity) * Math.min(1, dt / 120)
      patch.material.opacity = patchOpacity
      patch.mesh.visible = patchOpacity > 0.01
      if (anchor) {
        const anchorPose = frame.getPose(anchor.anchorSpace, refSpace)
        if (anchorPose) {
          anchorSeenAt = time
          dish.position.set(anchorPose.transform.position.x, anchorPose.transform.position.y, anchorPose.transform.position.z)
        }
      } else if (pendingAnchorAtDish && stage === 'placed') {
        pendingAnchorAtDish = false
        const { x, y, z } = dish.position
        const generation = anchorGeneration
        frame.createAnchor?.(new XRRigidTransform({ x, y, z }), refSpace)?.then(created => {
          if (ended || generation !== anchorGeneration) created.delete()
          else { anchor = created; anchorSeenAt = lastFrameTime }
        }).catch(() => {})
      }
      if (stage === 'placed') {
        // Lost: the phone reports no real position, or the anchor has not been seen for a moment.
        const canReadViewer = 'getViewerPose' in frame
        const viewer = canReadViewer ? frame.getViewerPose(refSpace) : undefined
        const viewerLost = canReadViewer && (!viewer || viewer.emulatedPosition === true)
        setTracking(viewerLost || (anchor !== null && isTrackingLost(anchorSeenAt, time)))
      }
      renderer.render(scene, camera)
    })

    const releaseScene = releaseResources
    releaseResources = () => {
      layer.removeEventListener('touchstart', onTouchStart)
      layer.removeEventListener('touchmove', onTouchMove)
      layer.removeEventListener('touchend', onTouchEnd)
      layer.removeEventListener('touchcancel', onTouchEnd)
      options.overlay.removeEventListener('beforexrselect', blockSelect)
      releaseScene()
    }

    return {
      async swapDish(glbUrl, modelScale, onProgress) {
        const generation = ++swapGeneration
        swapping = true
        try {
          const next = await preloadDish(glbUrl, onProgress)
          if (ended || generation !== swapGeneration) return false
          const prepared = prepare(next, modelScale)
          dish.remove(model)
          model = prepared.model
          footprint = prepared.footprint
          dish.add(model)
          dish.remove(shadow)
          shadow.geometry.dispose()
          ;(shadow.material as THREE.MeshBasicMaterial).map?.dispose()
          ;(shadow.material as THREE.Material).dispose()
          shadow = contactShadow(Math.max(0.04, footprint * 0.55))
          dish.add(shadow)
          settledAt = performance.now()
          return true
        } finally {
          if (generation === swapGeneration) swapping = false
        }
      },
      reposition() {
        if (stage !== 'placed') return
        clearAnchor()
        tracker.reset()
        smoothed = null
        setTracking(false)
        drag = null
        twoFinger = null
        tapStart = null
        dish.visible = false
        lastSurface = null
        // The frame loop runs the hit test again whenever the stage is not 'placed'.
        setStage('scanning')
      },
      end() {
        cleanup()
        endSession()
      },
    }
  } catch (error) {
    cleanup()
    endSession()
    throw error
  }
}
