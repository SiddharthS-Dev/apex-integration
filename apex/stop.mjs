/**
 * Stops Apex.
 *
 *   node apex/stop.mjs [port ...]
 *
 * Only processes that belong to *this* folder are stopped. The naive version of
 * this — kill whatever is listening on 5173/4173 — happily kills an unrelated
 * project's dev server, because 5173 and 4173 are vite's defaults and every
 * vite project on the machine wants them. So each listener's command line is
 * checked against this repo's path first, and anything else is reported and
 * left alone.
 *
 * Dependency-free, like the gateway.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATEWAY_PORT, PROD_PORT, PROJECTS } from './projects.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Compare paths case-insensitively with one slash convention. */
const norm = (s) => s.replace(/\\/g, '/').toLowerCase()
const ROOT_KEY = norm(ROOT)

const ports = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number)
const PORTS = ports.length
  ? ports
  : [GATEWAY_PORT, PROD_PORT, ...PROJECTS.map((p) => p.devPort)]

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true })
  } catch {
    return ''
  }
}

/** PIDs listening on the ports we care about, from netstat. */
function listeners() {
  const found = new Map() // pid -> Set<port>
  for (const line of run('netstat', ['-ano']).split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
    if (!m) continue
    const port = Number(m[2])
    const pid = Number(m[3])
    if (!PORTS.includes(port) || !pid) continue
    if (!found.has(pid)) found.set(pid, new Set())
    found.get(pid).add(port)
  }
  return found
}

/** Command line per PID, so we can tell our processes from someone else's. */
function commandLines(pids) {
  if (!pids.length) return new Map()
  const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ')
  const out = run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
      'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
  ])
  const map = new Map()
  for (const line of out.split(/\r?\n/)) {
    const tab = line.indexOf('\t')
    if (tab > 0) map.set(Number(line.slice(0, tab)), line.slice(tab + 1))
  }
  return map
}

const found = listeners()
const cmdlines = commandLines([...found.keys()])

let stopped = 0
const skipped = []

for (const [pid, portSet] of found) {
  const where = [...portSet].join(', ')
  const cmd = cmdlines.get(pid) || ''

  if (!norm(cmd).includes(ROOT_KEY)) {
    skipped.push({ pid, where, cmd })
    continue
  }

  // /T so the cmd wrapper around a vite server goes with it.
  run('taskkill', ['/PID', String(pid), '/T', '/F'])
  console.log(`    port ${where}  PID ${pid}  stopped`)
  stopped += 1
}

if (skipped.length) {
  console.log('')
  console.log('  Left running (not part of this folder):')
  for (const s of skipped) {
    const what = s.cmd.trim().slice(0, 96) || '<unknown>'
    console.log(`    port ${s.where}  PID ${s.pid}  ${what}`)
  }
}

console.log('')
console.log(stopped ? '  Apex stopped.' : '  Nothing of ours was running.')
