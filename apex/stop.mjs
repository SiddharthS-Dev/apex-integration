/**
 * Stops Apex.
 *
 *   node apex/stop.mjs [port ...]     stop everything Apex is running
 *   node apex/stop.mjs --quiet        say nothing unless something was stopped
 *
 * Only processes that belong to *this* folder are stopped. The naive version of
 * this — kill whatever is listening on 5173/4173 — happily kills an unrelated
 * project's dev server, because 5173 and 4173 are vite's defaults and every
 * vite project on the machine wants them. So each listener's command line is
 * checked against this repo's path first, and anything else is reported and
 * left alone.
 *
 * Also imported as a module: start.bat clears its own leftovers this way, and
 * the gateway uses it to take the child dev servers down when it exits.
 *
 * Dependency-free, like the gateway.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GATEWAY_PORT, PROD_PORT, PROJECTS } from './projects.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Compare paths case-insensitively with one slash convention. */
const norm = (s) => s.replace(/\\/g, '/').toLowerCase()
const ROOT_KEY = norm(ROOT)

/** Every port Apex might be holding. */
export const ALL_PORTS = [GATEWAY_PORT, PROD_PORT, ...PROJECTS.map((p) => p.devPort), ...PROJECTS.filter((p) => p.api).map((p) => p.api.port)]

/** The projects' own API servers. They run in dev and prod alike. */
export const API_PORTS = PROJECTS.filter((p) => p.api).map((p) => p.api.port)

/** Just the child servers — the gateway must never be asked to kill itself. */
export const CHILD_PORTS = [...PROJECTS.map((p) => p.devPort), ...API_PORTS]

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true })
  } catch {
    return ''
  }
}

/** PIDs listening on the ports we care about, from netstat. */
function listeners(ports) {
  const found = new Map() // pid -> Set<port>
  for (const line of run('netstat', ['-ano']).split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
    if (!m) continue
    const port = Number(m[2])
    const pid = Number(m[3])
    if (!ports.includes(port) || !pid) continue
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

/**
 * Stops Apex's own listeners on `ports`.
 *
 * @param {number[]} ports
 * @param {{ exclude?: number[] }} [options] PIDs to leave alone (a caller that is
 *   itself listening, for instance).
 * @returns {{ stopped: {pid:number,ports:string}[], foreign: {pid:number,ports:string,cmd:string}[] }}
 */
export function stopApex(ports = ALL_PORTS, { exclude = [] } = {}) {
  const found = listeners(ports)
  for (const pid of exclude) found.delete(pid)

  const cmdlines = commandLines([...found.keys()])
  const stopped = []
  const foreign = []

  for (const [pid, portSet] of found) {
    const where = [...portSet].join(', ')
    const cmd = (cmdlines.get(pid) || '').trim()

    if (!norm(cmd).includes(ROOT_KEY)) {
      foreign.push({ pid, ports: where, cmd })
      continue
    }

    // /T so the cmd wrapper around a vite server goes with it.
    run('taskkill', ['/PID', String(pid), '/T', '/F'])
    stopped.push({ pid, ports: where })
  }

  return { stopped, foreign }
}

/* ------------------------------------------------------------------- CLI -- */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const quiet = process.argv.includes('--quiet')
  const asked = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number)
  const { stopped, foreign } = stopApex(asked.length ? asked : ALL_PORTS)

  for (const s of stopped) console.log(`    port ${s.ports}  PID ${s.pid}  stopped`)

  if (foreign.length && !quiet) {
    console.log('')
    console.log('  Left running (not part of this folder):')
    for (const f of foreign) console.log(`    port ${f.ports}  PID ${f.pid}  ${f.cmd.slice(0, 96) || '<unknown>'}`)
  }

  if (!quiet) {
    console.log('')
    console.log(stopped.length ? '  Apex stopped.' : '  Nothing of ours was running.')
  } else if (stopped.length) {
    console.log(`  Cleared ${stopped.length} leftover process(es) from a previous run.`)
  }
}
