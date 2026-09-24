/**
 * Three.js builders for the Ecosystem Explorer city.
 *
 * Everything here is pure scene construction — no React. `buildCity()` returns the
 * root group plus the list of pickable meshes (each carrying `userData.node`) and
 * an `update(t, camera)` hook the render loop calls for traffic, rotors, water and
 * label fading.
 *
 * Realism notes
 * -------------
 * The look is a late-afternoon aerial of a radial-plan city: a physically based sky
 * (Preetham) drives both the visible backdrop and the image-based lighting, the sun
 * light is aimed along the sky's own sun vector, and every surface is a procedurally
 * textured PBR material rather than a flat emissive block. Windows glow through an
 * emissive map, so buildings read as lit at dusk without the whole facade blooming.
 *
 * Everything is deterministic — the RNGs are seeded, so the city is identical on
 * every load.
 *
 * Draw calls matter here: per-building clutter (parapets, HVAC, plinths) is merged
 * into one mesh, and repeated props (cars, trees, lamps, solar panels) are instanced.
 */
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ZONES, PRODUCT_NODES, STACK_LAYERS, CONDUITS, CY, EM } from '../model/ecosystemData.js'

/* ----------------------------------------------------------------- noise --- */

const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const smooth = (t) => t * t * (3 - 2 * t)

function noise2(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = smooth(x - xi)
  const v = smooth(y - yi)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

function fbm(x, y, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f, y * f) * amp
    f *= 2
    amp *= 0.5
  }
  return sum
}

/** xorshift — seeded so the layout never changes between loads. */
function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/**
 * One world unit is 3 metres. Every prop dimension below is derived from a real
 * size through `mu()`, because the district layout in ecosystemData.js fixes the
 * city's footprint and the props have to agree with it — a car that reads as
 * house-sized is the single fastest way to make a city look like a toy.
 */
const M_PER_UNIT = 3
const mu = (metres) => metres / M_PER_UNIT

const lerp = THREE.MathUtils.lerp
const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/* -------------------------------------------------------------- resources --- */

/*
 * Textures are cached at module scope and deliberately *not* released by
 * `city.dispose()`: nothing ever mutates them, they are bounded in number,
 * they are by far the most expensive thing to build, and a remount reuses
 * them verbatim.
 */
const TEX = new Map()

/*
 * Materials, by contrast, belong to one city.
 *
 * The city is built once and then re-lit — materials whose glow differs
 * between day and night record both values as they are created, so flipping
 * the look is a walk of a list rather than a rebuild. That makes them mutable
 * state, and sharing mutable state across module scope would mean two
 * explorers on one page fighting over whether it is night. So each build gets
 * its own material cache and its own day/night register, and `buildCity()`
 * hands back a `setTimeOfDay` bound to them.
 *
 * `ctx` is set only for the synchronous duration of `buildCity()`; the
 * animation closures that need to know the time of day capture it directly.
 */
let ctx = null

const mat = (key, make) => {
  if (!ctx) throw new Error('ecosystemCity: mat() is only valid while buildCity() is running')
  let m = ctx.mats.get(key)
  if (!m) {
    m = make()
    ctx.mats.set(key, m)
  }
  return m
}

/** Register a material property that differs between the two looks. */
const dual = (material, prop, day, night) => {
  ctx.dayNight.push({ material, prop, day, night })
  return material
}

const paint = (w, h, draw) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  return c
}

/** Per-pixel grain, painted in 2px blocks so it stays cheap. */
function grain(ctx, w, h, scale, strength, light = 0.5) {
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const n = fbm(x * scale, y * scale, 3)
      if (n > light) ctx.fillStyle = 'rgba(255,255,255,' + ((n - light) * strength).toFixed(3) + ')'
      else ctx.fillStyle = 'rgba(0,0,0,' + ((light - n) * strength).toFixed(3) + ')'
      ctx.fillRect(x, y, 2, 2)
    }
  }
}

function drawTexture(name) {
  switch (name) {
    /* rolling farmland / scrub the city sits on */
    case 'ground':
      return paint(512, 512, (ctx, w, h) => {
        ctx.fillStyle = '#2f3527'
        ctx.fillRect(0, 0, w, h)
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const n = fbm(x * 0.012, y * 0.012, 5)
            const m = fbm(x * 0.07 + 40, y * 0.07, 3)
            const g = 0.5 + n * 0.6
            const r0 = (52 * g + m * 12) | 0
            const g0 = (58 * g + m * 13) | 0
            const b0 = (40 * g + m * 9) | 0
            ctx.fillStyle = 'rgb(' + r0 + ',' + g0 + ',' + b0 + ')'
            ctx.fillRect(x, y, 2, 2)
          }
        }
        grain(ctx, w, h, 0.5, 0.1)
      })

    case 'asphalt':
      return paint(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#22242a'
        ctx.fillRect(0, 0, w, h)
        grain(ctx, w, h, 0.09, 0.4, 0.48)
        const rnd = makeRng(7)
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = 'rgba(180,186,196,' + (rnd() * 0.16).toFixed(3) + ')'
          ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.6, 1 + rnd() * 1.6)
        }
        // faint tyre-polished wheel tracks
        const gr = ctx.createLinearGradient(0, 0, 0, h)
        gr.addColorStop(0, 'rgba(0,0,0,0)')
        gr.addColorStop(0.26, 'rgba(0,0,0,0.16)')
        gr.addColorStop(0.5, 'rgba(0,0,0,0)')
        gr.addColorStop(0.74, 'rgba(0,0,0,0.16)')
        gr.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = gr
        ctx.fillRect(0, 0, w, h)
      })

    case 'concrete':
      return paint(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#5b5e63'
        ctx.fillRect(0, 0, w, h)
        grain(ctx, w, h, 0.05, 0.32, 0.5)
        ctx.strokeStyle = 'rgba(0,0,0,0.22)'
        ctx.lineWidth = 2
        for (const p of [0, 0.5]) {
          ctx.beginPath()
          ctx.moveTo(p * w, 0)
          ctx.lineTo(p * w, h)
          ctx.moveTo(0, p * h)
          ctx.lineTo(w, p * h)
          ctx.stroke()
        }
      })

    /* pale slab paving for plazas and sidewalks */
    case 'paving':
      return paint(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#75726c'
        ctx.fillRect(0, 0, w, h)
        const rnd = makeRng(23)
        const n = 4
        const s = w / n
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const t = 0.9 + rnd() * 0.2
            ctx.fillStyle = 'rgb(' + ((122 * t) | 0) + ',' + ((119 * t) | 0) + ',' + ((112 * t) | 0) + ')'
            ctx.fillRect(x * s + 1.4, y * s + 1.4, s - 2.8, s - 2.8)
          }
        }
        grain(ctx, w, h, 0.06, 0.22, 0.5)
      })

    case 'gravel':
      return paint(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#3f4147'
        ctx.fillRect(0, 0, w, h)
        const rnd = makeRng(11)
        for (let i = 0; i < 2600; i++) {
          const g = (40 + rnd() * 70) | 0
          ctx.fillStyle = 'rgba(' + g + ',' + (g + 4) + ',' + (g + 10) + ',' + (0.3 + rnd() * 0.5).toFixed(2) + ')'
          ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.4, 1 + rnd() * 2.4)
        }
      })

    /* corrugated steel for sheds and factory halls */
    case 'corrugated':
      return paint(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#6a6f78'
        ctx.fillRect(0, 0, w, h)
        for (let x = 0; x < w; x += 8) {
          const gr = ctx.createLinearGradient(x, 0, x + 8, 0)
          gr.addColorStop(0, 'rgba(0,0,0,0.30)')
          gr.addColorStop(0.45, 'rgba(255,255,255,0.16)')
          gr.addColorStop(1, 'rgba(0,0,0,0.30)')
          ctx.fillStyle = gr
          ctx.fillRect(x, 0, 8, h)
        }
        grain(ctx, w, h, 0.08, 0.14, 0.5)
      })

    /* ploughed crop rows */
    case 'field':
      return paint(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#3b3326'
        ctx.fillRect(0, 0, w, h)
        for (let y = 0; y < h; y += 8) {
          ctx.fillStyle = 'rgba(96,132,68,0.85)'
          ctx.fillRect(0, y, w, 5)
          ctx.fillStyle = 'rgba(0,0,0,0.35)'
          ctx.fillRect(0, y + 5, w, 3)
        }
        grain(ctx, w, h, 0.1, 0.3, 0.5)
      })

    /* dashed lane marking (transparent between dashes) */
    case 'dash':
      return paint(64, 16, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = '#e8e4d6'
        ctx.fillRect(0, 0, w * 0.46, h)
      })

    /* soft radial falloff — street-light pools, glows, contact shading */
    case 'pool':
      return paint(128, 128, (ctx, w, h) => {
        const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
        gr.addColorStop(0, 'rgba(255,255,255,1)')
        gr.addColorStop(0.42, 'rgba(255,255,255,0.32)')
        gr.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = gr
        ctx.fillRect(0, 0, w, h)
      })

    /* headlight wedge — bright at the car, fanning out and fading forward */
    case 'beam':
      return paint(128, 256, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        for (let y = 0; y < h; y++) {
          const k = y / h
          const half = lerp(w * 0.1, w * 0.5, k)
          const a = (1 - k) * (1 - k) * 0.85
          const gr = ctx.createLinearGradient(w / 2 - half, 0, w / 2 + half, 0)
          gr.addColorStop(0, 'rgba(255,240,214,0)')
          gr.addColorStop(0.5, 'rgba(255,240,214,' + a.toFixed(3) + ')')
          gr.addColorStop(1, 'rgba(255,240,214,0)')
          ctx.fillStyle = gr
          ctx.fillRect(w / 2 - half, h - 1 - y, half * 2, 1)
        }
      })

    /* the moon disc, with faint maria */
    case 'moon':
      return paint(128, 128, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        const gr = ctx.createRadialGradient(w * 0.42, h * 0.4, 0, w / 2, h / 2, w * 0.5)
        gr.addColorStop(0, 'rgba(255,253,246,1)')
        gr.addColorStop(0.68, 'rgba(238,239,234,1)')
        gr.addColorStop(0.88, 'rgba(206,212,224,0.85)')
        gr.addColorStop(1, 'rgba(198,206,222,0)')
        ctx.fillStyle = gr
        ctx.beginPath()
        ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2)
        ctx.fill()
        const rnd = makeRng(9)
        for (let i = 0; i < 16; i++) {
          const a = rnd() * Math.PI * 2
          const d = rnd() * w * 0.33
          ctx.fillStyle = 'rgba(148,155,170,' + (0.06 + rnd() * 0.13).toFixed(3) + ')'
          ctx.beginPath()
          ctx.arc(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 4 + rnd() * 13, 0, Math.PI * 2)
          ctx.fill()
        }
      })

    /* soft chimney / cooling-tower puff */
    case 'puff':
      return paint(128, 128, (ctx, w, h) => {
        const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
        gr.addColorStop(0, 'rgba(226,226,232,0.55)')
        gr.addColorStop(0.5, 'rgba(206,206,214,0.22)')
        gr.addColorStop(1, 'rgba(200,200,210,0)')
        ctx.fillStyle = gr
        ctx.fillRect(0, 0, w, h)
      })

    /* tangent-space normals from an fbm height field — scrolled for water */
    case 'waterN':
      return paint(256, 256, (ctx, w, h) => {
        const at = (x, y) =>
          fbm(((x + w) % w) * 0.05, ((y + h) % h) * 0.05, 4) * 0.7 +
          fbm(((x + w) % w) * 0.14 + 9, ((y + h) % h) * 0.14, 3) * 0.3
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * 5
            const dy = (at(x, y + 1) - at(x, y - 1)) * 5
            const len = Math.hypot(dx, dy, 1)
            const r0 = (((-dx / len) * 0.5 + 0.5) * 255) | 0
            const g0 = (((-dy / len) * 0.5 + 0.5) * 255) | 0
            const b0 = ((1 / len) * 0.5 + 0.5) * 255
            ctx.fillStyle = 'rgb(' + r0 + ',' + g0 + ',' + (b0 | 0) + ')'
            ctx.fillRect(x, y, 1, 1)
          }
        }
      })

    default:
      return paint(4, 4, (ctx, w, h) => {
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, w, h)
      })
  }
}

/** Cached texture, keyed by name *and* repeat so variants never collide. */
function tex(name, u = 1, v = 1) {
  const key = name + '|' + u + '|' + v
  let t = TEX.get(key)
  if (!t) {
    t = new THREE.CanvasTexture(drawTexture(name))
    t.colorSpace = name === 'waterN' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(u, v)
    t.anisotropy = 8
    TEX.set(key, t)
  }
  return t
}

/* ------------------------------------------------------------- facades ----- */

