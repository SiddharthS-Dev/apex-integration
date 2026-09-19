/**
 * Node module hook that lets the test runner import .jsx.
 *
 * `node --test` has no build step, and Node has no JSX transform, so component
 * tests need one. esbuild is already present (Vite depends on it), so this is a
 * transform rather than a new toolchain — and it keeps the tests running on
 * `node --test` with no runner config beyond this file.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

/** Let `./Thing` resolve to `./Thing.jsx`, the way the bundler does. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('#')) {
      try {
        return await nextResolve(specifier + '.jsx', context)
      } catch {
        /* fall through to the original failure */
      }
    }
    throw error
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.jsx')) return nextLoad(url, context)

  const source = await readFile(fileURLToPath(url), 'utf8')
  const { code } = await transform(source, {
    loader: 'jsx',
    jsx: 'automatic',
    format: 'esm',
    target: 'esnext',
    sourcefile: url,
    sourcemap: 'inline',
  })
  return { format: 'module', shortCircuit: true, source: code }
}
