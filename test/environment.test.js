import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createWorkers } from '../lib/render-worker.js'
import { temp, picture, python } from './helpers.js'

test('Windows PowerShell 5 can parse the UTF-8 file picker', { skip: process.platform !== 'win32' }, () => {
  const script = fileURLToPath(new URL('../lib/pick_images.ps1', import.meta.url))
  const command = `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|Out-String|Write-Output;exit 1}`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
})

test('missing custom font produces an explicit sprite error', async () => {
  const dir = temp('fonts'), manifest = join(dir, 'manifest.json')
  writeFileSync(manifest, JSON.stringify({ fonts: { absent: { path: 'not-installed.ttf' } }, styles: { narration: 'absent' }, fallbacks: {} }))
  const workers = createWorkers({ dataDir: dir, toolsDir: fileURLToPath(new URL('../tools', import.meta.url)), pythonPath: python, fontManifest: manifest })
  try {
    const result = await workers.sprite({ layer: { text: 'Hello', kind: 'narration', font: 'narration', font_size: 36, max_width: 200 }, language: 'en' })
    assert.ok(result.error || result.missing?.length)
    assert.equal(result.sig, null)
  } finally { await workers.close() }
})

test('enabled analysis with no installed weights never claims successful person detection', async () => {
  const dir = temp('detection'), image = join(dir, 'sample.png')
  picture(image)
  const workers = createWorkers({ dataDir: dir, toolsDir: fileURLToPath(new URL('../tools', import.meta.url)),
    pythonPath: python, detectionEnabled: true, modelDir: join(dir, 'absent-models') })
  try {
    // Optional dependencies may be absent too. Either explicit failure or available:false is valid.
    try { const result = await workers.analyze({ path: image }); assert.equal(result.available, false) }
    catch (error) { assert.match(error.message, /进程|module|Module|numpy|cv2|启动|退出|ENOENT/) }
  } finally { await workers.close() }
})
