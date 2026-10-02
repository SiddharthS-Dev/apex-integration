// Runs the API (:4000) and the web dev server (:5173) together with prefixed output.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', '\x1b[36m', ['run', 'dev', '-w', '@academy/api']],
  ['web', '\x1b[35m', ['run', 'dev', '-w', '@academy/web']],
].map(([name, color, args]) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) out.write(prefix + line + '\n');
  });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