const FACADE_STYLES = {
  glass: { wall: '#333b45', trim: '#4a5462', glass: ['#0c1218', '#1b2836'], lit: ['#ffd9a8', '#ffe9c8', '#cfe4ff'], rate: 0.26, inset: 0.02, metal: 0.45 },
  concrete: { wall: '#63655f', trim: '#75776f', glass: ['#0e131a', '#19202a'], lit: ['#ffd39a', '#ffc98a'], rate: 0.2, inset: 0.2, metal: 0.08 },
  brick: { wall: '#6a4738', trim: '#7e5947', glass: ['#10141a', '#1b222c'], lit: ['#ffcf94', '#ffbd7a'], rate: 0.24, inset: 0.22, metal: 0.05 },
  metal: { wall: '#5b6068', trim: '#6c7280', glass: ['#141920', '#1f262f'], lit: ['#e2ebff', '#ffe0b0'], rate: 0.1, inset: 0.28, metal: 0.55 },
  stucco: { wall: '#7f7365', trim: '#8f8474', glass: ['#11161d', '#1d242e'], lit: ['#ffd7a2', '#ffc98d'], rate: 0.32, inset: 0.18, metal: 0.05 },
}

/** Colour / emissive / roughness maps for a facade of `cols` bays by `rows` floors. */
function facadeMaps(cols, rows, styleName) {
  const key = 'facade|' + styleName + '|' + cols + '|' + rows
  let maps = TEX.get(key)
  if (maps) return maps

  const s = FACADE_STYLES[styleName] || FACADE_STYLES.glass
  // 14px a window keeps a 26-floor tower's three maps under a quarter of a
  // megabyte, which matters because every distinct bay/floor count bakes its own
  const cell = 12
  const k = cell / 32
  const nx = Math.min(cols, 18)
  const ny = Math.min(rows, 34)
  const w = nx * cell
  const h = ny * cell

  const cCol = document.createElement('canvas')
  const cEmi = document.createElement('canvas')
  const cRou = document.createElement('canvas')
  for (const c of [cCol, cEmi, cRou]) {
    c.width = w
    c.height = h
  }
  const g = cCol.getContext('2d')
  const e = cEmi.getContext('2d')
  const r = cRou.getContext('2d')

  g.fillStyle = s.wall
  g.fillRect(0, 0, w, h)
  grain(g, w, h, 0.045 / k, 0.3, 0.5)
  e.fillStyle = '#000000'
  e.fillRect(0, 0, w, h)
  r.fillStyle = '#dcdcdc' // matte wall
  r.fillRect(0, 0, w, h)

  const rnd = makeRng(cols * 7919 + rows * 104729 + styleName.length * 313)
  const mx = cell * (0.13 + s.inset * 0.34)
  const my = cell * (0.17 + s.inset * 0.34)
  const ww = cell - mx * 2
  const wh = cell - my * 2

  for (let ry = 0; ry < ny; ry++) {
    const floorBias = rnd()
    for (let cx = 0; cx < nx; cx++) {
      const px = cx * cell + mx
      const py = ry * cell + my

      const gr = g.createLinearGradient(px, py, px, py + wh)
      gr.addColorStop(0, s.glass[1])
      gr.addColorStop(0.55, s.glass[0])
      gr.addColorStop(1, s.glass[1])
      g.fillStyle = gr
      g.fillRect(px, py, ww, wh)
      g.strokeStyle = s.trim
      g.lineWidth = 1.6 * k
      g.strokeRect(px - 0.8 * k, py - 0.8 * k, ww + 1.6 * k, wh + 1.6 * k)
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fillRect(px - 1.2 * k, py + wh, ww + 2.4 * k, 1.6 * k)

      r.fillStyle = '#1c1c1c' // glass is glossy
      r.fillRect(px, py, ww, wh)

      if (rnd() < s.rate * (0.4 + floorBias * 1.2)) {
        const col = s.lit[(rnd() * s.lit.length) | 0]
        e.globalAlpha = 0.4 + rnd() * 0.6
        e.fillStyle = col
        e.fillRect(px, py, ww, wh)
        e.globalAlpha *= 0.22 // spill onto the surrounding wall
        e.fillRect(px - 2.5 * k, py - 2.5 * k, ww + 5 * k, wh + 5 * k)
        e.globalAlpha = 1
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.2)'
    g.fillRect(0, ry * cell + cell - 2 * k, w, 2 * k)
  }

  const build = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
    t.anisotropy = 8
    return t
  }
  maps = { map: build(cCol, true), emissiveMap: build(cEmi, true), roughnessMap: build(cRou, false), metal: s.metal }
  TEX.set(key, maps)
  return maps
}

const facadeMat = (cols, rows, style) =>
  mat('fmat|' + style + '|' + cols + '|' + rows, () => {
    const m = facadeMaps(cols, rows, style)
    const material = new THREE.MeshStandardMaterial({
      map: m.map,
      emissiveMap: m.emissiveMap,
      roughnessMap: m.roughnessMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.78,
      roughness: 1,
      metalness: m.metal,
      envMapIntensity: 0.9,
    })
    // lit windows carry the city after dark
    return dual(material, 'emissiveIntensity', 0.78, 2.7)
  })

/* ------------------------------------------------------ shared materials --- */

const M = {
  concreteLot: () => mat('m.concreteLot', () => new THREE.MeshStandardMaterial({ map: tex('concrete', 8, 8), color: '#9a988f', roughness: 0.9, metalness: 0.06 })),
  concrete: () => mat('m.concrete', () => new THREE.MeshStandardMaterial({ map: tex('concrete', 2, 2), roughness: 0.92, metalness: 0.08 })),
  paving: (u = 3) => mat('m.paving' + u, () => new THREE.MeshStandardMaterial({ map: tex('paving', u, u), roughness: 0.86, metalness: 0.05 })),
  asphalt: (u = 4, v = 4) => mat('m.asphalt' + u + 'x' + v, () => new THREE.MeshStandardMaterial({ map: tex('asphalt', u, v), roughness: 0.78, metalness: 0.06 })),
  steel: (u = 3) => mat('m.steel' + u, () => new THREE.MeshStandardMaterial({ map: tex('corrugated', u, 1), roughness: 0.55, metalness: 0.65 })),
  white: () => mat('m.white', () => new THREE.MeshStandardMaterial({ color: '#d8dae0', roughness: 0.6, metalness: 0.15 })),
  darkMetal: () => mat('m.darkMetal', () => new THREE.MeshStandardMaterial({ color: '#31353d', roughness: 0.5, metalness: 0.75 })),
  glassDark: () => mat('m.glassDark', () => new THREE.MeshStandardMaterial({ color: '#0e1620', roughness: 0.1, metalness: 0.8, envMapIntensity: 1.6 })),
  bark: () => mat('m.bark', () => new THREE.MeshStandardMaterial({ color: '#3b3026', roughness: 1, metalness: 0 })),
  water: () =>
    mat('m.water', () =>
      new THREE.MeshStandardMaterial({
        color: '#16232e',
        normalMap: tex('waterN', 3, 3),
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.06,
        metalness: 0.5,
        envMapIntensity: 2.2,
      })
    ),
  grass: (u = 2) => mat('m.grass' + u, () => new THREE.MeshStandardMaterial({ map: tex('ground', u, u), color: '#758a5c', roughness: 1, metalness: 0 })),
  glow: (color, opacity = 0.6, night = opacity) =>
    mat('m.glow|' + color + '|' + opacity + '|' + night, () =>
      dual(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color),
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          map: tex('pool'),
        }),
        'opacity',
        opacity,
        night
      )
    ),
  emissive: (color, intensity = 2, night = intensity) =>
    mat('m.em|' + color + '|' + intensity + '|' + night, () =>
      dual(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(color),
          emissive: new THREE.Color(color),
          emissiveIntensity: intensity,
          roughness: 0.4,
          metalness: 0.1,
        }),
        'emissiveIntensity',
        intensity,
        night
      )
    ),
  basic: (color) => mat('m.basic|' + color, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color) })),
}

/* --------------------------------------------------------- unit geometry --- */

// Shared primitives, only ever consumed through `bag().mesh()` (which clones),
// so `dispose()` never frees them out from under a later mount.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 18)
const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 16)
const UNIT_PYRAMID = new THREE.ConeGeometry(0.5, 1, 4)
// indexed on purpose: mergeGeometries refuses to mix indexed and non-indexed
// geometry, and every other unit primitive here is indexed
const UNIT_SPHERE = new THREE.SphereGeometry(0.5, 14, 8)

const mtx = (x, y, z, o = {}) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)),
    new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1)
  )

/** Accumulates transformed primitives, then bakes them into one mesh. */
function bag() {
  const parts = []
  return {
    add(geo, x, y, z, o) {
      parts.push({ geo, m: mtx(x, y, z, o) })
      return this
    },
    get length() {
      return parts.length
    },
    mesh(material, { shadow = true, receive = shadow, own = false } = {}) {
      if (!parts.length) return null
      const geos = parts.map(({ geo, m }) => {
        const g = geo.clone()
        g.applyMatrix4(m)
        return g
      })
      const g = mergeGeometries(geos, false)
      geos.forEach((x) => x.dispose())
      // `own` frees the source geometries too — used where each part is a
      // one-off (a field, a road segment) rather than a shared unit primitive
      if (own) parts.forEach(({ geo }) => geo.dispose())
      const mesh = new THREE.Mesh(g, material)
      mesh.castShadow = shadow
      mesh.receiveShadow = receive
      return mesh
    },
  }
}

/** A flat annulus with UVs that run along the circumference — for ring roads. */
function ringBand(radius, width, segs, uRepeat, y = 0) {
  const inner = radius - width / 2
  const outer = radius + width / 2
  const pos = []
  const uv = []
  const nor = []
  const idx = []
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const cx = Math.cos(a)
    const sz = Math.sin(a)
    pos.push(inner * cx, y, inner * sz, outer * cx, y, outer * sz)
    nor.push(0, 1, 0, 0, 1, 0)
    const u = (i / segs) * uRepeat
    uv.push(u, 0, u, 1)
  }
  for (let i = 0; i < segs; i++) {
    const a0 = i * 2
    idx.push(a0, a0 + 2, a0 + 3, a0, a0 + 3, a0 + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

/**
 * An irregular closed outline lying flat. Perfect circles of grass read as
 * stamps from the air, which is the first thing that gives a fake city away.
 */
function blobGeometry(radius, seed = 1, lobes = 30) {
  const pts = []
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2
    const r = radius * (0.76 + fbm(Math.cos(a) * 2.2 + seed * 7, Math.sin(a) * 2.2 + seed * 3, 3) * 0.52)
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r))
  }
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts), 1)
  geo.rotateX(-Math.PI / 2)
  // ShapeGeometry hands back raw XY as UV, so rescale it into texture space
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 14, uv.getY(i) / 14)
  uv.needsUpdate = true
  return geo
}

/** A flat rectangle lying in the XZ plane, centred on the origin. */
function slab(w, d, uRepeat = 1, vRepeat = 1) {
  const geo = new THREE.PlaneGeometry(w, d)
  geo.rotateX(-Math.PI / 2)
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat)
  uv.needsUpdate = true
  return geo
}

/* ------------------------------------------------------------------- sky --- */

// Half an hour before sunset. Low enough for long raking shadows and a warm
// horizon, and the shadow camera below is widened to hold shadows this long.
/**
 * The two lighting states the explorer can be in.
 *
 * Everything that differs between them is declared here — sky, haze, exposure,
 * bloom and the light rig — so the canvas can switch looks without rebuilding a
 * single mesh. `setTimeOfDay()` handles the material side.
 *
 * The day key light sits ~70 degrees off the default camera bearing, so the
 * faces you see are three-quarter lit and the shadows fall across frame rather
 * than straight away from you. At night the sky's own sun goes below the
 * horizon (leaving a thin dusk band) and a soft high moon takes over as the key.
 */
export const LOOKS = {
  day: {
    sky: { elevation: 11, azimuth: 105, turbidity: 4.4, rayleigh: 2.5, mie: 0.005, mieG: 0.86 },
    fog: { color: '#4f4a5a', density: 0.001 },
    exposure: 0.46,
    envIntensity: 0.45,
    bloom: { strength: 0.2, radius: 0.7, threshold: 0.82 },
    key: {
      elevation: 11,
      azimuth: 105,
      color: '#ffcb92',
      intensity: 21,
      distance: 700,
      extent: 265,
      near: 250,
      far: 1250,
    },
    hemi: { sky: '#8fb2e0', ground: '#2b2318', intensity: 0.3 },
    fill: { color: '#8fabd2', intensity: 1.8 },
    stars: 0,
    moon: false,
  },
  night: {
    sky: { elevation: -7, azimuth: 105, turbidity: 1.4, rayleigh: 1.1, mie: 0.003, mieG: 0.9 },
    fog: { color: '#080d1a', density: 0.0016 },
    exposure: 1.15,
    envIntensity: 1.3,
    bloom: { strength: 0.48, radius: 0.78, threshold: 0.44 },
    key: {
      elevation: 34,
      azimuth: 256,
      color: '#a2c0f5',
      intensity: 2.3,
      distance: 700,
      extent: 265,
      near: 250,
      far: 1250,
    },
    hemi: { sky: '#1e2c4a', ground: '#07090f', intensity: 0.48 },
    fill: { color: '#3f5480', intensity: 0.5 },
    stars: 0.95,
    moon: true,
  },
}

const dirFrom = ({ elevation, azimuth }) =>
  new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevation),
    THREE.MathUtils.degToRad(azimuth)
  )

