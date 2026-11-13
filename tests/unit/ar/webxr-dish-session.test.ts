import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { startDishSession } from '@/lib/ar/webxr-dish-session'
import { SURFACE_ACQUIRE_MS, SURFACE_RELEASE_MS, TRACKING_GRACE_MS } from '@/lib/ar/surface-finder'

const mocks = vi.hoisted(() => ({
  load: vi.fn(), setSession: vi.fn(), dispose: vi.fn(), render: vi.fn(),
  loop: null as null | ((time: number, frame: XRFrame) => void),
}))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class { loadAsync = mocks.load },
}))
vi.mock('three', async importOriginal => {
  const real = await importOriginal<typeof import('three')>()
  return { ...real, WebGLRenderer: class {
    xr = {
      enabled: false,
      setReferenceSpaceType: vi.fn(), setSession: mocks.setSession,
      getReferenceSpace: () => ({}),
      getCamera: () => {
        const camera = new real.PerspectiveCamera(60, 1, 0.01, 100)
        camera.position.set(0, 1, 1)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld(true)
        return { position: camera.position, cameras: [camera] }
      },
    }
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop(loop: typeof mocks.loop) { mocks.loop = loop }
    dispose = mocks.dispose
    render = mocks.render
  } }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let serial = 0
function setup() {
  const session = Object.assign(new EventTarget(), {
    end: vi.fn(async () => { session.dispatchEvent(new Event('end')) }),
    requestReferenceSpace: vi.fn(async () => ({})),
    requestHitTestSource: vi.fn(async () => hitSource),
  })
  const hitSource = { cancel: vi.fn() }
  const requestSession = vi.fn(() => Promise.resolve(session))
  vi.stubGlobal('navigator', { xr: { requestSession } })
  const overlay = new EventTarget()
  const layer = new EventTarget()
  const options = {
    glbUrl: `dish-${++serial}.glb`, overlay: overlay as HTMLElement,
    gestureLayer: layer as HTMLElement, onStage: vi.fn(), onEnd: vi.fn(), cooldownMs: 0,
  }
  const point = (x = 100, y = 100) => ({ clientX: x, clientY: y })
  const touch = (type: string, touches: ReturnType<typeof point>[], changedTouches = touches) => {
    layer.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { touches, changedTouches }))
  }
  const hit = (up = 1, createAnchor?: () => Promise<unknown>) => {
    const matrix = new THREE.Matrix4().makeTranslation(0, 0, -1).toArray()
    matrix[5] = up
    return { getPose: () => ({ transform: { matrix } }), createAnchor }
  }
  const frame = (currentHit = hit()) => ({
    getHitTestResults: () => [currentHit], getPose: vi.fn(),
  }) as unknown as XRFrame
  /** A steady table under the centre for long enough to count as found (no flicker). */
  const find = (currentFrame = frame(), from = 0) => {
    mocks.loop!(from, currentFrame)
    mocks.loop!(from + SURFACE_ACQUIRE_MS + 50, currentFrame)
  }
  return { session, hitSource, requestSession, options, point, touch, hit, frame, find }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loop = null
  mocks.setSession.mockResolvedValue(undefined)
  mocks.load.mockImplementation(async () => ({ scene: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()) }))
  vi.stubGlobal('XRRigidTransform', class { constructor(public position: unknown) {} })
  vi.stubGlobal('window', { innerWidth: 200, innerHeight: 200, devicePixelRatio: 1 })
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) })
})

