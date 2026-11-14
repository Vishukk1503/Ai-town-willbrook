import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'node_modules/convex/bin/main.js')) ||
    !existsSync(path.join(root, '.env.local'))) {
  console.error('Complete the new-PC setup in WILLOWBROOK-HANDOFF.md first.');
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const args of [
  ['node_modules/convex/bin/main.js', 'dev', '--tail-logs', 'disable'],
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
]) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log('Willowbrook: http://127.0.0.1:5173/ai-town — keep this terminal open.');
console.log('This launcher starts services; it does not initialize or resume the world.');
