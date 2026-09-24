/**
 * `npm run dev` — the API on :4100 and Vite on :5180, in one terminal.
 *
 * A dozen lines instead of a `concurrently` dependency: each child's output is
 * prefixed so the two logs stay readable, and if either one exits the other is
 * stopped too, so a crashed API never leaves a web server proxying to nothing.
 */
import { spawn } from 'node:child_process'

const children = [
  { name: 'api', color: 36, args: ['run', 'dev', '-w', '@inspironics/api'] },
  { name: 'web', color: 35, args: ['run', 'dev', '-w', '@inspironics/web'] },
].map(({ name, color, args }) => {
  const child = spawn('npm', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: true })
  const tag = `\x1b[${color}m[${name}]\x1b[0m `
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      const lines = buf.split(/\r?\n/)
      buf = lines.pop()
      for (const line of lines) out.write(tag + line + '\n')
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited with code ${code}\n`)
    shutdown(code ?? 0)
  })
  return child
})

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const c of children) if (c.exitCode === null) c.kill()
  process.exitCode = code
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
