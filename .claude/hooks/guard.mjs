// PreToolUse: bloquea secretos y pide confirmación al tocar el contrato.
let raw = '';
for await (const c of process.stdin) raw += c;
let input = {};
try { input = JSON.parse(raw); } catch {}
const p = String(input?.tool_input?.file_path ?? '').replace(/\\/g, '/');
const out = (decision, reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
};
if (/(^|\/)\.env($|\.)/.test(p) && !/\.env\.example$/.test(p)) {
  out('deny', 'Nunca escribas secretos en el repo: usa .env.example y variables de entorno.');
}
if (/packages\/schema\/src\//.test(p)) {
  out('ask', 'Cambio de contrato (packages/schema): confirma y recuerda ejecutar los tests de adaptadores y API (skill contract-change).');
}
process.exit(0);
