/**
 * Starts one Apex child process with the environment it needs.
 *
 *   node apex/run.mjs <project> api   [dev|prod] [gatewayPort]
 *   node apex/run.mjs <project> web   [dev]      [gatewayPort]
 *   node apex/run.mjs <project> build            [gatewayPort]
 *   node apex/run.mjs redirects                  [gatewayPort]   prints the Dropbox redirect URIs
 *
 * Why this exists rather than `set X=…` in start.bat: the two API servers read
 * the same variable names (PORT, DROPBOX_REDIRECT_URI) and both web apps read
 * VITE_API_BASE_URL, so values set for one would leak into the other. Here each
 * process gets exactly its own, computed from apex/projects.mjs.
 *
 * The child is started with an absolute script path, so its command line names
 * this folder — that is how stop.mjs recognises it as Apex's own.
 *
 * Dependency-free, like the gateway.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { GATEWAY_PORT, PROJECTS, dropboxRedirectUris, gatewayUrl } from './projects.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const [target, role = 'api', ...rest] = process.argv.slice(2)

const fail = (message) => {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

if (target === 'redirects') {
  const port = Number(role) || GATEWAY_PORT
  for (const { project, uri } of dropboxRedirectUris(port)) console.log(`    ${project.padEnd(20)} ${uri}`)
  process.exit(0)
}

const project = PROJECTS.find((p) => p.id === target)
if (!project) fail(`Unknown project "${target}". Known: ${PROJECTS.map((p) => p.id).join(', ')}`)

const mode = rest.find((a) => a === 'dev' || a === 'prod') || 'dev'
const port = Number(rest.find((a) => /^\d+$/.test(a))) || GATEWAY_PORT
const gateway = gatewayUrl(port)
const projectDir = path.join(ROOT, project.dir)

/** @type {{ file: string, args: string[], cwd: string, env: Record<string, string> }} */
let child

if (role === 'api') {
  const { api } = project
  if (!api) fail(`${project.name} has no API server.`)
  const cwd = path.join(projectDir, api.dir)
  child = {
    file: process.execPath,
    args: [...(api.nodeArgs || []), ...(mode === 'dev' && api.watch ? ['--watch'] : []), path.join(cwd, api.entry)],
    cwd,
    env: api.env(gateway),
  }
} else if (role === 'build') {
  // The app's own build script, not a bare `vite build`: the Showcase's runs its
  // architecture lint, typecheck, tests and bundle budget first.
  const cwd = path.join(projectDir, project.webDir || '')
  child = {
    file: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'build'],
    cwd,
    env: project.webEnv ? project.webEnv(gateway) : {},
    shell: true,
  }
} else if (role === 'web') {
  const cwd = path.join(projectDir, project.webDir || '')
  // Resolved from the app's own folder, so a workspace-hoisted vite is found too.
  // Via package.json: vite's `exports` map does not expose bin/vite.js itself.
  let vite
  try {
    vite = path.join(path.dirname(createRequire(path.join(cwd, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js')
  } catch {
    fail(`vite is not installed for ${project.name} — run npm install in "${project.dir}".`)
  }
  child = {
    file: process.execPath,
    args: [vite, ...(role === 'build' ? ['build'] : [])],
    cwd,
    env: project.webEnv ? project.webEnv(gateway) : {},
  }
} else {
  fail(`Unknown role "${role}" — use api, web or build.`)
}

const proc = spawn(child.file, child.args, {
  cwd: child.cwd,
  env: { ...process.env, ...child.env },
  stdio: 'inherit',
  windowsHide: false,
  // npm is a .cmd on Windows, which Node only runs through a shell.
  shell: child.shell === true,
})

proc.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
proc.on('error', (error) => fail(`Could not start ${project.name} ${role}: ${error.message}`))

// Ctrl+C in this window reaches the child too; make sure it does not outlive us.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => {
    if (proc.exitCode === null) proc.kill()
  })
}
