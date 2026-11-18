// PostToolUse: typecheck rápido tras editar .ts; silencioso si aún no hay dependencias.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
let raw = '';
for await (const c of process.stdin) raw += c;
let input = {};
try { input = JSON.parse(raw); } catch {}
const p = String(input?.tool_input?.file_path ?? '');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!/\.(ts|tsx)$/.test(p) || !existsSync(`${root}/node_modules`)) process.exit(0);
const r = spawnSync('pnpm', ['-s', '-r', 'typecheck'], { cwd: root, encoding: 'utf8', timeout: 90000 });
if (r.status !== 0) {
  process.stderr.write(((r.stdout || '') + (r.stderr || '')).split('\n').slice(-40).join('\n'));
  process.exit(2);
}
