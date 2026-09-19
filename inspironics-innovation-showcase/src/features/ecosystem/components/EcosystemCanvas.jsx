import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { LOOKS, applyLightRig, buildCity, buildLights, makeSkyEnvironment } from '../render/ecosystemCity.js'
import { TIERS } from '../render/explorerQuality.js'
import { nodeById } from '../model/ecosystemData.js'

/**
 * The Three.js smart-city canvas.
 *
 * Owns the renderer, scene and picking; reports hover/click back through
 * `onHover` / `onSelect` so the surrounding React panel stays declarative.
 */
export default function EcosystemCanvas({ onHover, onSelect, focusId, tier = 'high' }) {
  const hostRef = useRef(null)
  const apiRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(null)
  const [night, setNight] = useState(false)

  // keep the latest callbacks without re-creating the scene
  const cbRef = useRef({ onHover, onSelect })
  cbRef.current = { onHover, onSelect }

  // the scene is built once, so the initial look has to come through a ref
  const nightRef = useRef(night)
  nightRef.current = night

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Densities and terrain resolution are baked into the geometry, so a tier
    // change means tearing the scene down and building it again.
    const q = TIERS[tier] || TIERS.high
    setReady(false)

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch (err) {
      setFailed('WebGL is unavailable in this browser.')
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = q.shadowSize > 0
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()

    // Both looks are compiled at mount: an environment map is one PMREM pass,
    // and paying for it twice up front makes the day/night switch instant.
    const skies = {
      day: makeSkyEnvironment(renderer, 'day'),
      night: makeSkyEnvironment(renderer, 'night'),
    }
    // aerial haze, tinted to the sky it fades into, so the hills read as
    // distance; applyMode() re-tints it whenever the look changes
    scene.fog = new THREE.FogExp2(new THREE.Color(LOOKS.day.fog.color), LOOKS.day.fog.density)

    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.5, 1600)
    camera.position.set(126, 92, 158)

    // a big shadow map is what makes the low sun's long shadows readable, and
    // it is also the single most expensive thing in the frame
    const lights = buildLights(scene, { shadowSize: q.shadowSize })

    const city = buildCity({ quality: q })
    scene.add(city.root)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 34
    controls.maxDistance = 360
    controls.maxPolarAngle = Math.PI * 0.492
    controls.target.set(0, 12, 0)
    controls.autoRotate = !reduced
    controls.autoRotateSpeed = 0.16
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    // strength and threshold are set per look: barely there by day so only
    // lamps and windows lift, wide open at night so the city glows
    const bloom = q.bloom
      ? new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.2, 0.7, 0.82)
      : null
    if (bloom) composer.addPass(bloom)
    composer.addPass(new OutputPass())
    // the composer's render target has no MSAA, so edges need SMAA
    const smaa = q.smaa ? new SMAAPass(host.clientWidth, host.clientHeight) : null
    if (smaa) composer.addPass(smaa)
    composer.setSize(host.clientWidth, host.clientHeight)

    /* --------------------------------------------------------- time of day -- */
    let activeMode = null

    /** Re-light the whole scene for `mode`. Nothing is rebuilt. */
    const applyMode = (mode) => {
      if (mode === activeMode) return
      const look = LOOKS[mode] || LOOKS.day
      const backdrop = skies[mode] || skies.day

      if (activeMode) scene.remove((skies[activeMode] || skies.day).backdrop)
      scene.add(backdrop.backdrop)
      activeMode = mode

      scene.environment = backdrop.env
      scene.environmentIntensity = look.envIntensity
      scene.fog.color.copy(backdrop.fogColor)
      scene.fog.density = look.fog.density

      renderer.toneMappingExposure = look.exposure
      if (bloom) {
        bloom.strength = look.bloom.strength
        bloom.radius = look.bloom.radius
        bloom.threshold = look.bloom.threshold
      }

      applyLightRig(lights, mode)
      city.setTimeOfDay(mode)
    }

    applyMode(nightRef.current ? 'night' : 'day')

    /* ------------------------------------------------------------ picking -- */
    const ray = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let hovered = null
    let downAt = null

    const highlight = new THREE.Mesh(
      new THREE.RingGeometry(14.2, 15.9, 72),
      new THREE.MeshBasicMaterial({
        color: '#00F0FF',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    highlight.rotation.x = -Math.PI / 2
    highlight.position.y = 0.35
    scene.add(highlight)

    const setPointerFromEvent = (e) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
    }

    const pick = () => {
      ray.setFromCamera(pointer, camera)
      const hit = ray.intersectObjects(city.pickable, false)[0]
      return hit?.object?.userData?.node ?? null
    }

    const onPointerMove = (e) => {
      setPointerFromEvent(e)
      const node = pick()
      // Only report a *change*. Reporting every move would push a React state
      // update per mousemove and re-render the panel ~60x a second.
      if (node?.id === hovered?.id) return
      hovered = node
      renderer.domElement.style.cursor = node ? 'pointer' : 'grab'
      cbRef.current.onHover?.(node ? { ...nodeById(node.id), screen: { x: e.clientX, y: e.clientY } } : null)
    }

    const onPointerLeave = () => {
      hovered = null
      cbRef.current.onHover?.(null)
    }

    const onPointerDown = (e) => {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
    }

    const onPointerUp = (e) => {
      if (e.button !== 0 || !downAt) return
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
      const held = performance.now() - downAt.t
      downAt = null
      if (moved > 6 || held > 500) return // that was an orbit drag, not a click
      setPointerFromEvent(e)
      const node = pick()
      if (node) {
        controls.autoRotate = false
        cbRef.current.onSelect?.(nodeById(node.id))
      }
    }

    const el = renderer.domElement
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    /* ------------------------------------------------------------- loop ---- */
    const clock = new THREE.Clock()
    let raf = 0
    let visible = true
    let frames = 0

    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0.02 })
    io.observe(host)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = clock.getElapsedTime()
      if (!visible) return
      city.update(reduced ? 0 : t, camera, !reduced)
      controls.update()

      // highlight ring follows the hovered / focused node
      const target = hovered || apiRef.current?.focused
      if (target && target.pos) {
        // follow the node's own height: the stack layers are 26-50 units up the
        // core tower, and at ground level the ring is swallowed by the podium
        highlight.position.set(target.pos[0], Math.max(0.35, target.pos[1] || 0), target.pos[2])
        const s = target.kind === 'product' ? 0.36 : target.kind === 'layer' ? 0.6 : target.kind === 'landmark' ? 0.95 : 1
        highlight.scale.setScalar(s)
        highlight.material.color.set(target.color || '#00F0FF')
        highlight.material.opacity = THREE.MathUtils.lerp(
          highlight.material.opacity,
          0.42 + Math.sin(t * 3) * 0.14,
          0.14
        )
      } else {
        highlight.material.opacity = THREE.MathUtils.lerp(highlight.material.opacity, 0, 0.16)
      }

      composer.render()

      // Every shadow caster in the city is static — the cars, drones and rotors
      // are all excluded — so the 4K shadow map is rendered a couple of times
      // and then frozen. Re-rendering it each frame costs more than everything
      // else in the scene put together.
      if (++frames === 3 && lights.sun.castShadow) lights.sun.shadow.autoUpdate = false
    }
    tick()

    /* ----------------------------------------------------------- resize ---- */
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
      bloom?.setSize(w, h)
      smaa?.setSize(w, h)
    })
    ro.observe(host)

    /** Smoothly fly the camera to a node and re-target the orbit centre. */
    const flyTo = (node) => {
      if (!node?.pos) return
      const [x, y, z] = node.pos
      const dist = node.kind === 'zone' ? 54 : node.kind === 'product' ? 38 : 104
      const dir = new THREE.Vector3(x, 0, z)
      if (dir.lengthSq() < 1) dir.set(0.7, 0, 1)
      dir.normalize()
      // a shallow approach angle keeps the view architectural rather than top-down
      const to = new THREE.Vector3(x, 0, z).add(dir.multiplyScalar(dist)).setY(y + dist * 0.42)
      const targetTo = new THREE.Vector3(x, y + (node.kind === 'layer' ? 0 : 8), z)
      const fromPos = camera.position.clone()
      const fromTarget = controls.target.clone()
      const t0 = performance.now()
      const dur = 900
      controls.autoRotate = false
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur)
        const e = 1 - Math.pow(1 - k, 3)
        camera.position.lerpVectors(fromPos, to, e)
        controls.target.lerpVectors(fromTarget, targetTo, e)
        controls.update()
        if (k < 1) requestAnimationFrame(step)
      }
      step()
    }

    const resetView = () => {
      const t0 = performance.now()
      const fromPos = camera.position.clone()
      const fromTarget = controls.target.clone()
      const to = new THREE.Vector3(126, 92, 158)
      const targetTo = new THREE.Vector3(0, 12, 0)
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 900)
        const e = 1 - Math.pow(1 - k, 3)
        camera.position.lerpVectors(fromPos, to, e)
        controls.target.lerpVectors(fromTarget, targetTo, e)
        controls.update()
        if (k < 1) requestAnimationFrame(step)
      }
      step()
    }

    apiRef.current = { flyTo, resetView, applyMode, controls, focused: null }
    setReady(true)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      city.dispose()
      composer.dispose?.()
      Object.values(skies).forEach((s) => {
        s.backdrop.traverse((o) => {
          if (o.isMesh || o.isPoints) o.geometry?.dispose?.()
          // textures behind the sprites live in the module texture cache
          o.material?.dispose?.()
        })
        s.env.dispose?.()
      })
      highlight.geometry.dispose()
      highlight.material.dispose()
      renderer.dispose()
      renderer.forceContextLoss?.()
      if (el.parentNode === host) host.removeChild(el)
      apiRef.current = null
    }
  }, [tier])

  useEffect(() => {
    apiRef.current?.applyMode?.(night ? 'night' : 'day')
  }, [night, ready])

  useEffect(() => {
    const node = focusId ? nodeById(focusId) : null
    if (apiRef.current) apiRef.current.focused = node
    if (node) apiRef.current?.flyTo(node)
  }, [focusId])

  const reset = useCallback(() => apiRef.current?.resetView(), [])

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm text-chalk">{failed}</p>
          <p className="mt-2 text-xs text-muted">Use the zone pills below to filter the gallery instead.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/*
        A WebGL canvas cannot be navigated with a keyboard or read by a screen
        reader, so it is labelled and described as the decorative index it is —
        the zone buttons under the section are the equivalent path.
      */}
      <div
        ref={hostRef}
        role="img"
        aria-label="Interactive 3D model of the Inspironics estate"
        aria-describedby="ecosystem-alt"
        className="h-full w-full cursor-grab active:cursor-grabbing"
      />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-ink/80">
          <div className="flex flex-col items-center gap-3">
            <div className="h-9 w-9 animate-spinSlow rounded-full border-2 border-white/10 border-t-cyan-glow" />
            <p className="label-mono">Compiling city</p>
          </div>
        </div>
      )}
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <button
          onClick={() => setNight((v) => !v)}
          aria-pressed={night}
          className="rounded-lg border border-white/12 bg-[#0b0b10]/80 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted backdrop-blur transition hover:border-cyan-glow/50 hover:text-cyan-glow"
        >
          {night ? 'Day view' : 'Night view'}
        </button>
        <button
          onClick={reset}
          className="rounded-lg border border-white/12 bg-[#0b0b10]/80 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted backdrop-blur transition hover:border-cyan-glow/50 hover:text-cyan-glow"
        >
          Reset view
        </button>
      </div>
    </div>
  )
}
