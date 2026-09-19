/**
 * Architecture guard.
 *
 * The layering in src/ is only real if something fails when it is broken, so
 * this walks every import in the tree and checks it against the rules in
 * docs/ARCHITECTURE.md. It runs as part of `npm run build`.
 *
 *   node scripts/checkArchitecture.mjs
 *
 * Deliberately dependency-free: it is a text scan, not a type checker, which
 * is enough to catch the mistakes that erode a structure — a feature reaching
 * into another feature's internals, shared code depending on a feature, or a
 * relative path climbing out of its own layer.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(full)
  }
  return out
}

/** Which architectural layer a repo-relative path belongs to. */
function layerOf(p) {
  if (p === 'src/main.jsx') return { layer: 'entry' }
  if (p.startsWith('src/app/')) return { layer: 'app' }
  if (p.startsWith('src/shared/')) return { layer: 'shared' }
  if (p.startsWith('src/features/')) return { layer: 'feature', feature: p.split('/')[2] }
  return { layer: 'other' }
}

/** Resolve an import specifier to a repo-relative path, or null if external. */
function resolveSpec(fromFile, spec) {
  let base
  if (spec.startsWith('#app/')) base = path.join(SRC, 'app', spec.slice('#app/'.length))
  else if (spec.startsWith('#features/')) base = path.join(SRC, 'features', spec.slice('#features/'.length))
  else if (spec.startsWith('#shared/')) base = path.join(SRC, 'shared', spec.slice('#shared/'.length))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // bare package specifier

  for (const cand of [base, base + '.jsx', base + '.js', path.join(base, 'index.js'), path.join(base, 'index.jsx')]) {
    try {
      if (statSync(cand).isFile()) return rel(cand)
    } catch {
      /* keep trying */
    }
  }
  return rel(base) + ' (UNRESOLVED)'
}

/**
 * A feature's public surface: its own barrel, its model barrel, and its route
 * table. Anything deeper is internal.
 */
function isPublicSurface(target, feature) {
  return [
    `src/features/${feature}/index.js`,
    `src/features/${feature}/model/index.js`,
    `src/features/${feature}/routes.jsx`,
  ].includes(target)
}

const violations = []
const add = (file, spec, message) => violations.push({ file, spec, message })

for (const abs of walk(SRC)) {
  const file = rel(abs)
  const from = layerOf(file)
  const source = readFileSync(abs, 'utf8')

  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1]
    const target = resolveSpec(abs, spec)
    if (!target) continue

    if (target.endsWith('(UNRESOLVED)')) {
      add(file, spec, 'does not resolve to a file')
      continue
    }

    const to = layerOf(target)

    // 1. shared/ is the bottom of the stack.
    if (from.layer === 'shared' && (to.layer === 'feature' || to.layer === 'app')) {
      add(file, spec, `shared/ must not depend on ${to.layer}/`)
    }

    // 2. features must not know about the composition root.
    if (from.layer === 'feature' && to.layer === 'app') {
      add(file, spec, 'features/ must not depend on app/')
    }

    // 3. a feature's internals are private to that feature.
    if (to.layer === 'feature' && !(from.layer === 'feature' && from.feature === to.feature)) {
      if (!isPublicSurface(target, to.feature)) {
        add(file, spec, `reaches into features/${to.feature} internals — import '#features/${to.feature}' instead`)
      }
    }

    // 4. relative paths must stay inside their own layer; crossing layers is
    //    what the # aliases are for, and keeps the graph greppable.
    if (spec.startsWith('.')) {
      const sameFeature = from.layer === 'feature' && to.layer === 'feature' && from.feature === to.feature
      const sameLayer = from.layer === to.layer && from.layer !== 'feature'
      if (!sameFeature && !sameLayer) {
        add(file, spec, 'relative import crosses a layer — use #app/, #features/ or #shared/')
      }
    }
  }
}

const files = walk(SRC).length
if (violations.length === 0) {
  console.log(`  ok   architecture: ${files} files, no boundary violations`)
  process.exit(0)
}

console.error(`\n  ${violations.length} architecture violation(s):\n`)
for (const v of violations) console.error(`  ${v.file}\n    import '${v.spec}'\n    ${v.message}\n`)
console.error('  See docs/ARCHITECTURE.md for the layer rules.\n')
process.exit(1)