/** A dome of fixed-size points — only ever added to the night backdrop. */
function buildStars(opacity) {
  const n = 1100
  const pos = new Float32Array(n * 3)
  const rnd = makeRng(20260902)
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const y = 0.04 + rnd() * 0.96 // upper hemisphere only
    const r = Math.sqrt(1 - y * y) * 440
    pos[i * 3] = Math.cos(a) * r
    pos[i * 3 + 1] = y * 440
    pos[i * 3 + 2] = Math.sin(a) * r
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: '#dfe8ff',
      size: 1.7,
      sizeAttenuation: false, // a star is a star at any distance
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    })
  )
}

/** Moon disc plus halo, billboarded along the night key-light direction. */
function buildMoon(dir) {
  const g = new THREE.Group()
  const at = dir.clone().multiplyScalar(430)
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex('pool'),
      color: '#b9d0ff',
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  )
  halo.position.copy(at)
  halo.scale.setScalar(120)
  const disc = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex('moon'), transparent: true, depthWrite: false, fog: false })
  )
  disc.position.copy(at)
  disc.scale.setScalar(30)
  g.add(halo, disc)
  return g
}

/**
 * Preetham sky for one look, used for both the visible dome and the image-based
 * lighting, so reflections, ambient and the key light all agree with what you
 * can see. Returns a backdrop group — at night that carries stars and a moon.
 */
export function makeSkyEnvironment(renderer, mode = 'day') {
  const look = LOOKS[mode] || LOOKS.day

  const sky = new Sky()
  sky.scale.setScalar(1000)
  sky.name = 'sky.' + mode
  const u = sky.material.uniforms
  u.turbidity.value = look.sky.turbidity
  u.rayleigh.value = look.sky.rayleigh
  u.mieCoefficient.value = look.sky.mie
  u.mieDirectionalG.value = look.sky.mieG
  u.sunPosition.value.copy(dirFrom(look.sky))

  // The environment map is baked from the dome alone — stars and moon are
  // decoration and have no business contributing to the IBL.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tmp = new THREE.Scene()
  tmp.add(sky)
  const env = pmrem.fromScene(tmp, 0, 1, 3000).texture
  tmp.remove(sky)
  pmrem.dispose()

  const backdrop = new THREE.Group()
  backdrop.add(sky)
  if (look.stars) backdrop.add(buildStars(look.stars))
  if (look.moon) backdrop.add(buildMoon(dirFrom(look.key)))

  return { env, backdrop, fogColor: new THREE.Color(look.fog.color) }
}

/* ---------------------------------------------------------------- labels --- */

const labelCache = new Map()

/**
 * A small map-pin style caption. Deliberately restrained — thin chip, muted
 * fill — so the city reads as a photograph with annotations rather than a HUD.
 */
export function makeLabel(text, color = CY, { scale = 1, sub = '' } = {}) {
  const key = text + '|' + color + '|' + sub
  let t = labelCache.get(key)
  if (!t) {
    const fs = 42
    const subFs = 25
    const padX = 30
    const padY = 20
    const probe = document.createElement('canvas').getContext('2d')
    probe.font = '600 ' + fs + 'px Inter, system-ui, sans-serif'
    const w = probe.measureText(text).width
    let subW = 0
    if (sub) {
      probe.font = '500 ' + subFs + 'px "JetBrains Mono", monospace'
      subW = probe.measureText(sub).width
    }
    const cw = Math.ceil(Math.max(w, subW) + padX * 2)
    const ch = Math.ceil(fs + (sub ? subFs + 8 : 0) + padY * 2)

    const canvas = paint(cw, ch, (ctx) => {
      const r = ch * 0.28
      ctx.beginPath()
      ctx.moveTo(r, 1)
      ctx.arcTo(cw - 1, 1, cw - 1, ch - 1, r)
      ctx.arcTo(cw - 1, ch - 1, 1, ch - 1, r)
      ctx.arcTo(1, ch - 1, 1, 1, r)
      ctx.arcTo(1, 1, cw - 1, 1, r)
      ctx.closePath()
      ctx.fillStyle = 'rgba(9,11,16,0.72)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = color + '80'
      ctx.stroke()

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(244,244,249,0.95)'
      ctx.font = '600 ' + fs + 'px Inter, system-ui, sans-serif'
      ctx.fillText(text, cw / 2, sub ? ch / 2 - subFs * 0.52 : ch / 2)
      if (sub) {
        ctx.fillStyle = color
        ctx.font = '500 ' + subFs + 'px "JetBrains Mono", monospace'
        ctx.fillText(sub, cw / 2, ch / 2 + fs * 0.5)
      }
    })

    t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    labelCache.set(key, t)
  }

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, opacity: 0.9 })
  )
  const h = 2.7 * scale
  sprite.scale.set((t.image.width / t.image.height) * h, h, 1)
  sprite.renderOrder = 20
  return sprite
}

/* ---------------------------------------------------------------- terrain --- */

/**
 * Rolling ground the city sits on. Dead flat out to r=180 so the street plan
 * stays coherent, then swelling into hills that read as a fogged horizon —
 * which is what stops the scene looking like a disc floating in space.
 */
function terrainHeight(x, z) {
  const r = Math.hypot(x, z)
  const amp = smoothstep(180, 300, r) * 12 + smoothstep(240, 820, r) * 145
  if (amp === 0) return 0
  const n = fbm(x * 0.0035 + 30, z * 0.0035 + 12, 5) - 0.5
  const n2 = fbm(x * 0.013, z * 0.013, 3) - 0.5
  const n3 = fbm(x * 0.045, z * 0.045, 2) - 0.5
  return n * amp + n2 * amp * 0.26 + n3 * amp * 0.05
}

/*
 * Ground cover, as a multiplier over the tiled soil texture. The texture repeats
 * every ~37 units, so all the large-scale variation — lush valleys, dry scrub,
 * bare earth, rock on the steep faces — has to come from vertex colour instead.
 */
const COVER = {
  lush: new THREE.Color(0.66, 0.86, 0.52),
  dry: new THREE.Color(0.86, 0.83, 0.56),
  earth: new THREE.Color(0.92, 0.72, 0.52),
  rock: new THREE.Color(0.66, 0.66, 0.7),
}

function buildTerrain(segments) {
  const geo = new THREE.PlaneGeometry(1900, 1900, segments, segments)
  geo.rotateX(-Math.PI / 2)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)))
  p.needsUpdate = true
  geo.computeVertexNormals()

  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 52, uv.getY(i) * 52)
  uv.needsUpdate = true

  const col = new Float32Array(p.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const slope = Math.hypot(
      terrainHeight(x + 9, z) - terrainHeight(x - 9, z),
      terrainHeight(x, z + 9) - terrainHeight(x, z - 9)
    ) / 18
    const k = fbm(x * 0.0026 + 7, z * 0.0026, 4)
    c.copy(k > 0.45 ? COVER.lush : COVER.dry).lerp(COVER.earth, smoothstep(0.42, 0.3, k))
    c.lerp(COVER.rock, smoothstep(0.3, 0.75, slope))
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))

  const mesh = new THREE.Mesh(
    geo,
    mat('m.terrain', () =>
      new THREE.MeshStandardMaterial({ map: tex('ground', 1, 1), vertexColors: true, roughness: 1, metalness: 0 })
    )
  )
  mesh.receiveShadow = true
  return mesh
}

/* ------------------------------------------------------------ street plan --- */

const RINGS = [
  { r: 38, w: 5 },      // 15 m — four lanes
  { r: 78, w: 5.5 },
  { r: 116, w: 5.5 },
]
const PLAZA_R = 34
const AVENUE_W = 4      // 12 m — two lanes
const AVENUE_END = 124
const LOT_R = 13.5

/** Zone bearings, and the avenue bearings that thread between them. */
function streetBearings() {
  const zones = ZONES.map((z) => Math.atan2(z.pos[2], z.pos[0])).sort((a, b) => a - b)
  const avenues = zones.map((a, i) => {
    const b = i === zones.length - 1 ? zones[0] + Math.PI * 2 : zones[i + 1]
    return (a + b) / 2
  })
  return { zones, avenues }
}

function buildRoads(avenues) {
  const g = new THREE.Group()

  const lineMat = mat('m.line', () =>
    new THREE.MeshBasicMaterial({ color: '#c8c3b4', transparent: true, opacity: 0.34, depthWrite: false })
  )
  const dashMat = mat('m.dash', () =>
    new THREE.MeshBasicMaterial({ map: tex('dash', 1, 1), transparent: true, opacity: 0.45, depthWrite: false })
  )
  const curbMat = mat('m.curb', () => new THREE.MeshStandardMaterial({ color: '#8b8880', roughness: 0.85, metalness: 0.05 }))

  /* central plaza the core tower and the product pylons stand on */
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_R, 96), M.paving(9))
  plaza.rotation.x = -Math.PI / 2
  plaza.position.y = 0.03
  plaza.receiveShadow = true
  g.add(plaza)

  // a pair of inlaid brand rings, lit just enough to catch the eye at dusk
  for (const [r, w, op, night] of [[19, 0.5, 0.5, 0.9], [30, 0.3, 0.32, 0.62]]) {
    const inlay = new THREE.Mesh(ringBand(r, w, 128, 1, 0.05), M.glow(CY, op, night))
    g.add(inlay)
  }

  /* ring roads: carriageway, centre dashes, edge lines, sidewalks, curbs */
  RINGS.forEach(({ r, w }) => {
    const circ = Math.PI * 2 * r
    const segs = Math.max(96, Math.round(circ / 3))

    const road = new THREE.Mesh(ringBand(r, w, segs, circ / 3.2, 0.032), M.asphalt(1, 1))
    road.receiveShadow = true
    g.add(road)

    g.add(new THREE.Mesh(ringBand(r, mu(0.32), segs, circ / mu(12), 0.046), dashMat))
    for (const s of [-1, 1]) {
      g.add(new THREE.Mesh(ringBand(r + s * (w / 2 - 0.3), mu(0.26), segs, 1, 0.046), lineMat))

      const walk = new THREE.Mesh(ringBand(r + s * (w / 2 + 0.95), mu(4.2), segs, circ / 2.4, 0.14), M.paving(1))
      walk.receiveShadow = true
      g.add(walk)

      const curb = new THREE.Mesh(new THREE.TorusGeometry(r + s * (w / 2 + 0.09), 0.05, 5, segs), curbMat)
      curb.rotation.x = Math.PI / 2
      curb.position.y = 0.05
      g.add(curb)
    }
  })

  /*
   * Radial avenues out through the greenbelt. Each category is accumulated and
   * baked into a single mesh — eight avenues times road/dashes/two sidewalks/
   * three junctions is nearly sixty draw calls otherwise.
   */
  const len = AVENUE_END - PLAZA_R
  const mid = PLAZA_R + len / 2
  const roadBag = bag()
  const dashBag = bag()
  const walkBag = bag()
  const junctionBag = bag()

  avenues.forEach((a) => {
    const ry = Math.PI / 2 - a
    roadBag.add(slab(AVENUE_W, len, 1.2, len / 3.2), Math.cos(a) * mid, 0.034, Math.sin(a) * mid, { ry })
    dashBag.add(slab(mu(0.32), len, 1, len / mu(12)), Math.cos(a) * mid, 0.047, Math.sin(a) * mid, { ry })

    for (const sd of [-1, 1]) {
      const ox = -Math.sin(a) * sd * (AVENUE_W / 2 + 0.9)
      const oz = Math.cos(a) * sd * (AVENUE_W / 2 + 0.9)
      walkBag.add(slab(mu(4), len, 1, len / 2.4), Math.cos(a) * mid + ox, 0.14, Math.sin(a) * mid + oz, { ry })
    }

    // asphalt patch over every crossing, so lane markings stop at the junction
    RINGS.forEach(({ r, w }) => {
      const disc = new THREE.CircleGeometry(Math.max(w, AVENUE_W) * 0.78, 28)
      disc.rotateX(-Math.PI / 2)
      junctionBag.add(disc, Math.cos(a) * r, 0.055, Math.sin(a) * r)
    })
  })

  const ground = { shadow: false, receive: true, own: true }
  g.add(roadBag.mesh(M.asphalt(1, 1), ground))
  g.add(dashBag.mesh(dashMat, { shadow: false, receive: false, own: true }))
  g.add(walkBag.mesh(M.paving(1), ground))
  g.add(junctionBag.mesh(M.asphalt(1, 1), ground))

  return g
}

/* -------------------------------------------------------------- greenery --- */

/** Parks and verges in the wedges between the ring roads. */
function buildParks(avenues) {
  const g = new THREE.Group()
  const rnd = makeRng(4242)
  const spots = []

  for (const band of [[46, 70], [86, 110]]) {
    for (let i = 0; i < avenues.length; i++) {
      const a = avenues[i] + (Math.PI * 2) / 16
      const r = lerp(band[0], band[1], 0.5)
      spots.push([Math.cos(a) * r, Math.sin(a) * r, 9 + rnd() * 5])
    }
  }
  // a few wide lawns in the greenbelt, between the fields
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2
    const r = 132 + rnd() * 44
    spots.push([Math.cos(a) * r, Math.sin(a) * r, 14 + rnd() * 16])
  }

  const lawns = bag()
  spots.forEach(([x, z, r], i) => lawns.add(blobGeometry(r, i + 1), x, 0.024, z))
  g.add(lawns.mesh(M.grass(1), { shadow: false, receive: true, own: true }))

  return { group: g, spots }
}

