/**
 * Augmented reality on Android: our own WebXR viewer for a dish, in the
 * browser (three.js). Replaces <model-viewer> in the menu because a dish must
 * land where the guest points, on a real surface, at its real size:
 * <model-viewer> shows the model at once, floating in front of the camera,
 * and then only snaps its height to the first floor it finds.
 *
 *   1 scanning  the camera is on; the dish is not shown until a surface that
 *               faces up (a table) is found under the screen centre
 *   2 surface   a ring sits on the table with a faint "ghost" of the dish at
 *               its real size; a tap places it there
 *   3 placed    the dish stays on the table (an XR anchor when the phone has
 *               them); one finger drags it along the table, two fingers turn
 *               and resize it (50–300 %, snapping to real size)
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
import { angle, distance, isHorizontalSurface, pinchScale, twistYaw, type Point } from './gestures'

export type DishStage = 'scanning' | 'surface' | 'placed'

export interface DishSessionOptions {
  glbUrl: string
  /** Real-size correction from the back office (1 = the file's own size). */
  modelScale?: number
  /** WebXR DOM overlay root: the React UI, shown over the camera. */
  overlay: HTMLElement
  /** Full-screen transparent element inside the overlay that receives the gestures. */
  gestureLayer: HTMLElement
  onStage: (stage: DishStage) => void
  /** The guest's resize, 1 = real size. */
  onScale: (scale: number) => void
  onEnd: () => void
  /** Cancels startup as well as an active camera session (for unmount). */
  signal?: AbortSignal
}

export interface DishSession {
  /** Animates the dish back to its real size. */
  resetScale(): void
  end(): void
}

const loaded = new Map<string, Promise<THREE.Object3D>>()

