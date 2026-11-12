import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { startDishSession } from '@/lib/ar/webxr-dish-session'

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
    gestureLayer: layer as HTMLElement, onStage: vi.fn(), onScale: vi.fn(), onEnd: vi.fn(),
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
  return { session, hitSource, requestSession, options, point, touch, hit, frame }
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

  it('clears a table candidate when the current hit is a wall', async () => {
    const s = setup()
    const handle = await startDishSession(s.options)
    mocks.loop!(0, s.frame())
    expect(s.options.onStage).toHaveBeenLastCalledWith('surface')
    mocks.loop!(1, s.frame(s.hit(0)))
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
    mocks.loop!(0, s.frame())
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
    mocks.loop!(0, s.frame())
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
    mocks.loop!(0, s.frame(s.hit(1, invalidHitAnchor)))
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