/**
 * The widest wedge between two avenues — where the lake goes.
 * @returns {[number, number]} the lake centre, as x/z
 */
function lakeSpot(avenues) {
  let best = 0
  let gap = 0
  for (let i = 0; i < avenues.length; i++) {
    const a = avenues[i]
    const b = i === avenues.length - 1 ? avenues[0] + Math.PI * 2 : avenues[i + 1]
    if (b - a > gap) {
      gap = b - a
      best = (a + b) / 2
    }
  }
  return [Math.cos(best) * 152, Math.sin(best) * 152]
}

/**
 * Cultivated fields ringing the city. A patchwork of crops is the single most
 * recognisable thing about land seen from the air, and it stops the greenbelt
 * reading as one flat lawn.
 */
function buildFarmland([lx, lz]) {
  const g = new THREE.Group()
  const rnd = makeRng(6161)
  const crops = ['#68743a', '#857a41', '#465c31', '#7a6738', '#556442', '#8f8349']

  const bags = crops.map(() => bag())
  for (let i = 0; i < 54; i++) {
    const a = rnd() * Math.PI * 2
    const r = 132 + rnd() * 44
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const jitter = (rnd() - 0.5) * 0.6
    const w = 12 + rnd() * 20
    const d = 10 + rnd() * 22
    if (Math.hypot(x - lx, z - lz) < 34) continue // keep the shoreline clear
    bags[i % 6].add(slab(w, d, w / 5, d / 5), x, 0.028, z, { ry: a + jitter })
  }
  bags.forEach((b, kind) => {
    const m = b.mesh(
      mat('m.field' + kind, () =>
        new THREE.MeshStandardMaterial({ map: tex('field', 1, 1), color: crops[kind], roughness: 1, metalness: 0 })
      ),
      { shadow: false, receive: true, own: true }
    )
    if (m) g.add(m)
  })
  return g
}

/** One lake in the greenbelt — the only big specular surface, so it sells the sky. */
function buildLake([cx, cz]) {
  const g = new THREE.Group()

  const shore = new THREE.Mesh(blobGeometry(26, 11), M.grass(1))
  shore.position.set(cx, 0.03, cz)
  shore.receiveShadow = true
  g.add(shore)

  const sand = new THREE.Mesh(blobGeometry(22, 11.4), mat('m.sand', () =>
    new THREE.MeshStandardMaterial({ map: tex('gravel', 1, 1), color: '#a89878', roughness: 1, metalness: 0 })
  ))
  sand.position.set(cx, 0.05, cz)
  sand.receiveShadow = true
  g.add(sand)

  const water = new THREE.Mesh(blobGeometry(20.5, 11.8), M.water())
  water.position.set(cx, 0.09, cz)
  g.add(water)

  return g
}

/**
 * Instanced street trees + greenbelt woodland.
 * Trunks and canopies are two instanced meshes, so the whole forest is 2 draws.
 */
function buildTrees(avenues, parkSpots, density) {
  const rnd = makeRng(9091)
  const spots = []

  // rows behind the sidewalks on every ring road
  RINGS.forEach(({ r, w }) => {
    for (const s of [-1, 1]) {
      const rr = r + s * (w / 2 + 2.1)
      const n = Math.max(8, Math.round(((Math.PI * 2 * rr) / 7.5) * density))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.04
        // leave the junctions clear
        if (avenues.some((av) => Math.abs(Math.atan2(Math.sin(a - av), Math.cos(a - av))) < 0.075)) continue
        spots.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.85 + rnd() * 0.4])
      }
    }
  })

  // avenue trees
  avenues.forEach((a) => {
    for (const s of [-1, 1]) {
      for (let r = PLAZA_R + 6; r < AVENUE_END - 6; r += 7.5 / density) {
        const off = s * (AVENUE_W / 2 + 2)
        spots.push([Math.cos(a) * r - Math.sin(a) * off, Math.sin(a) * r + Math.cos(a) * off, 0.8 + rnd() * 0.45])
      }
    }
  })

  // clumps inside the parks
  parkSpots.forEach(([x, z, r]) => {
    const n = Math.round(r * 1.3 * density)
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * (r - 2)
      spots.push([x + Math.cos(a) * d, z + Math.sin(a) * d, 0.9 + rnd() * 0.7])
    }
  })

  // scattered woodland out to the hills
  const woodland = Math.round(520 * density)
  for (let i = 0; i < woodland; i++) {
    const a = rnd() * Math.PI * 2
    const r = 128 + Math.sqrt(rnd()) * 200
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (fbm(x * 0.006 + 5, z * 0.006, 3) < 0.44) continue // clearings
    spots.push([x, z, 0.9 + rnd() * 0.8])
  }

  // every third tree is a conifer, so the canopy line is not a field of balls
  const broad = spots.filter((_, i) => i % 3 !== 2)
  const conif = spots.filter((_, i) => i % 3 === 2)

  const leafMat = mat('m.leaf', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 }))
  const r0 = mu(1.9)
  const lumpy = mergeGeometries([
    new THREE.IcosahedronGeometry(r0, 1),
    new THREE.IcosahedronGeometry(r0 * 0.62, 0).translate(r0 * 0.55, r0 * 0.4, r0 * 0.2),
    new THREE.IcosahedronGeometry(r0 * 0.55, 0).translate(-r0 * 0.5, r0 * 0.12, -r0 * 0.38),
  ])
  const spire = mergeGeometries([
    new THREE.ConeGeometry(mu(2.1), mu(5), 8).translate(0, mu(-1.2), 0),
    new THREE.ConeGeometry(mu(1.5), mu(4.2), 8).translate(0, mu(2.1), 0),
  ])

  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(mu(0.18), mu(0.32), mu(3.6), 6), M.bark(), spots.length)
  const leaves = new THREE.InstancedMesh(lumpy, leafMat, broad.length)
  const firs = new THREE.InstancedMesh(spire, leafMat, conif.length)
  trunks.castShadow = true
  leaves.castShadow = true
  leaves.receiveShadow = true
  firs.castShadow = true
  firs.receiveShadow = true

  const col = new THREE.Color()
  spots.forEach(([x, z, s], i) => {
    trunks.setMatrixAt(i, mtx(x, terrainHeight(x, z) + mu(1.8) * s, z, { sx: s, sy: s, sz: s }))
  })
  broad.forEach(([x, z, s], i) => {
    const y = terrainHeight(x, z)
    leaves.setMatrixAt(i, mtx(x, y + mu(4.6) * s, z, { sx: s * (0.82 + (i % 5) * 0.06), sy: s * 1.2, sz: s * (0.82 + (i % 3) * 0.08), ry: i }))
    const k = (i * 0.137) % 1
    col.setHSL(0.27 - k * 0.08, 0.36 + k * 0.24, 0.07 + k * 0.06)
    leaves.setColorAt(i, col)
  })
  conif.forEach(([x, z, s], i) => {
    const y = terrainHeight(x, z)
    firs.setMatrixAt(i, mtx(x, y + mu(5.4) * s, z, { sx: s * 0.9, sy: s * (1 + (i % 4) * 0.12), sz: s * 0.9, ry: i }))
    const k = (i * 0.211) % 1
    col.setHSL(0.33 - k * 0.04, 0.3 + k * 0.12, 0.05 + k * 0.035)
    firs.setColorAt(i, col)
  })
  trunks.instanceMatrix.needsUpdate = true
  leaves.instanceMatrix.needsUpdate = true
  firs.instanceMatrix.needsUpdate = true
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
  if (firs.instanceColor) firs.instanceColor.needsUpdate = true

  const g = new THREE.Group()
  g.add(trunks, leaves, firs)
  return g
}

/** Instanced lamp standards with a warm pool of light on the tarmac. */
function buildStreetLights(avenues, density) {
  const spots = []

  RINGS.forEach(({ r, w }) => {
    const n = Math.max(8, Math.round(((Math.PI * 2 * r) / 11) * density))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const s = i % 2 ? 1 : -1
      const rr = r + s * (w / 2 + 0.75)
      spots.push([Math.cos(a) * rr, Math.sin(a) * rr, Math.atan2(-s * Math.cos(a), s * Math.sin(a))])
    }
  })
  avenues.forEach((a) => {
    for (let r = PLAZA_R + 8; r < AVENUE_END - 8; r += 11 / density) {
      for (const s of [-1, 1]) {
        const off = s * (AVENUE_W / 2 + 0.75)
        spots.push([
          Math.cos(a) * r - Math.sin(a) * off,
          Math.sin(a) * r + Math.cos(a) * off,
          Math.atan2(Math.sin(a) * s, -Math.cos(a) * s),
        ])
      }
    }
  })

  // pole + bracket arm baked into one geometry
  const poleGeo = mergeGeometries([
    UNIT_CYL.clone().applyMatrix4(mtx(0, mu(4.5), 0, { sx: mu(0.34), sy: mu(9), sz: mu(0.34) })),
    UNIT_BOX.clone().applyMatrix4(mtx(0, mu(8.8), mu(1.1), { sx: mu(0.2), sy: mu(0.2), sz: mu(2.2) })),
  ])
  const poles = new THREE.InstancedMesh(poleGeo, M.darkMetal(), spots.length)
  poles.castShadow = true

  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(mu(0.85), mu(0.26), mu(0.6)),
    M.emissive('#ffd9a0', 3.4, 6),
    spots.length
  )
  const pools = new THREE.InstancedMesh(slab(mu(14), mu(14)), M.glow('#ffcf92', 0.4, 1), spots.length)

  spots.forEach(([x, z, ry], i) => {
    poles.setMatrixAt(i, mtx(x, 0, z, { ry }))
    heads.setMatrixAt(i, mtx(x + Math.sin(ry) * mu(2) , mu(8.6), z + Math.cos(ry) * mu(2), { ry }))
    pools.setMatrixAt(i, mtx(x + Math.sin(ry) * mu(2), 0.07, z + Math.cos(ry) * mu(2)))
  })
  poles.instanceMatrix.needsUpdate = true
  heads.instanceMatrix.needsUpdate = true
  pools.instanceMatrix.needsUpdate = true

  const g = new THREE.Group()
  g.add(poles, heads, pools)
  return g
}

/* -------------------------------------------------------------- traffic --- */

/**
 * Cars circulating the ring roads and avenues. Five instanced meshes (body,
 * glazing, headlights, tail lights, headlight pool) cover the whole fleet.
 */
function buildTraffic(avenues, density) {
  const lanes = []
  RINGS.forEach(({ r, w }) => {
    for (const dir of [1, -1]) {
      const rr = r - dir * w * 0.24
      lanes.push({ kind: 'ring', r: rr, dir, len: Math.PI * 2 * rr })
    }
  })
  avenues.forEach((a) => {
    for (const dir of [1, -1]) {
      lanes.push({ kind: 'radial', a, off: dir * mu(3.2), dir, r0: PLAZA_R + 2, r1: AVENUE_END - 2, len: AVENUE_END - PLAZA_R - 4 })
    }
  })

  const rnd = makeRng(31337)
  const cars = []
  lanes.forEach((lane) => {
    const n = Math.max(2, Math.round((lane.len / 13) * density))
    for (let i = 0; i < n; i++) {
      cars.push({
        lane,
        u: (i + rnd() * 0.6) / n,
        speed: (mu(11) + rnd() * mu(5)) / lane.len, // ~40-58 km/h
        hue: rnd(),
      })
    }
  })

  const bodyGeo = mergeGeometries([
    UNIT_BOX.clone().applyMatrix4(mtx(0, 0, 0, { sx: mu(1.82), sy: mu(1.05), sz: mu(4.4) })),
    UNIT_BOX.clone().applyMatrix4(mtx(0, mu(-0.55), mu(1.5), { sx: mu(1.66), sy: mu(0.4), sz: mu(0.7) })),
    UNIT_BOX.clone().applyMatrix4(mtx(0, mu(-0.55), mu(-1.5), { sx: mu(1.66), sy: mu(0.4), sz: mu(0.7) })),
  ])
  const bodies = new THREE.InstancedMesh(
    bodyGeo,
    mat('m.car', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.32, metalness: 0.55, envMapIntensity: 1.2 })),
    cars.length
  )
  // deliberately not shadow casters — see the one-shot shadow map in the canvas
  bodies.castShadow = false
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(mu(1.66), mu(0.85), mu(2.1)), M.glassDark(), cars.length)
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(mu(1.4), mu(0.25), mu(0.2)), M.basic('#fff4dc'), cars.length)
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(mu(1.45), mu(0.22), mu(0.18)), M.basic('#ff2d18'), cars.length)

  const beamGeo = slab(mu(4.2), mu(15))
  beamGeo.rotateY(Math.PI) // bright, narrow end of the gradient nearest the car
  const beams = new THREE.InstancedMesh(beamGeo, M.glow('#ffe8bd', 0.34, 0.95), cars.length)

  const col = new THREE.Color()
  cars.forEach((c, i) => {
    // mostly greys and whites, with the odd saturated car
    if (c.hue < 0.68) col.setHSL(0.6, 0.04, 0.16 + (c.hue / 0.68) * 0.6)
    else col.setHSL((c.hue - 0.68) * 3.1, 0.6, 0.34)
    bodies.setColorAt(i, col)
  })
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true

  const OFF_GLASS = mtx(0, mu(0.9), mu(-0.2))
  const OFF_HEAD = mtx(0, mu(0.02), mu(2.24))
  const OFF_TAIL = mtx(0, mu(0.1), mu(-2.24))
  const OFF_BEAM = mtx(0, mu(-0.42), mu(9.6))
  const base = new THREE.Matrix4()
  const tmp = new THREE.Matrix4()

  const update = (t) => {
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]
      const lane = c.lane
      let x
      let z
      let ry
      if (lane.kind === 'ring') {
        const a = ((c.u + t * c.speed) % 1) * Math.PI * 2
        const cs = Math.cos(a)
        const sn = Math.sin(a)
        x = cs * lane.r
        z = sn * lane.r
        ry = Math.atan2(-sn * lane.dir, cs * lane.dir)
      } else {
        const u = (c.u + t * c.speed) % 1
        const k = lane.dir > 0 ? u : 1 - u
        const r = lerp(lane.r0, lane.r1, k)
        const cs = Math.cos(lane.a)
        const sn = Math.sin(lane.a)
        x = cs * r - sn * lane.off
        z = sn * r + cs * lane.off
        ry = Math.atan2(cs * lane.dir, sn * lane.dir)
      }
      base.copy(mtx(x, mu(0.75), z, { ry }))
      bodies.setMatrixAt(i, base)
      glass.setMatrixAt(i, tmp.multiplyMatrices(base, OFF_GLASS))
      heads.setMatrixAt(i, tmp.multiplyMatrices(base, OFF_HEAD))
      tails.setMatrixAt(i, tmp.multiplyMatrices(base, OFF_TAIL))
      beams.setMatrixAt(i, tmp.multiplyMatrices(base, OFF_BEAM))
    }
    bodies.instanceMatrix.needsUpdate = true
    glass.instanceMatrix.needsUpdate = true
    heads.instanceMatrix.needsUpdate = true
    tails.instanceMatrix.needsUpdate = true
    beams.instanceMatrix.needsUpdate = true
  }

  const g = new THREE.Group()
  g.add(bodies, glass, heads, tails, beams)
  update(0)
  return { group: g, update }
}

