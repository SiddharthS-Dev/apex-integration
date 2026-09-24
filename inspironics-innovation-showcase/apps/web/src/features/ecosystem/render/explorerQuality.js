/**
 * Render tiers for the ecosystem explorer.
 *
 * The city is a genuinely heavy scene — a 4K shadow map, bloom, SMAA and a few
 * thousand instanced props — and it used to render at full weight on every
 * device that could get a WebGL context. That is fine on a desktop GPU and
 * miserable on a mid-range phone, with no way out.
 *
 * So: three tiers plus a way to switch the canvas off entirely. `auto` picks a
 * tier from what the device will admit to; an explicit choice is remembered.
 * Every knob that costs real frame time lives here, so there is one place to
 * look when the scene needs to get cheaper.
 */
import { storageKeys } from '#shared/config'

const KEY = storageKeys.explorerQuality

export const TIERS = {
  high: {
    label: 'High',
    pixelRatio: 2,
    shadowSize: 4096,
    bloom: true,
    smaa: true,
    terrainSegments: 140,
    trees: 1,
    traffic: 1,
    props: 1,
    skyline: 1,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.5,
    shadowSize: 2048,
    bloom: true,
    smaa: false,
    terrainSegments: 110,
    trees: 0.62,
    traffic: 0.7,
    props: 0.7,
    skyline: 0.6,
  },
  low: {
    // No shadow map and no post-processing at all: between them they are most
    // of the per-frame cost, and the city still reads without either.
    label: 'Low',
    pixelRatio: 1,
    shadowSize: 0,
    bloom: false,
    smaa: false,
    terrainSegments: 72,
    trees: 0.3,
    traffic: 0.42,
    props: 0.45,
    skyline: 0.3,
  },
}

/** What the picker offers. `off` skips the canvas; the zone pills still work. */
export const CHOICES = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'off', label: '3D off' },
]

/**
 * Guess a tier from the device. Everything here is advisory — `deviceMemory`
 * and `hardwareConcurrency` are both optional and often rounded down — so the
 * rule is deliberately coarse and the visitor can always override it.
 */
export function detectTier() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'high'

  const mem = navigator.deviceMemory || 0 // see types/globals.d.ts
  const cores = navigator.hardwareConcurrency || 0
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const small = Math.min(window.innerWidth, window.innerHeight) < 700

  if ((mem && mem <= 2) || (cores && cores <= 2)) return 'low'
  if (coarse || small || (mem && mem <= 4) || (cores && cores <= 4)) return 'medium'
  return 'high'
}

export function loadChoice() {
  try {
    const v = localStorage.getItem(KEY)
    return CHOICES.some((c) => c.value === v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveChoice(choice) {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* private mode, or storage full — the choice just will not persist */
  }
}

/** Resolve a picker choice to a concrete tier name, or 'off'. */
export const resolveTier = (choice) => (choice === 'auto' ? detectTier() : choice)