/** Downloads and parses the dish once; call it when the dish sheet opens. */
export function preloadDish(glbUrl: string): Promise<THREE.Object3D> {
  let pending = loaded.get(glbUrl)
  if (!pending) {
    pending = new GLTFLoader().loadAsync(glbUrl).then(gltf => gltf.scene)
    pending.catch(() => loaded.delete(glbUrl))
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

/** The ring that shows where the dish will go. */
function reticle(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.085, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  )
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  return mesh
}

/** A copy of the dish drawn see-through, to preview its footprint before placing. */
function ghostOf(model: THREE.Object3D): THREE.Object3D {
  const ghost = model.clone(true)
  ghost.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
      const copy = material.clone()
      copy.transparent = true
      copy.opacity = 0.4
      copy.depthWrite = false
      return copy
    })
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
  })
  return ghost
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
    // back office's correction; the group carries position, turn and the guest's resize.
    const model = source.clone(true)
    const modelScale = options.modelScale && options.modelScale > 0 ? options.modelScale : 1
    model.scale.multiplyScalar(modelScale)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z))
    const footprint = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
    const dish = new THREE.Group()
    dish.add(model)
    const shadow = contactShadow(Math.max(0.04, footprint * 0.55))
    dish.add(shadow)
    dish.visible = false
    scene.add(dish)

    const ghost = new THREE.Group()
    ghost.add(ghostOf(model))
    ghost.visible = false
    scene.add(ghost)

    const ring = reticle()
    scene.add(ring)

    let stage: DishStage = 'scanning'
    let userScale = 1
    let yaw = 0
    let scaleAnimation: { from: number; started: number } | null = null
    let lastSurface: THREE.Matrix4 | null = null
    let anchor: XRAnchor | null = null
    let pendingAnchorAtDish = false
    let anchorGeneration = 0
    // eslint-disable-next-line prefer-const -- cleanup can run before asynchronous source assignment
    let hitSource: XRHitTestSource | undefined
    const clearAnchor = () => {
      anchorGeneration++
      pendingAnchorAtDish = false
      anchor?.delete()
      anchor = null
    }
    releaseResources = () => {
      renderer.setAnimationLoop(null)
      hitSource?.cancel()
      clearAnchor()
      ring.geometry.dispose()
      ;(ring.material as THREE.Material).dispose()
      shadow.geometry.dispose()
      ;(shadow.material as THREE.MeshBasicMaterial).map?.dispose()
      ;(shadow.material as THREE.Material).dispose()
      ghost.traverse(object => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
        }
      })
      renderer.dispose()
    }

    const setStage = (next: DishStage) => {
      if (stage === next) return
      stage = next
      options.onStage(next)
    }
    const setScale = (next: number) => {
      userScale = next
      dish.scale.setScalar(userScale)
      options.onScale(userScale)
    }
    options.onStage(stage)
    options.onScale(userScale)

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

    // ── placing and anchoring ────────────────────────────────────────────────
    const facingCamera = (position: THREE.Vector3) => {
      const eye = renderer.xr.getCamera().position
      return Math.atan2(eye.x - position.x, eye.z - position.z)
    }
    const place = () => {
      if (stage !== 'surface' || !lastSurface) return
      dish.position.setFromMatrixPosition(lastSurface)
      yaw = facingCamera(dish.position)
      dish.rotation.set(0, yaw, 0)
      dish.visible = true
      ghost.visible = false
      ring.visible = false
      clearAnchor()
      pendingAnchorAtDish = true
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

    let tapStart: { point: Point; time: number } | null = null
    let drag: { offset: THREE.Vector3 } | null = null
    let twoFinger: { distance: number; angle: number; scale: number; yaw: number } | null = null

    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault()
      const touches = event.touches
      if (touches.length === 1) {
        const point = touchPoint(touches[0])
        tapStart = { point, time: performance.now() }
        if (stage === 'placed') {
          clearAnchor()
          const at = onTable(point)
          drag = at ? { offset: dish.position.clone().sub(at) } : null
        }
      } else if (touches.length >= 2 && stage === 'placed') {
        tapStart = null
        drag = null
        const a = touchPoint(touches[0]), b = touchPoint(touches[1])
        twoFinger = { distance: distance(a, b), angle: angle(a, b), scale: userScale, yaw }
        scaleAnimation = null
      }
    }
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      const touches = event.touches
      if (twoFinger && touches.length >= 2) {
        const a = touchPoint(touches[0]), b = touchPoint(touches[1])
        setScale(pinchScale(twoFinger.scale, twoFinger.distance, distance(a, b)))
        yaw = twistYaw(twoFinger.yaw, twoFinger.angle, angle(a, b))
        dish.rotation.set(0, yaw, 0)
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
        if (moved < 12 && performance.now() - tapStart.time < 400) place()
      }
      if (event.touches.length < 2) twoFinger = null
      if (event.touches.length === 0) {
        if (drag) reanchorAtDish()
        drag = null
        tapStart = null
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
    renderer.setAnimationLoop((time, frame) => {
      if (!frame || !refSpace) return
      if (stage !== 'placed' && hitSource) {
        let accepted = false
        const hit = frame.getHitTestResults(hitSource)[0]
        const pose = hit?.getPose(refSpace)
        if (hit && pose) {
          surface.fromArray(pose.transform.matrix)
          // The surface normal is the pose's local +Y; its vertical component is element 5.
          if (isHorizontalSurface(surface.elements[5])) {
            accepted = true
            lastSurface = surface.clone()
            ring.matrix.copy(surface)
            ring.visible = true
            ghost.position.setFromMatrixPosition(surface)
            ghost.rotation.set(0, facingCamera(ghost.position), 0)
            ghost.visible = true
            setStage('surface')
          }
        }
        if (!accepted && stage === 'surface') {
          ring.visible = false
          ghost.visible = false
          lastSurface = null
          setStage('scanning')
        }
      }
      if (anchor) {
        const anchorPose = frame.getPose(anchor.anchorSpace, refSpace)
        if (anchorPose) dish.position.set(anchorPose.transform.position.x, anchorPose.transform.position.y, anchorPose.transform.position.z)
      } else if (pendingAnchorAtDish && stage === 'placed') {
        pendingAnchorAtDish = false
        const { x, y, z } = dish.position
        const generation = anchorGeneration
        frame.createAnchor?.(new XRRigidTransform({ x, y, z }), refSpace)?.then(created => {
          if (ended || generation !== anchorGeneration) created.delete()
          else anchor = created
        }).catch(() => {})
      }
      if (scaleAnimation) {
        const t = Math.min(1, (time - scaleAnimation.started) / 250)
        const eased = 1 - (1 - t) ** 3
        setScale(scaleAnimation.from + (1 - scaleAnimation.from) * eased)
        if (t >= 1) scaleAnimation = null
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
      resetScale() {
        if (stage !== 'placed' || userScale === 1) return
        scaleAnimation = { from: userScale, started: performance.now() }
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