/* ------------------------------------------------------- distant skyline --- */

/** A far-off skyline so the horizon has depth. No shadows, one draw call. */
function buildSkyline(density) {
  const rnd = makeRng(555)
  const items = []
  // three satellite towns rather than an even scatter, so the horizon has shape
  const towns = [
    [0.7, 270, 62],
    [2.9, 320, 78],
    [4.7, 240, 54],
  ]
  towns.forEach(([bearing, dist, spread]) => {
    const perTown = Math.round(52 * density)
    for (let i = 0; i < perTown; i++) {
      const a = bearing + (rnd() - 0.5) * 0.9
      const r = dist + (rnd() - 0.5) * spread
      const core = 1 - Math.min(1, Math.abs(r - dist) / (spread * 0.5))
      items.push([Math.cos(a) * r, Math.sin(a) * r, mu(11) + rnd() * mu(16), mu(16) + rnd() * mu(30) + core * mu(58), a])
    }
  })
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const im = new THREE.InstancedMesh(
    geo,
    mat('m.skyline', () => {
      const maps = facadeMaps(8, 14, 'metal')
      const material = new THREE.MeshStandardMaterial({
        map: maps.map,
        emissiveMap: maps.emissiveMap,
        color: '#8b8d96',
        emissive: new THREE.Color('#ffe3bd'),
        emissiveIntensity: 0.22,
        roughness: 0.95,
        metalness: 0.05,
      })
      return dual(material, 'emissiveIntensity', 0.22, 1.1)
    }),
    items.length
  )
  items.forEach(([x, z, w, h, a], i) => {
    im.setMatrixAt(i, mtx(x, terrainHeight(x, z) + h / 2 - 0.6, z, { sx: w, sy: h, sz: w * (0.7 + (i % 4) * 0.2), ry: a }))
  })
  im.instanceMatrix.needsUpdate = true
  return im
}

/* ------------------------------------------------------------ buildings --- */

const roofDeck = () =>
  mat('m.roofdeck', () => new THREE.MeshStandardMaterial({ map: tex('gravel', 2, 2), roughness: 0.95, metalness: 0.05 }))

/**
 * A block with a real facade: window bays sized from its actual dimensions, a
 * gravel roof deck, a parapet, rooftop plant and (when tall enough) a mast with
 * an aviation light. Clutter is merged so a building costs 2 meshes, not 12.
 */
function makeBuilding({ w, d, h, style = 'glass', floorH = mu(3.3), bay = mu(1.9), seed = 1, plinth = true }) {
  const rows = THREE.MathUtils.clamp(Math.round(h / floorH), 1, 34)
  const colsW = THREE.MathUtils.clamp(Math.round(w / bay), 2, 18)
  const colsD = THREE.MathUtils.clamp(Math.round(d / bay), 2, 18)
  const deck = roofDeck()

  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
    facadeMat(colsD, rows, style),
    facadeMat(colsD, rows, style),
    deck,
    deck,
    facadeMat(colsW, rows, style),
    facadeMat(colsW, rows, style),
  ])
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  g.add(body)

  const rnd = makeRng(seed * 2654435761)
  const b = bag()
  const pt = mu(0.5)
  const ph = mu(1.1)
  b.add(UNIT_BOX, 0, h + ph / 2, d / 2 - pt / 2, { sx: w, sy: ph, sz: pt })
  b.add(UNIT_BOX, 0, h + ph / 2, -d / 2 + pt / 2, { sx: w, sy: ph, sz: pt })
  b.add(UNIT_BOX, w / 2 - pt / 2, h + ph / 2, 0, { sx: pt, sy: ph, sz: d })
  b.add(UNIT_BOX, -w / 2 + pt / 2, h + ph / 2, 0, { sx: pt, sy: ph, sz: d })

  const units = 1 + ((rnd() * 3) | 0)
  for (let i = 0; i < units; i++) {
    const uw = mu(1.8) + rnd() * mu(3)
    const ud = mu(1.5) + rnd() * mu(2.4)
    const uh = mu(0.9) + rnd() * mu(1.6)
    b.add(UNIT_BOX, (rnd() - 0.5) * Math.max(0.5, w - uw - 1.6), h + uh / 2, (rnd() - 0.5) * Math.max(0.5, d - ud - 1.6), {
      sx: uw,
      sy: uh,
      sz: ud,
    })
  }
  if (h > mu(24)) {
    const ps = Math.min(mu(4), w * 0.4)
    b.add(UNIT_BOX, w * 0.22, h + mu(1.6), -d * 0.2, { sx: ps, sy: mu(3.2), sz: Math.min(mu(4), d * 0.4) })
  }
  if (plinth) b.add(UNIT_BOX, 0, mu(0.5), 0, { sx: w + mu(1.4), sy: mu(1), sz: d + mu(1.4) })

  const beacons = []
  if (h > mu(60)) {
    b.add(UNIT_CYL, 0, h + mu(4), 0, { sx: mu(0.25), sy: mu(8), sz: mu(0.25) })
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(mu(0.5), 8, 6), M.basic('#ff3b30'))
    beacon.position.set(0, h + mu(8.4), 0)
    g.add(beacon)
    beacons.push({ mesh: beacon, phase: rnd() })
  }

  const clutter = b.mesh(M.concrete())
  if (clutter) g.add(clutter)

  return { group: g, beacons, height: h }
}

/** Place a building inside a zone group and forward its beacons. */
function place(parent, out, x, z, opts) {
  const bld = makeBuilding(opts)
  bld.group.position.set(x, opts.y ?? 0, z)
  if (opts.ry) bld.group.rotation.y = opts.ry
  parent.add(bld.group)
  out.push(...bld.beacons)
  return bld
}

/** Four-sided pyramid or gable roof for the small stuff. */
function pitchedRoof(b, x, y, z, w, d, h, ry = 0) {
  b.add(UNIT_PYRAMID, x, y + h / 2, z, { sx: Math.hypot(w, d) * 1.02, sy: h, sz: Math.hypot(w, d) * 1.02, ry: ry + Math.PI / 4 })
}

/* -------------------------------------------------------------- landmark --- */

/**
 * The core tower: a real glazed high-rise with a lit crown, wearing the four
 * stack layers as illuminated collars. It is the one openly futuristic object
 * in the city, and it stands on the plaza rather than floating over it.
 */
function buildLandmark(pickable) {
  const own = ctx // the halo animation below outlives the build
  const g = new THREE.Group()
  const core = { id: 'core', name: 'Inspironics Core' }

  const podium = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 13, 3.2, 56), M.paving(4))
  podium.position.y = 1.6
  podium.castShadow = true
  podium.receiveShadow = true
  g.add(podium)

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 5.4, 40, 1, true), facadeMat(18, 2, 'glass'))
  skirt.position.y = 5.9
  skirt.castShadow = true
  g.add(skirt)

  // top at 56.6 units — about 170 m — so the four collars sit on the shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6.6, 48, 40, 1, true), facadeMat(18, 15, 'glass'))
  shaft.position.y = 32.6
  shaft.castShadow = true
  g.add(shaft)

  const mullions = bag()
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    mullions.add(UNIT_BOX, Math.cos(a) * 6, 32.6, Math.sin(a) * 6, { sx: 0.34, sy: 48, sz: 0.34, ry: -a })
  }
  mullions.add(UNIT_CYL, 0, 8.7, 0, { sx: 18.4, sy: 0.5, sz: 18.4 })
  const frame = mullions.mesh(M.darkMetal())
  g.add(frame)

  markPickable(g, core, pickable)

  /* the intelligence stack, worn as lit collars up the shaft */
  const rings = []
  STACK_LAYERS.forEach((layer, i) => {
    // matches STACK_LAYERS' declared positions in ecosystemData.js
    const y = 26 + i * 8
    const rad = 7 - i * 0.42
    const ring = new THREE.Group()
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad, 1.5, 44),
      mat('m.collar|' + layer.color, () =>
        dual(
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(layer.color).multiplyScalar(0.35),
            emissive: new THREE.Color(layer.color),
            emissiveIntensity: 0.7,
            roughness: 0.25,
            metalness: 0.8,
          }),
          'emissiveIntensity',
          0.7,
          1.1
        )
      )
    )
    collar.castShadow = true
    ring.add(collar)
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(rad + 1.4, 0.18, 10, 64),
      mat('m.halo|' + layer.id, () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(layer.color),
          emissive: new THREE.Color(layer.color),
          emissiveIntensity: 2.2,
          roughness: 0.4,
        })
      )
    )
    halo.rotation.x = Math.PI / 2
    ring.add(halo)
    ring.position.y = y
    markPickable(ring, layer, pickable)
    g.add(ring)

    const label = makeLabel(layer.name, layer.color, { scale: 0.6 })
    label.position.set(9.5, y + 1, 0)
    g.add(label)
    rings.push({ ring, halo, i, label })
  })

  const crownY = 56.6 + 2.4
  const crown = new THREE.Mesh(
    new THREE.OctahedronGeometry(3, 0),
    mat('m.crown', () =>
      dual(
        new THREE.MeshStandardMaterial({
          color: '#0d2a30',
          emissive: new THREE.Color(CY),
          emissiveIntensity: 2.6,
          roughness: 0.15,
          metalness: 0.7,
        }),
        'emissiveIntensity',
        2.6,
        3.2
      )
    )
  )
  crown.position.y = crownY
  markPickable(crown, core, pickable)
  g.add(crown)

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 1.6, 46, 20, 1, true),
    mat('m.beam', () =>
      dual(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(CY),
          transparent: true,
          opacity: 0.045,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
        'opacity',
        0.045,
        0.1
      )
    )
  )
  beam.position.y = crownY + 24
  g.add(beam)

  const coreLabel = makeLabel('Inspironics Core', CY, { scale: 0.86, sub: 'INTELLIGENCE BACKBONE' })
  coreLabel.position.set(0, crownY + 6, 0)
  g.add(coreLabel)

  const labels = [coreLabel, ...rings.map((r) => r.label)]

  return {
    group: g,
    labels,
    update: (t) => {
      crown.rotation.y = t * 0.4
      crown.rotation.x = Math.sin(t * 0.35) * 0.2
      rings.forEach(({ ring, halo, i }) => {
        ring.rotation.y = t * (0.1 + i * 0.03) * (i % 2 ? -1 : 1)
        halo.material.emissiveIntensity = (own.night ? 2.2 : 1.8) + Math.sin(t * 1.4 + i) * 0.7
      })
    },
  }
}

/* ----------------------------------------------------------- zone lots ---- */

