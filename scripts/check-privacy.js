import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const textExtensions = new Set(['.js', '.json', '.py', '.ps1', '.yml', '.md', '.txt'])
const excluded = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', '.local'])
const findings = []
const patterns = [
  ['personal-home', /[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\\/\s'"]+/i],
  ['credential', /\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|Bearer\s+[A-Za-z0-9._-]{20,})/],
]
// Optional private identifiers supplied by the local release auditor, never committed here.
for (const value of (process.env.PRIVACY_DENY_WORDS ?? '').split('|').filter(Boolean)) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  patterns.push(['private-identifier', new RegExp(/^[A-Za-z0-9_]+$/.test(value) ? `\\b${escaped}\\b` : escaped, 'i')])
}
function check(text, location) {
  for (const [kind, pattern] of patterns) if (pattern.test(text)) findings.push({ location, kind })
}
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name === 'TASK_CONTEXT.md') continue
    const path = join(folder, entry.name), name = relative(root, path)
    if (entry.isDirectory()) walk(path)
    else {
      if (/\.(sqlite|db|bak|log|pem|key|pyc)$|\.bak-|\.env$/i.test(entry.name)) findings.push({ location: name, kind: 'runtime-or-backup-file' })
      if (textExtensions.has(extname(path)) && name !== join('scripts', 'check-privacy.js')) check(readFileSync(path, 'utf8'), name)
    }
  }
}
walk(root)
try { check(execFileSync('git', ['log', '--all', '--format=%an <%ae> %cn <%ce>%n%B'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), 'git-history') }
catch { /* Initial extraction has no commits yet. */ }
console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2))
process.exitCode = findings.length ? 1 : 0