describe('WebXR dish session lifecycle', () => {
  it('requests the session synchronously and cleans up setup rejection', async () => {
    const s = setup()
    mocks.setSession.mockRejectedValue(new Error('renderer setup'))
    const pending = startDishSession(s.options)
    expect(s.requestSession).toHaveBeenCalledOnce()
    await expect(pending).rejects.toThrow('renderer setup')
    expect(s.session.end).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('ends a session that arrives after model loading fails', async () => {
    const s = setup()
    const late = deferred<typeof s.session>()
    s.requestSession.mockReturnValue(late.promise)
    mocks.load.mockRejectedValue(new Error('broken model'))
    await expect(startDishSession(s.options)).rejects.toThrow('broken model')
    late.resolve(s.session)
    await Promise.resolve()
    expect(s.session.end).toHaveBeenCalledOnce()
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('handles requestSession rejection while the model is loading', async () => {
    const s = setup()
    mocks.load.mockReturnValue(new Promise(() => {}))
    s.requestSession.mockRejectedValue(new Error('permission denied'))
    await expect(startDishSession(s.options)).rejects.toThrow('permission denied')
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('settles startup when the session ends before the model is ready', async () => {
    const s = setup()
    mocks.load.mockReturnValue(new Promise(() => {}))
    const pending = startDishSession(s.options)
    const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    s.session.dispatchEvent(new Event('end'))
    await result
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('aborts pending setup and cancels a hit source that resolves late', async () => {
    const s = setup()
    const late = deferred<typeof s.hitSource>()
    s.session.requestHitTestSource.mockReturnValue(late.promise)
    const controller = new AbortController()
    const pending = startDishSession({ ...s.options, signal: controller.signal })
    const result = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    // Drain only startup microtasks; no timers or rendering processes are needed.
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(s.session.requestHitTestSource).toHaveBeenCalledOnce()
    controller.abort()
    await result
    late.resolve(s.hitSource)
    await Promise.resolve()
    expect(s.hitSource.cancel).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('clears a table candidate when the current hit is a wall, after a short grace', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    mocks.loop!(0, s.frame())
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    mocks.loop!(SURFACE_ACQUIRE_MS, s.frame())
    expect(s.options.onStage).toHaveBeenLastCalledWith('surface')
    // One wall frame does not make the dots flicker away…
    mocks.loop!(SURFACE_ACQUIRE_MS + 20, s.frame(s.hit(0)))
    expect(s.options.onStage).toHaveBeenLastCalledWith('surface')
    // …a run of them does.
    mocks.loop!(SURFACE_ACQUIRE_MS + 20 + SURFACE_RELEASE_MS, s.frame(s.hit(0)))
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    handle.end()
  })

  it('deletes a pending placement anchor invalidated by a drag', async () => {
    const s = setup()
    const late = deferred<{ delete: ReturnType<typeof vi.fn> }>()
    const handle = await startDishSession(s.options)
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(s.options.onStage).toHaveBeenLastCalledWith('placed')
    const createAnchor = vi.fn(() => late.promise)
    mocks.loop!(1, Object.assign(s.frame(), { createAnchor }))
    expect(createAnchor).toHaveBeenCalledOnce()
    s.touch('touchstart', [s.point()])
    s.touch('touchmove', [s.point(110, 110)])
    const stale = { delete: vi.fn() }
    late.resolve(stale)
    await Promise.resolve()
    expect(stale.delete).toHaveBeenCalledOnce()
    handle.end()
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('deletes an anchor that finishes after the session ends', async () => {
    const s = setup()
    const late = deferred<{ delete: ReturnType<typeof vi.fn> }>()
    const handle = await startDishSession(s.options)
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    mocks.loop!(1, Object.assign(s.frame(), { createAnchor: vi.fn(() => late.promise) }))
    handle.end()
    const obsolete = { delete: vi.fn() }
    late.resolve(obsolete)
    await Promise.resolve()
    expect(obsolete.delete).toHaveBeenCalledOnce()
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })

  it('queues anchors until an active frame and rejects an anchor from the previous drag', async () => {
    const s = setup()
    const first = deferred<{ delete: ReturnType<typeof vi.fn> }>()
    const second = deferred<{ delete: ReturnType<typeof vi.fn> }>()
    const handle = await startDishSession(s.options)
    const invalidHitAnchor = vi.fn(() => Promise.reject(new Error('inactive frame')))
    s.find(s.frame(s.hit(1, invalidHitAnchor)))
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(invalidHitAnchor).not.toHaveBeenCalled()
    // A new drag cancels placement's queued anchor before any frame consumes it.
    s.touch('touchstart', [s.point()])
    const createAnchor = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const frame = Object.assign(s.frame(), { createAnchor })
    mocks.loop!(1, frame)
    expect(createAnchor).not.toHaveBeenCalled()
    s.touch('touchmove', [s.point(110, 110)])
    s.touch('touchend', [], [s.point(110, 110)])
    mocks.loop!(2, frame)
    s.touch('touchstart', [s.point()])
    s.touch('touchmove', [s.point(120, 120)])
    s.touch('touchend', [], [s.point(120, 120)])
    mocks.loop!(3, frame)
    expect(createAnchor).toHaveBeenCalledTimes(2)
    const stale = { delete: vi.fn() }, current = { delete: vi.fn() }
    second.resolve(current)
    first.resolve(stale)
    await Promise.resolve()
    expect(stale.delete).toHaveBeenCalledOnce()
    expect(current.delete).not.toHaveBeenCalled()
    handle.end()
    expect(current.delete).toHaveBeenCalledOnce()
  })

  it('turns the dish with two fingers but never resizes it', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    mocks.loop!(1, s.frame())
    const scene = mocks.render.mock.calls.at(-1)![0] as THREE.Scene
    const dish = scene.children.find(object => object.type === 'Group' && object.visible)!
    const yawBefore = dish.rotation.y
    // Fingers spread far apart while turning: a pinch-and-twist.
    s.touch('touchstart', [s.point(100, 100), s.point(140, 100)])
    s.touch('touchmove', [s.point(40, 60), s.point(220, 180)])
    mocks.loop!(2, s.frame())
    expect(dish.rotation.y).not.toBeCloseTo(yawBefore)
    for (const object of scene.children) expect(object.scale.toArray()).toEqual([1, 1, 1])
    handle.end()
  })

  it('repositions: lifts a placed dish, finds the table again and places it anew', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    handle.reposition()
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(s.options.onStage).toHaveBeenLastCalledWith('placed')
    const scene = mocks.render.mock.calls.at(-1)![0] as THREE.Scene
    const dish = scene.children.find(object => object.type === 'Group' && object.visible)!
    handle.reposition()
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    expect(dish.visible).toBe(false)
    // The table must be found again, steadily, before a tap can place it.
    mocks.loop!(1000, s.frame())
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    mocks.loop!(1000 + SURFACE_ACQUIRE_MS, s.frame())
    expect(s.options.onStage).toHaveBeenLastCalledWith('surface')
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(s.options.onStage).toHaveBeenLastCalledWith('placed')
    expect(dish.visible).toBe(true)
    handle.end()
  })

  it('shows dots only once a table is steady, fades them out when the dish lands', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    const scene = () => mocks.render.mock.calls.at(-1)![0] as THREE.Scene
    const dots = () => scene().children.find(object => (object as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh
    mocks.loop!(0, s.frame())
    expect(dots().visible).toBe(false)
    for (let time = SURFACE_ACQUIRE_MS; time <= SURFACE_ACQUIRE_MS + 500; time += 50) mocks.loop!(time, s.frame())
    expect(dots().visible).toBe(true)
    expect((dots().material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.5)
    // A tap before the table is steady places nothing; here it is steady, so it lands.
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(s.options.onStage).toHaveBeenLastCalledWith('placed')
    for (let time = 1000; time <= 1600; time += 50) mocks.loop!(time, s.frame())
    expect(dots().visible).toBe(false)
    handle.end()
  })

  it('does not place on a tap before the table is steady', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    mocks.loop!(0, s.frame())
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    expect(s.options.onStage).toHaveBeenLastCalledWith('scanning')
    handle.end()
  })

  it('asks for extra rays where the browser supports offset rays, and cancels them all', async () => {
    const s = setup()
    vi.stubGlobal('XRRay', class { constructor(public origin: unknown, public direction: unknown) {} })
    const extra = { cancel: vi.fn() }
    s.session.requestHitTestSource.mockResolvedValueOnce(s.hitSource).mockResolvedValue(extra)
    const handle = await startDishSession(s.options)
    await Promise.resolve()
    expect(s.session.requestHitTestSource.mock.calls.length).toBeGreaterThan(1)
    handle.end()
    expect(extra.cancel).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reports a lost table when the placed dish anchor is unseen, and recovers', async () => {
    const s = setup()
    const onTracking = vi.fn()
    const handle = await startDishSession({ ...s.options, onTracking })
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    const anchor = { anchorSpace: {}, delete: vi.fn() }
    mocks.loop!(1000, Object.assign(s.frame(), { createAnchor: vi.fn(() => Promise.resolve(anchor)) }))
    await Promise.resolve()
    await Promise.resolve()
    const seen = Object.assign(s.frame(), { getPose: vi.fn(() => ({ transform: { position: { x: 0, y: 0, z: -1 } } })) })
    const unseen = Object.assign(s.frame(), { getPose: vi.fn(() => undefined) })
    mocks.loop!(1100, seen)
    mocks.loop!(1100 + TRACKING_GRACE_MS - 10, unseen)
    expect(onTracking).not.toHaveBeenCalled()
    mocks.loop!(1100 + TRACKING_GRACE_MS, unseen)
    expect(onTracking).toHaveBeenLastCalledWith(true)
    mocks.loop!(1100 + TRACKING_GRACE_MS + 50, seen)
    expect(onTracking).toHaveBeenLastCalledWith(false)
    handle.end()
  })

  it('ignores touches that start outside the scene (top bar, name strip, dock, side edges)', async () => {
    const s = setup()
    const zones = { width: 200, height: 200, topBottom: 30, nameBottom: 50, dockTop: 170 }
    const handle = await startDishSession({ ...s.options, zones: () => zones })
    s.find()
    for (const point of [s.point(100, 10), s.point(100, 40), s.point(100, 190), s.point(5, 100)]) {
      s.touch('touchstart', [point])
      s.touch('touchend', [], [point])
      expect(s.options.onStage).toHaveBeenLastCalledWith('surface')
    }
    // The same tap in the scene places the dish.
    s.touch('touchstart', [s.point(100, 100)])
    s.touch('touchend', [], [s.point(100, 100)])
    expect(s.options.onStage).toHaveBeenLastCalledWith('placed')
    handle.end()
  })

  it('moves the dish only when the drag starts on it', async () => {
    const s = setup()
    mocks.load.mockImplementation(async () => ({ scene: new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshBasicMaterial()) }))
    const handle = await startDishSession(s.options)
    s.find()
    s.touch('touchstart', [s.point(100, 100)])
    s.touch('touchend', [], [s.point(100, 100)])
    const scene = mocks.render.mock.calls.at(-1)![0] as THREE.Scene
    const dish = scene.children.find(object => object.type === 'Group' && object.visible)!
    const before = dish.position.clone()
    // Far from the (small) dish: nothing moves.
    s.touch('touchstart', [s.point(190, 190)])
    s.touch('touchmove', [s.point(150, 150)])
    s.touch('touchend', [], [s.point(150, 150)])
    expect(dish.position.distanceTo(before)).toBe(0)
    handle.end()
  })

  it('waits a moment after placing before scene gestures count', async () => {
    const s = setup()
    const handle = await startDishSession({ ...s.options, cooldownMs: 10_000 })
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    const scene = mocks.render.mock.calls.at(-1)![0] as THREE.Scene
    const dish = scene.children.find(object => object.type === 'Group' && object.visible)!
    const before = dish.position.clone()
    s.touch('touchstart', [s.point()])
    s.touch('touchmove', [s.point(120, 120)])
    s.touch('touchend', [], [s.point(120, 120)])
    expect(dish.position.distanceTo(before)).toBe(0)
    handle.end()
  })

  it('swaps to another dish on the same spot without leaving the camera', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    s.find()
    s.touch('touchstart', [s.point()])
    s.touch('touchend', [], [s.point()])
    const scene = mocks.render.mock.calls.at(-1)![0] as THREE.Scene
    const dish = scene.children.find(object => object.type === 'Group' && object.visible)!
    const before = dish.position.clone()
    const oldModel = dish.children[0]
    const next = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), new THREE.MeshBasicMaterial())
    mocks.load.mockImplementationOnce(async () => ({ scene: next }))
    const onProgress = vi.fn()
    await expect(handle.swapDish(`next-${Math.random()}.glb`, 1, onProgress)).resolves.toBe(true)
    expect(dish.children).not.toContain(oldModel)
    expect(dish.children.some(child => child.type === 'Mesh' && (child as THREE.Mesh).geometry.type === 'BoxGeometry')).toBe(true)
    expect(dish.position.distanceTo(before)).toBe(0)
    expect(onProgress).toHaveBeenLastCalledWith(100)
    expect(s.options.onStage).toHaveBeenLastCalledWith('placed')
    handle.end()
  })

  it('lets a newer swap win over an older one still downloading', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    const slow = deferred<{ scene: THREE.Object3D }>()
    mocks.load.mockImplementationOnce(() => slow.promise)
    const first = handle.swapDish(`slow-${Math.random()}.glb`)
    const second = handle.swapDish(`fast-${Math.random()}.glb`)
    await expect(second).resolves.toBe(true)
    slow.resolve({ scene: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()) })
    await expect(first).resolves.toBe(false)
    handle.end()
  })

  it('disposes private resources once without disposing cached model assets', async () => {
    const s = setup()
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshBasicMaterial()
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    mocks.load.mockResolvedValue({ scene: new THREE.Mesh(geometry, material) })
    const handle = await startDishSession(s.options)
    handle.end()
    handle.end()
    expect(s.session.end).toHaveBeenCalledOnce()
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(s.hitSource.cancel).toHaveBeenCalledOnce()
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(s.options.onEnd).toHaveBeenCalledOnce()
  })
})