function zoneLot(zone) {
  const g = new THREE.Group()

  const pave = new THREE.Mesh(new THREE.CircleGeometry(LOT_R, 64), M.concreteLot())
  pave.rotation.x = -Math.PI / 2
  pave.position.y = 0.14
  pave.receiveShadow = true
  g.add(pave)

  const kerb = new THREE.Mesh(new THREE.TorusGeometry(LOT_R, 0.16, 5, 96), mat('m.kerbLight', () =>
    new THREE.MeshStandardMaterial({ color: '#918d84', roughness: 0.85, metalness: 0.05 })
  ))
  kerb.rotation.x = Math.PI / 2
  kerb.position.y = 0.15
  g.add(kerb)

  // a painted arc in the district colour — the only branding at ground level
  g.add(new THREE.Mesh(ringBand(LOT_R - 1.3, 0.55, 96, 1, 0.2), M.glow(zone.color, 0.45, 0.8)))

  return g
}

/* ----------------------------------------------------------- zone kinds --- */

function windTurbine() {
  const g = new THREE.Group()
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(mu(1.1), mu(2.4), mu(38), 14), M.white())
  tower.position.y = mu(19)
  tower.castShadow = true
  g.add(tower)

  const hub = new THREE.Group()
  hub.position.set(0, mu(38), mu(1.4))
  const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(mu(1.5), mu(4.4), 4, 10), M.white())
  nacelle.rotation.x = Math.PI / 2
  hub.add(nacelle)
  const spinner = new THREE.Group()
  spinner.position.z = mu(3.2)
  const blades = bag()
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    blades.add(UNIT_BOX, Math.cos(a) * mu(15), Math.sin(a) * mu(15), 0, { sx: mu(1.6), sy: mu(29), sz: mu(0.4), rz: a })
  }
  blades.add(UNIT_SPHERE, 0, 0, mu(0.3), { sx: mu(2.4), sy: mu(2.4), sz: mu(2.4) })
  // Excluded from the shadow map along with the cars and drones: the map is
   // rendered once and frozen, so anything that keeps moving would otherwise
   // leave a shadow behind where it used to be.
  spinner.add(blades.mesh(M.white(), { shadow: false }))
  hub.add(spinner)
  g.add(hub)

  return { group: g, update: (t) => (spinner.rotation.z = t * 1.15) }
}

function zoneEnergy(zone, beacons) {
  const g = new THREE.Group()
  const updates = []

  // solar field, instanced
  const panelGeo = new THREE.BoxGeometry(mu(4.2), mu(0.18), mu(2.6))
  const panels = new THREE.InstancedMesh(
    panelGeo,
    mat('m.solar', () =>
      new THREE.MeshStandardMaterial({ color: '#101a2c', roughness: 0.12, metalness: 0.85, envMapIntensity: 1.8 })
    ),
    84
  )
  panels.castShadow = true
  const legs = bag()
  let n = 0
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 12; c++) {
      const x = c * mu(4.6) - 8.4
      const z = r * mu(3.6) - 3.6
      if (Math.hypot(x + 3, z + 1) > 10.4) continue
      panels.setMatrixAt(n++, mtx(x, mu(1.9), z, { rx: -0.5 }))
      legs.add(UNIT_BOX, x, mu(0.9), z + mu(0.6), { sx: mu(0.16), sy: mu(1.8), sz: mu(0.16) })
      legs.add(UNIT_BOX, x, mu(0.5), z - mu(0.8), { sx: mu(0.16), sy: mu(1), sz: mu(0.16) })
    }
  }
  panels.count = n
  panels.instanceMatrix.needsUpdate = true
  g.add(panels, legs.mesh(M.darkMetal()))

  // two turbines on the far edge
  const t1 = windTurbine()
  t1.group.position.set(7.5, 0.16, -8)
  t1.group.rotation.y = -0.5
  g.add(t1.group)
  updates.push(t1.update)
  const t2 = windTurbine()
  t2.group.position.set(-8.5, 0.16, -9.5)
  t2.group.rotation.y = -0.35
  t2.group.scale.setScalar(0.82)
  g.add(t2.group)
  updates.push(t2.update)

  // substation: transformers, battery containers, a lattice pylon
  const yard = bag()
  for (let i = 0; i < 3; i++) {
    yard.add(UNIT_BOX, 6 + i * 3.2, 1.4, 8, { sx: 2.6, sy: 2.4, sz: 3.4 })
    yard.add(UNIT_CYL, 6 + i * 3.2, 3.2, 8, { sx: 1.5, sy: 1.2, sz: 1.5 })
  }
  for (let i = 0; i < 3; i++) yard.add(UNIT_BOX, -11 + i * 0.2, 1.5, 4 + i * 3.1, { sx: 3, sy: 2.6, sz: 8, ry: 0.06 })
  for (const s of [-1, 1]) {
    yard.add(UNIT_BOX, s * 1.6 - 1, 5, 11.5, { sx: 0.3, sy: 10, sz: 0.3 })
  }
  yard.add(UNIT_BOX, -1, 10, 11.5, { sx: 5.4, sy: 0.3, sz: 0.3 })
  yard.add(UNIT_BOX, -1, 8.4, 11.5, { sx: 4.4, sy: 0.26, sz: 0.26 })
  // the substation was laid out at metre scale; drop it in as one scaled block
  const yardMesh = yard.mesh(M.steel(2))
  yardMesh.scale.setScalar(0.42)
  yardMesh.position.set(3.4, 0.16, 1.4)
  g.add(yardMesh)

  place(g, beacons, -7, 6.5, { w: mu(11), d: mu(9), h: mu(7), style: 'metal', seed: 12, y: 0.16 })

  return { group: g, update: (t) => updates.forEach((u) => u(t)) }
}

function zoneAgri(zone, beacons) {
  const g = new THREE.Group()

  const field = new THREE.Mesh(new THREE.CircleGeometry(12.6, 48), mat('m.crop', () =>
    new THREE.MeshStandardMaterial({ map: tex('field', 9, 9), roughness: 1, metalness: 0 })
  ))
  field.rotation.x = -Math.PI / 2
  field.rotation.z = 0.5
  field.position.y = 0.2
  field.receiveShadow = true
  g.add(field)

  // barn with a pitched roof, plus grain silos
  const barn = bag()
  barn.add(UNIT_BOX, -7, mu(3.5), 7, { sx: mu(14), sy: mu(7), sz: mu(9) })
  const roof = bag()
  pitchedRoof(roof, -7, mu(7), 7, mu(14), mu(9), mu(3.6))
  g.add(barn.mesh(mat('m.barn', () => new THREE.MeshStandardMaterial({ color: '#7a3a30', roughness: 0.85, metalness: 0.05 }))))
  g.add(roof.mesh(M.darkMetal()))

  const silos = bag()
  for (let i = 0; i < 3; i++) {
    silos.add(UNIT_CYL, 4 + i * 2.2, mu(8), 8.5, { sx: mu(6), sy: mu(16), sz: mu(6) })
    silos.add(UNIT_CONE, 4 + i * 2.2, mu(17.6), 8.5, { sx: mu(6.4), sy: mu(3.2), sz: mu(6.4) })
  }
  g.add(silos.mesh(M.steel(2)))

  // polytunnel greenhouses
  const glassHouse = mat('m.polytunnel', () =>
    new THREE.MeshStandardMaterial({
      color: '#cfe6e2',
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    })
  )
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(mu(3.6), mu(3.6), mu(30), 16, 1, true, 0, Math.PI), glassHouse)
    t.rotation.z = Math.PI / 2
    t.rotation.y = Math.PI / 2
    t.position.set(-9 + i * 2.7, 0.2, -6)
    g.add(t)
  }

  // centre-pivot irrigation boom, slowly sweeping the field
  const pivot = new THREE.Group()
  pivot.position.set(1, 0.2, 0)
  const boom = bag()
  boom.add(UNIT_CYL, 0, mu(3), 0, { sx: mu(1.2), sy: mu(6), sz: mu(1.2) })
  for (let i = 1; i <= 10; i++) boom.add(UNIT_BOX, 0, mu(5), i, { sx: mu(0.3), sy: mu(0.3), sz: 1 })
  for (let i = 2; i <= 10; i += 2) boom.add(UNIT_BOX, 0, mu(2.8), i, { sx: mu(0.24), sy: mu(4.4), sz: mu(0.24) })
  pivot.add(boom.mesh(M.white(), { shadow: false })) // sweeps: see windTurbine
  g.add(pivot)

  return { group: g, update: (t) => (pivot.rotation.y = t * 0.09) }
}

function zoneResidential(zone, beacons) {
  const g = new THREE.Group()
  const rnd = makeRng(808)

  // cul-de-sac loop
  const loop = new THREE.Mesh(ringBand(8.4, mu(9), 64, 17, 0.16), M.asphalt(1, 1))
  loop.receiveShadow = true
  g.add(loop)

  const houses = bag()
  const roofs = bag()
  const hedges = bag()
  const spots = [
    [-10.5, -2, 0.3],
    [-7.5, 8.5, -0.9],
    [0, 12, Math.PI],
    [7.5, 8.5, 0.9],
    [10.5, -2, -0.3],
    [6, -10, 2.6],
    [-6, -10, -2.6],
    [0, -13, 0],
  ]
  spots.forEach(([x, z, ry], i) => {
    const w = mu(10) + rnd() * mu(4)
    const d = mu(8.5) + rnd() * mu(3)
    const h = mu(6.4) + (i % 2) * mu(3.2)
    const rows = Math.max(2, Math.round(h / mu(3.2)))
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMat(5, rows, 'stucco'))
    body.position.set(x, h / 2 + 0.16, z)
    body.rotation.y = ry
    body.castShadow = true
    body.receiveShadow = true
    g.add(body)
    pitchedRoof(roofs, x, h + 0.16, z, w, d, mu(3.4) + rnd() * mu(1.2), ry)
    // garage + drive
    houses.add(UNIT_BOX, x + Math.cos(ry) * (w * 0.5 + mu(2.8)), mu(2.3), z - Math.sin(ry) * (w * 0.5 + mu(2.8)), {
      sx: mu(5.5),
      sy: mu(4.6),
      sz: mu(6),
      ry,
    })
    hedges.add(UNIT_BOX, x - Math.sin(ry) * (d * 0.5 + mu(2.2)), mu(0.6), z - Math.cos(ry) * (d * 0.5 + mu(2.2)), {
      sx: w + mu(2),
      sy: mu(1.2),
      sz: mu(0.5),
      ry,
    })
  })
  g.add(roofs.mesh(mat('m.tile', () => new THREE.MeshStandardMaterial({ color: '#6a3b30', roughness: 0.9, metalness: 0.05 }))))
  g.add(houses.mesh(M.concrete()))
  g.add(hedges.mesh(mat('m.hedge', () => new THREE.MeshStandardMaterial({ color: '#2f4a2a', roughness: 1, metalness: 0 }))))

  // lawn and garden trees inside the loop
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(5.6, 32), M.grass(1))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = 0.17
  lawn.receiveShadow = true
  g.add(lawn)

  const gardenTrees = bag()
  const leafBag = bag()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2
    const r = 4 + rnd() * 1.2
    const s = 0.55 + rnd() * 0.3
    gardenTrees.add(UNIT_CYL, Math.cos(a) * r, mu(2) * s + 0.17, Math.sin(a) * r, { sx: mu(0.4), sy: mu(4) * s, sz: mu(0.4) })
    leafBag.add(UNIT_SPHERE, Math.cos(a) * r, mu(5.6) * s + 0.17, Math.sin(a) * r, { sx: mu(4.4) * s, sy: mu(5) * s, sz: mu(4.4) * s })
  }
  g.add(gardenTrees.mesh(M.bark()))
  g.add(leafBag.mesh(mat('m.gardenLeaf', () => new THREE.MeshStandardMaterial({ color: '#31552f', roughness: 1 }))))

  return { group: g, update: null }
}

function zoneCities(zone, beacons) {
  const g = new THREE.Group()
  const rnd = makeRng(1337)

  // 10-14 m footprints carrying 45-125 m towers: slender, but that is what a
  // downtown block looks like from the air
  const spots = [
    [-9, -8, 4.2, 3.8, 34],
    [-1.5, -9.5, 3.6, 3.6, 22],
    [7, -7.5, 3.9, 4.2, 29],
    [10, 0.5, 3.6, 3.9, 19],
    [-10.5, 1.5, 3.9, 3.6, 26],
    [1, 0.5, 4.6, 4.6, 42],
    [-6.5, 9, 3.6, 3.3, 15],
    [7, 9, 3.9, 3.6, 21],
    [-11, -4.5, 2.6, 2.6, 10],
  ]
  spots.forEach(([x, z, w, d, h], i) => {
    place(g, beacons, x, z, {
      w,
      d,
      h,
      style: i % 3 === 0 ? 'concrete' : 'glass',
      seed: 200 + i,
      y: 0.16,
      ry: (rnd() - 0.5) * 0.35,
    })
  })

  // pocket plaza between the towers
  const sq = new THREE.Mesh(new THREE.CircleGeometry(2.8, 24), M.paving(2))
  sq.rotation.x = -Math.PI / 2
  sq.position.set(4, 0.17, 4.5)
  sq.receiveShadow = true
  g.add(sq)

  return { group: g, update: null }
}

function zoneHospitality(zone, beacons) {
  const g = new THREE.Group()

  // curved hotel block — cylinder UVs give the facade its bays for free
  const hotel = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, mu(39), 40, 1, true),
    facadeMat(18, 13, 'stucco')
  )
  hotel.position.set(-1, mu(19.5) + 0.16, -3)
  hotel.castShadow = true
  hotel.receiveShadow = true
  g.add(hotel)

  const shell = bag()
  shell.add(UNIT_CYL, -1, mu(39.6) + 0.16, -3, { sx: 16.6, sy: mu(1.2), sz: 16.6 })
  shell.add(UNIT_CYL, -1, mu(1) + 0.16, -3, { sx: 17.4, sy: mu(2), sz: 17.4 })
  // porte-cochere
  shell.add(UNIT_BOX, -1, mu(5), 9.6, { sx: mu(14), sy: mu(0.5), sz: mu(8) })
  for (const x of [-2.4, 0.4]) shell.add(UNIT_CYL, x, mu(2.5), 9.6, { sx: mu(0.7), sy: mu(5), sz: mu(0.7) })
  g.add(shell.mesh(M.paving(3)))

  // pool + deck
  const deck = new THREE.Mesh(new THREE.CircleGeometry(8.6, 40), M.paving(3))
  deck.rotation.x = -Math.PI / 2
  deck.position.set(2, 0.17, 8)
  deck.receiveShadow = true
  g.add(deck)
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.2, 40), M.water())
  pool.rotation.x = -Math.PI / 2
  pool.position.set(2, 0.22, 8)
  g.add(pool)

  const props = bag()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    props.add(UNIT_BOX, 2 + Math.cos(a) * 6.4, mu(0.7), 8 + Math.sin(a) * 6.4, { sx: mu(2), sy: mu(0.7), sz: mu(0.8), ry: -a })
  }
  g.add(props.mesh(M.white()))

  // palms
  const trunks = bag()
  const fronds = bag()
  for (const [x, z] of [[-8, 8], [10, 6], [-10.5, 2.5], [11, -1]]) {
    trunks.add(UNIT_CYL, x, mu(4.5), z, { sx: mu(0.6), sy: mu(9), sz: mu(0.6), rz: 0.08 })
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      fronds.add(UNIT_BOX, x + Math.cos(a) * mu(1.8), mu(9.4), z + Math.sin(a) * mu(1.8), {
        sx: mu(3.6),
        sy: mu(0.16),
        sz: mu(1),
        ry: -a,
        rz: -0.28,
      })
    }
  }
  g.add(trunks.mesh(mat('m.palm', () => new THREE.MeshStandardMaterial({ color: '#6a5438', roughness: 1 }))))
  g.add(fronds.mesh(mat('m.frond', () => new THREE.MeshStandardMaterial({ color: '#2f6b3c', roughness: 0.9 }))))

  return { group: g, update: null }
}

function zoneHealthcare(zone, beacons) {
  const g = new THREE.Group()

  place(g, beacons, 0, -4.5, { w: mu(30), d: mu(17), h: mu(27), style: 'concrete', seed: 401, y: 0.16 })
  place(g, beacons, -7.5, 6, { w: mu(16), d: mu(14), h: mu(15), style: 'glass', seed: 402, y: 0.16 })
  place(g, beacons, 7.5, 6, { w: mu(16), d: mu(14), h: mu(15), style: 'glass', seed: 403, y: 0.16 })

  // helipad
  const padY = mu(27) + 0.16 + mu(1.1)
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), M.asphalt(2, 2))
  pad.rotation.x = -Math.PI / 2
  pad.position.set(0, padY, -4.5)
  pad.receiveShadow = true
  g.add(pad)
  const marks = bag()
  marks.add(UNIT_BOX, -0.65, 0, -4.5, { sx: mu(0.7), sy: 0.05, sz: 1.7 })
  marks.add(UNIT_BOX, 0.65, 0, -4.5, { sx: mu(0.7), sy: 0.05, sz: 1.7 })
  marks.add(UNIT_BOX, 0, 0, -4.5, { sx: 1.3, sy: 0.05, sz: mu(0.7) })
  const h = marks.mesh(M.white())
  h.position.y = padY + 0.04
  g.add(h)
  const padRing = new THREE.Mesh(ringBand(2.2, 0.16, 48, 1, padY + 0.02), M.glow('#ffffff', 0.4, 0.75))
  padRing.position.set(0, 0, -4.5)
  g.add(padRing)

  // ambulance canopy and a lit cross on the main block
  const canopy = bag()
  canopy.add(UNIT_BOX, 0, mu(5), 4.4, { sx: mu(11), sy: mu(0.5), sz: mu(7) })
  for (const x of [-1.6, 1.6]) canopy.add(UNIT_CYL, x, mu(2.5), 5.1, { sx: mu(0.6), sy: mu(5), sz: mu(0.6) })
  g.add(canopy.mesh(M.paving(2)))

  const cross = bag()
  cross.add(UNIT_BOX, 0, 0, 0, { sx: mu(4), sy: mu(1.2), sz: mu(0.4) })
  cross.add(UNIT_BOX, 0, 0, 0, { sx: mu(1.2), sy: mu(4), sz: mu(0.4) })
  const crossMesh = cross.mesh(M.emissive(zone.color, 2.4, 4.2))
  crossMesh.position.set(0, mu(21), -4.5 + mu(8.7))
  g.add(crossMesh)

  return { group: g, update: null }
}

function zoneManufacturing(zone, beacons) {
  const g = new THREE.Group()

  // two sheds with sawtooth north-light roofs
  const shed = mat('m.shed', () => new THREE.MeshStandardMaterial({ map: tex('corrugated', 6, 2), roughness: 0.6, metalness: 0.6 }))
  const glazing = mat('m.sawtooth', () =>
    new THREE.MeshStandardMaterial({ color: '#1d2a36', roughness: 0.15, metalness: 0.7, envMapIntensity: 1.4 })
  )
  const walls = bag()
  const teeth = bag()
  const lights = bag()
  for (const [x, w] of [[-5.5, mu(21)], [5.5, mu(15)]]) {
    walls.add(UNIT_BOX, x, mu(5.5) + 0.16, 0, { sx: w, sy: mu(11), sz: mu(40) })
    for (let i = 0; i < 7; i++) {
      const z = i * mu(5.6) - 5.6
      teeth.add(UNIT_BOX, x, mu(12.6), z, { sx: w, sy: mu(4), sz: mu(3.4), rx: -0.55 })
      lights.add(UNIT_BOX, x, mu(13.2), z + mu(2.6), { sx: w - mu(0.6), sy: mu(3), sz: mu(0.3), rx: 0.5 })
    }
  }
  g.add(walls.mesh(shed))
  g.add(teeth.mesh(shed))
  g.add(lights.mesh(glazing))

  // chimneys, tanks, containers, gantry
  const yard = bag()
  const stacks = []
  for (const x of [-10.5, -8.6]) {
    yard.add(UNIT_CYL, x, mu(16), -11, { sx: mu(2.6), sy: mu(32), sz: mu(2.6) })
    yard.add(UNIT_CYL, x, mu(32.4), -11, { sx: mu(3.2), sy: mu(1.4), sz: mu(3.2) })
    stacks.push([x, mu(33.4), -11])
  }
  for (let i = 0; i < 3; i++) yard.add(UNIT_CYL, 8.5 + (i % 2) * 2.4, mu(6), -11 + i * 1.9, { sx: mu(7), sy: mu(12), sz: mu(7) })
  g.add(yard.mesh(M.steel(3)))

  const boxes = bag()
  const rnd = makeRng(77)
  for (let i = 0; i < 12; i++) {
    boxes.add(UNIT_BOX, 1 + (i % 4) * mu(2.8), mu(1.4) + ((i / 4) | 0) * mu(2.7), 11.5, { sx: mu(2.6), sy: mu(2.6), sz: mu(12), ry: 0 })
  }
  g.add(boxes.mesh(mat('m.container', () => new THREE.MeshStandardMaterial({ map: tex('corrugated', 4, 2), color: '#8a6a4a', roughness: 0.7, metalness: 0.4 }))))

  // smoke plumes
  const puffMat = () => new THREE.SpriteMaterial({ map: tex('puff'), transparent: true, depthWrite: false, opacity: 0.5 })
  const puffs = []
  stacks.forEach(([x, y, z], si) => {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(puffMat())
      s.position.set(x, y, z)
      s.scale.setScalar(1.6)
      g.add(s)
      puffs.push({ s, x, y, z, phase: (i / 5 + si * 0.3) % 1 })
    }
  })

  return {
    group: g,
    update: (t) => {
      puffs.forEach((p) => {
        const k = (p.phase + t * 0.11) % 1
        p.s.position.set(p.x + Math.sin(k * 5 + p.phase * 9) * (1 + k * 3.5) + k * 5, p.y + k * 15, p.z + k * 2.4)
        p.s.scale.setScalar(1.6 + k * 8)
        p.s.material.opacity = 0.42 * (1 - k) * Math.min(1, k * 6)
      })
    },
  }
}

function zoneDataCenters(zone, beacons) {
  const g = new THREE.Group()

  const halls = []
  for (let i = 0; i < 3; i++) {
    const b = place(g, beacons, i * 6.2 - 6.2, 0, {
      w: mu(16),
      d: mu(46),
      h: mu(9.5),
      style: 'metal',
      floorH: mu(4.7),
      bay: mu(2.6),
      seed: 500 + i,
      y: 0.16,
    })
    halls.push(b)
  }

  // rooftop chiller banks — instanced fans that actually turn
  const fanGeo = mergeGeometries([
    UNIT_BOX.clone().applyMatrix4(mtx(0, 0, 0, { sx: mu(1.9), sy: mu(0.12), sz: mu(0.3) })),
    UNIT_BOX.clone().applyMatrix4(mtx(0, 0, 0, { sx: mu(0.3), sy: mu(0.12), sz: mu(1.9) })),
  ])
  const shrouds = bag()
  const fanSpots = []
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 7; k++) {
      const x = i * 6.2 - 6.2
      const z = k * 1.9 - 5.7
      shrouds.add(UNIT_BOX, x, mu(10.6), z, { sx: mu(2.4), sy: mu(1.6), sz: mu(2.4) })
      fanSpots.push([x, mu(11.5), z])
    }
  }
  g.add(shrouds.mesh(M.darkMetal()))
  const fans = new THREE.InstancedMesh(fanGeo, M.white(), fanSpots.length)
  g.add(fans)

  // generator yard and a satellite dish
  const yard = bag()
  for (let i = 0; i < 4; i++) yard.add(UNIT_BOX, 9, mu(1.6), i * 1.9 - 2.9, { sx: mu(5), sy: mu(3.2), sz: mu(4) })
  yard.add(UNIT_CYL, -11, mu(3), 8, { sx: mu(0.6), sy: mu(6), sz: mu(0.6) })
  g.add(yard.mesh(M.steel(2)))

  const dish = new THREE.Mesh(new THREE.SphereGeometry(mu(4), 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), M.white())
  dish.position.set(-11, mu(7), 8)
  dish.rotation.set(-0.9, 0.4, 0)
  dish.castShadow = true
  g.add(dish)

  return {
    group: g,
    update: (t) => {
      fanSpots.forEach(([x, y, z], i) => fans.setMatrixAt(i, mtx(x, y, z, { ry: t * (2.4 + (i % 3) * 0.6) })))
      fans.instanceMatrix.needsUpdate = true
    },
  }
}

const ZONE_BUILDERS = {
  solar: zoneEnergy,
  field: zoneAgri,
  homes: zoneResidential,
  towers: zoneCities,
  resort: zoneHospitality,
  campus: zoneHealthcare,
  plant: zoneManufacturing,
  datacenter: zoneDataCenters,
}

/* ---------------------------------------------------------- product node -- */

function markPickable(obj, node, out) {
  obj.traverse((m) => {
    if (m.isMesh) {
      m.userData.node = node
      out.push(m)
    }
  })
}

/**
 * Products are software, not buildings — so they get a monument on the plaza:
 * a paved plinth, a steel column and a slowly turning marker above it.
 */
function buildProductNode(p) {
  const own = ctx // the light animation below outlives the build
  const g = new THREE.Group()

  const base = bag()
  base.add(UNIT_CYL, 0, mu(0.5), 0, { sx: 5.4, sy: mu(1), sz: 5.4 })
  base.add(UNIT_CYL, 0, mu(1.4), 0, { sx: 4.2, sy: mu(0.9), sz: 4.2 })
  g.add(base.mesh(M.paving(2)))

  const column = new THREE.Mesh(new THREE.CylinderGeometry(mu(1.1), mu(1.6), mu(11), 20), M.darkMetal())
  column.position.y = mu(6.4)
  column.castShadow = true
  g.add(column)

  const gemMat = mat('m.gem|' + p.color, () =>
    dual(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.color).multiplyScalar(0.25),
        emissive: new THREE.Color(p.color),
        emissiveIntensity: 1.5,
        roughness: 0.1,
        metalness: 0.7,
      }),
      'emissiveIntensity',
      1.5,
      2.6
    )
  )
  const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), gemMat)
  gem.position.y = 5.4 // no castShadow: it turns, and the shadow map is frozen
  g.add(gem)

  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.2, 0),
    mat('m.cage|' + p.color, () =>
      dual(
        new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color), wireframe: true, transparent: true, opacity: 0.24 }),
        'opacity',
        0.24,
        0.42
      )
    )
  )
  cage.position.y = 5.4
  g.add(cage)

  const ring = new THREE.Mesh(ringBand(3.4, 0.35, 64, 1, mu(2.2)), M.glow(p.color, 0.5, 0.9))
  g.add(ring)

  const pool = new THREE.Mesh(slab(11, 11), M.glow(p.color, 0.16, 0.5))
  pool.position.y = 0.13
  g.add(pool)

  const light = new THREE.PointLight(p.color, 11, 26, 2)
  light.position.y = 5.4
  g.add(light)

  return {
    group: g,
    update: (t) => {
      gem.rotation.y = t * 0.5
      gem.rotation.x = t * 0.22
      cage.rotation.y = -t * 0.3
      gem.position.y = 5.4 + Math.sin(t * 1.1) * 0.2
      cage.position.y = gem.position.y
      light.intensity = (own.night ? 26 : 9) + Math.sin(t * 1.9) * (own.night ? 8 : 3)
    },
  }
}

/* ---------------------------------------------------------- conduits ------- */

/**
 * The data links between core, products and districts. Kept faint and low —
 * they are meant to read as fibre routes over the city, not as neon arches.
 */
function buildConduits() {
  const g = new THREE.Group()
  const flows = []

  CONDUITS.forEach((c, idx) => {
    const from = new THREE.Vector3(...c.from)
    const to = new THREE.Vector3(...c.to)
    const mid = from.clone().lerp(to, 0.5)
    mid.y += 3 + from.distanceTo(to) * 0.045
    const curve = new THREE.QuadraticBezierCurve3(from.clone().setY(1.4), mid, to.clone().setY(1.4))

    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.1, 6, false),
      mat('m.conduit|' + c.color, () =>
        dual(
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(c.color),
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
          'opacity',
          0.16,
          0.34
        )
      )
    )
    g.add(tube)

    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), M.basic(c.color))
    g.add(pulse)
    flows.push({ curve, pulse, offset: (idx * 0.137) % 1, speed: 0.07 + (idx % 5) * 0.01 })
  })

  return {
    group: g,
    update: (t) => {
      flows.forEach((f) => {
        const u = (f.offset + t * f.speed) % 1
        f.pulse.position.copy(f.curve.getPoint(u))
        f.pulse.scale.setScalar(0.6 + Math.sin(u * Math.PI) * 0.7)
      })
    },
  }
}

/* ------------------------------------------------------------- drones ------ */

/** Survey quadcopters on patrol. Body and arms are merged; rotors are discs. */
function buildDrones(count = 5) {
  const g = new THREE.Group()
  const drones = []

  const shellGeo = (() => {
    const b = bag()
    b.add(UNIT_BOX, 0, 0, 0, { sx: 1.3, sy: 0.4, sz: 1.6 })
    b.add(UNIT_SPHERE, 0, -0.22, 0.4, { sx: 0.5, sy: 0.5, sz: 0.5 })
    for (const [x, z] of [[0.85, 0.85], [-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]]) {
      b.add(UNIT_BOX, x * 0.6, 0.02, z * 0.6, { sx: 0.14, sy: 0.1, sz: 1.1, ry: Math.atan2(x, z) })
      b.add(UNIT_CYL, x, 0.14, z, { sx: 0.16, sy: 0.34, sz: 0.16 })
    }
    return b
  })()

  for (let i = 0; i < count; i++) {
    const d = new THREE.Group()
    d.scale.setScalar(0.42) // authored at metre scale; a ~2 m survey quad
    d.add(shellGeo.mesh(M.darkMetal(), { shadow: false }))

    const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M.basic(i % 2 ? EM : CY))
    led.position.set(0, -0.3, -0.6)
    d.add(led)

    const rotors = []
    const rotorGeo = new THREE.CylinderGeometry(0.72, 0.72, 0.03, 12)
    const rotorMat = mat('m.rotor', () =>
      new THREE.MeshBasicMaterial({ color: '#c8d2e4', transparent: true, opacity: 0.28, depthWrite: false })
    )
    for (const [x, z] of [[0.85, 0.85], [-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]]) {
      const r = new THREE.Mesh(rotorGeo, rotorMat)
      r.position.set(x, 0.34, z)
      d.add(r)
      rotors.push(r)
    }

    g.add(d)
    drones.push({
      d,
      rotors,
      r: 44 + (i % 3) * 26,
      y: 20 + (i % 4) * 6,
      speed: 0.06 + (i % 3) * 0.022,
      phase: (i / count) * Math.PI * 2,
      dir: i % 2 ? 1 : -1,
    })
  }

  return {
    group: g,
    update: (t) => {
      drones.forEach((o) => {
        const a = o.phase + t * o.speed * o.dir
        o.d.position.set(Math.cos(a) * o.r, o.y + Math.sin(t * 0.6 + o.phase) * 1.6, Math.sin(a) * o.r)
        o.d.rotation.y = Math.atan2(-Math.sin(a) * o.dir, Math.cos(a) * o.dir)
        o.d.rotation.z = -0.12 * o.dir
        o.rotors.forEach((r, k) => (r.rotation.y = t * 46 * (k % 2 ? 1 : -1)))
      })
    },
  }
}

/* -------------------------------------------------------------- city ------- */

/**
 * Assembles the whole city.
 * @returns {{ root: THREE.Group, pickable: THREE.Mesh[], update: (t:number, camera?:THREE.Camera)=>void, dispose: ()=>void }}
 */
/**
 * @param quality per-tier density knobs from lib/explorerQuality.js. Only the
 * counts that cost real frame time are wired up — the street plan, districts
 * and landmark are the same at every tier, so the city never looks unfinished.
 */
export function buildCity(/** @type {{ quality?: Record<string, number> }} */ { quality } = {}) {
  const q = {
    terrainSegments: 140,
    trees: 1,
    traffic: 1,
    props: 1,
    skyline: 1,
    ...(quality || {}),
  }

  const own = { mats: new Map(), dayNight: [], night: false }
  ctx = own

  const root = new THREE.Group()
  const pickable = []
  const updaters = []
  const labels = []
  const beacons = []

  const { avenues } = streetBearings()

  root.add(buildTerrain(q.terrainSegments))
  const parks = buildParks(avenues)
  root.add(parks.group)
  const lake = lakeSpot(avenues)
  root.add(buildFarmland(lake))
  root.add(buildRoads(avenues))
  root.add(buildLake(lake))
  root.add(buildTrees(avenues, parks.spots, q.trees))
  root.add(buildStreetLights(avenues, q.props))
  root.add(buildSkyline(q.skyline))

  const traffic = buildTraffic(avenues, q.traffic)
  root.add(traffic.group)
  updaters.push(traffic.update)

  const landmark = buildLandmark(pickable)
  root.add(landmark.group)
  updaters.push(landmark.update)
  landmark.labels.forEach((sprite, i) => labels.push({ sprite, kind: i === 0 ? 'landmark' : 'layer' }))

  ZONES.forEach((zone) => {
    const group = new THREE.Group()
    group.add(zoneLot(zone))

    const build = ZONE_BUILDERS[zone.kind3d] || zoneDataCenters
    const district = build(zone, beacons)
    group.add(district.group)
    if (district.update) updaters.push(district.update)

    // face each district out from the centre so its frontage meets the road
    group.rotation.y = -Math.atan2(zone.pos[2], zone.pos[0]) + Math.PI / 2
    group.position.set(zone.pos[0], 0, zone.pos[2])
    markPickable(group, zone, pickable)
    root.add(group)

    const label = makeLabel(zone.name, zone.color, { scale: 0.72 })
    label.position.set(zone.pos[0], 19, zone.pos[2])
    root.add(label)
    labels.push({ sprite: label, kind: 'zone' })
  })

  PRODUCT_NODES.forEach((p) => {
    const node = buildProductNode(p)
    node.group.position.set(p.pos[0], 0.06, p.pos[2])
    markPickable(node.group, p, pickable)
    root.add(node.group)
    updaters.push(node.update)

    const label = makeLabel(p.name, p.color, { scale: 0.58, sub: 'PRODUCT' })
    label.position.set(p.pos[0], 9, p.pos[2])
    root.add(label)
    labels.push({ sprite: label, kind: 'product' })
  })

  const conduits = buildConduits()
  root.add(conduits.group)
  updaters.push(conduits.update)

  const drones = buildDrones()
  root.add(drones.group)
  updaters.push(drones.update)

  // scroll the water normals so the lake and pool are never dead still
  const waterN = tex('waterN', 3, 3)

  let primed = false

  /**
   * @param animate false freezes the city for `prefers-reduced-motion`. One
   * pass still has to run, because several builders leave their moving parts
   * at the origin for the first update to place — drones, conduit pulses and
   * the rooftop chiller fans among them. After that the per-frame instance
   * uploads (five buffers for the traffic alone) are pure waste.
   */
  const update = (t, camera, animate = true) => {
    if (animate || !primed) {
      primed = true
      for (let i = 0; i < updaters.length; i++) updaters[i](t)

      waterN.offset.set(t * 0.006, t * 0.011)
      beacons.forEach((b) => (b.mesh.visible = (t * 0.75 + b.phase) % 1 < 0.42))
    }

    if (camera) {
      // captions fade back as you pull away, so the wide shot stays a city view
      const dist = camera.position.length()
      const near = smoothstep(240, 110, dist)
      for (let i = 0; i < labels.length; i++) {
        const l = labels[i]
        const target =
          l.kind === 'product' ? 0.05 + near * 0.85 : l.kind === 'layer' ? 0.1 + near * 0.8 : l.kind === 'zone' ? 0.45 + near * 0.45 : 0.9
        l.sprite.material.opacity += (target - l.sprite.material.opacity) * 0.09
      }
    }
  }

  /** Flip this city between the day and night looks. */
  const setTimeOfDay = (mode) => {
    own.night = mode === 'night'
    for (const t of own.dayNight) t.material[t.prop] = own.night ? t.night : t.day
  }

  /*
   * Geometry, materials and the per-sprite label materials all belong to this
   * instance. Textures do not — they stay in the module cache for the next
   * mount, and `material.dispose()` leaves them alone.
   */
  const dispose = () => {
    root.traverse((o) => {
      if (o.isSprite) {
        o.material?.dispose?.()
        return
      }
      // InstancedMesh.dispose() is what frees the instance matrix and colour
      // buffers; disposing the geometry alone leaks them on every remount
      if (o.isInstancedMesh) o.dispose()
      if (o.isMesh || o.isLine || o.isPoints) o.geometry?.dispose?.()
    })
    own.mats.forEach((m) => m.dispose())
    own.mats.clear()
    own.dayNight.length = 0
  }

  ctx = null
  return { root, pickable, update, setTimeOfDay, dispose }
}

/**
 * Key light, hemisphere ambient and a cool bounce fill. The rig is created once
 * and re-aimed by `applyLightRig()` whenever the look changes.
 */
export function buildLights(scene, { shadowSize = 4096 } = {}) {
  // shadowSize 0 means the tier has turned shadow casting off completely
  // Ambient is kept deliberately low by day: the whole point of a raking
  // late-afternoon sun is the contrast between lit faces and shade, and a
  // bright sky IBL washes exactly that away.
  const hemi = new THREE.HemisphereLight('#8fb2e0', '#2b2318', 0.3)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight('#ffcb92', 21)
  sun.castShadow = shadowSize > 0
  sun.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  scene.add(sun)

  const fill = new THREE.DirectionalLight('#8fabd2', 1.8)
  scene.add(fill)

  const rig = { hemi, sun, fill }
  applyLightRig(rig, 'day')
  return rig
}

/** Point the rig at whichever look is active. */
export function applyLightRig({ hemi, sun, fill }, mode) {
  const look = LOOKS[mode] || LOOKS.day
  const dir = dirFrom(look.key)

  hemi.color.set(look.hemi.sky)
  hemi.groundColor.set(look.hemi.ground)
  hemi.intensity = look.hemi.intensity

  /*
   * Physical units: three divides light intensity by PI for diffuse, and the
   * Preetham sky's IBL is bright, so the key needs an intensity in the tens by
   * day before it can out-shout the ambient it is supposed to cast against.
   *
   * The light is also pushed well back, so it sits above the hills rather than
   * inside them — otherwise the ridges cast the whole city into shadow.
   */
  sun.color.set(look.key.color)
  sun.intensity = look.key.intensity
  sun.position.copy(dir).multiplyScalar(look.key.distance)

  const c = sun.shadow.camera
  c.near = look.key.near
  c.far = look.key.far
  c.left = -look.key.extent
  c.right = look.key.extent
  c.top = look.key.extent
  c.bottom = -look.key.extent
  c.updateProjectionMatrix()
  // the map is frozen after the first few frames, so ask for one more pass
  sun.shadow.needsUpdate = true

  // cool bounce from the opposite sky so the shadow sides never go black
  fill.color.set(look.fill.color)
  fill.intensity = look.fill.intensity
  fill.position.set(-dir.x * 200, 120, -dir.z * 200)
}
