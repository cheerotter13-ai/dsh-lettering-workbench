

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { constants as osConstants, setPriority } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const PRIORITY = { sprite: 0, compose: 1, measure: 2, imageInfo: 2, thumb: 3 }
export const TIMEOUTS = {
  sprite: 10_000, measure: 10_000, compose: 60_000, thumb: 20_000,
  imageInfo: 10_000, analyze: 120_000, ping: 10_000,
}
const READY_TIMEOUT = 30_000
const CODE_FILES = ['typeset_stroke.py', 'typeset_worker.py']
const SPRITE_MEMO = 4000

export function spriteSig(layer, language, codeHash, fontsHash) {
  const key = [
    layer.text, layer.font ?? layer.kind ?? 'dialogue', layer.font_size ?? 40, layer.max_width ?? 600,
    layer.letter_spacing ?? 0, layer.rotation ?? 0, layer.mode ?? 'horizontal', layer.color ?? '#000000',
    language, codeHash, fontsHash,
  ]
  return createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 40)
}

function logFunction(logger) {
  if (typeof logger === 'function') return logger
  return message => (logger?.warn ?? logger?.info)?.call(logger, message)
}

function delay(ms) {
  let timer
  const promise = new Promise(done => { timer = setTimeout(done, ms) })
  return { promise, cancel: () => clearTimeout(timer) }
}

function createLane({ name, script, pythonPath, spawnImpl, log, timeouts, readyTimeout, onSpawn, isStale, env = {} }) {
  const queue = []
  let proc = null
  let busy = false
  let closed = false
  let nextId = 1
  let order = 0

  function finish(job, error, result) {
    if (job.settled) return
    job.settled = true
    clearTimeout(job.timer)
    if (error) job.reject(error)
    else job.resolve(result)
    job.release?.()
  }

  function spawnProcess() {
    const child = spawnImpl(pythonPath, ['-X', 'utf8', '-u', script], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', CW_PARENT_PID: String(process.pid), ...env },
    })
    const p = { child, hello: null, current: null, dead: false, stderr: '' }
    p.ready = new Promise((ok, fail) => { p.onReady = ok; p.onFail = fail })
    p.ready.catch(() => {})
    p.gone = new Promise(done => { p.onGone = done })
    const readyTimer = setTimeout(() => kill(p, new Error(`${name} 启动超时`)), readyTimeout)

    p.die = error => {
      if (p.dead) return
      p.dead = true
      clearTimeout(readyTimer)
      if (proc === p) proc = null
      p.onFail(error)
      if (p.current) finish(p.current, error)
    }
    let buffer = ''
    child.stdout.setEncoding?.('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim()
        buffer = buffer.slice(end + 1)
        if (line) onLine(p, line, readyTimer)
      }
    })
    child.stderr?.setEncoding?.('utf8')
    child.stderr?.on('data', chunk => {
      p.stderr = (p.stderr + chunk).slice(-2000)
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log(`${name}: ${line}`)
    })
    child.stdin.on?.('error', error => log(`${name} stdin: ${error.message}`))
    child.on('error', error => { p.die(error); p.onGone() })
    child.on('exit', (code, signal) => {
      const tail = p.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
      p.die(new Error(`${name} 进程退出 (${code ?? signal})${tail ? `: ${tail}` : ''}`))
      p.onGone()
    })
    onSpawn?.(child)
    return p
  }

  function onLine(p, line, readyTimer) {
    let message
    try { message = JSON.parse(line) } catch { return log(`${name}: ${line}`) }
    if (message.ready) {
      clearTimeout(readyTimer)
      p.hello = message
      return p.onReady(message)
    }
    const job = p.current
    if (!job || message.id !== job.id) return log(`${name}: 未知回复 ${line.slice(0, 200)}`)
    p.current = null
    if (message.ok) finish(job, null, message.result)
    else finish(job, new Error(message.error || `${job.cmd} 失败`))
  }

  function kill(p, error) {
    p.die(error)
    try { p.child.kill() } catch {                    }
  }

  async function run(job) {
    if (proc && isStale?.()) kill(proc, new Error(`${name} 代码或字体已更新，重启`))
    let p
    try {
      p = proc ?? (proc = spawnProcess())
      await p.ready
    } catch (error) {
      if (p && proc === p) kill(p, error)
      return finish(job, error)
    }
    if (job.settled) return
    if (p.dead) return finish(job, new Error(`${name} 进程已退出`))
    await new Promise(release => {
      job.release = release
      p.current = job
      const ms = timeouts[job.cmd] ?? 30_000
      job.timer = setTimeout(() => {
        const error = Object.assign(new Error(`${job.cmd} 超时 (${ms / 1000}s)`), { code: 'timeout' })
        kill(p, error)
      }, ms)
      p.child.stdin.write(JSON.stringify({ id: job.id, cmd: job.cmd, args: job.args }) + '\n')
    })
  }

  function takeNext() {
    let best = 0
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i]
      const b = queue[best]
      if (a.priority < b.priority || a.priority === b.priority && a.seq < b.seq) best = i
    }
    return queue.splice(best, 1)[0]
  }

  async function pump() {
    if (busy || closed || !queue.length) return
    busy = true
    try {
      await run(takeNext())
    } finally {
      busy = false
      pump()
    }
  }

  function enqueue(cmd, args, priority = 0, extra = {}) {
    if (closed) return { promise: Promise.reject(new Error(`${name} 已关闭`)), job: null }
    let job
    const promise = new Promise((resolveJob, rejectJob) => {
      job = { id: nextId++, seq: order++, cmd, args, priority, resolve: resolveJob, reject: rejectJob, settled: false, ...extra }
    })
    queue.push(job)
    queueMicrotask(pump)
    return { promise, job }
  }

  function drop(match, value = null) {
    let count = 0
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!match(queue[i])) continue
      finish(queue.splice(i, 1)[0], null, value)
      count++
    }
    return count
  }

  async function close() {
    if (closed) return proc?.gone
    closed = true
    for (const job of queue.splice(0)) {
      if (job.kind === 'prefetch') finish(job, null, null)
      else finish(job, new Error(`${name} 已关闭`))
    }
    const p = proc
    if (!p) return
    kill(p, new Error(`${name} 已关闭`))
    const wait = delay(3000)
    await Promise.race([p.gone, wait.promise])
    wait.cancel()
  }

  const status = () => proc && !proc.dead ? { pid: proc.child.pid, ...proc.hello, queued: queue.length } : null
  return { enqueue, drop, close, status, queue }
}

export function createWorkers({ pythonPath = 'python', dataDir, toolsDir, logger, spawnImpl = spawn,
  timeouts = {}, readyTimeout = READY_TIMEOUT, fontManifest, detectionEnabled = false, modelDir = null } = {}) {
  if (!dataDir || !toolsDir) throw new Error('createWorkers 需要 dataDir 和 toolsDir')
  const log = logFunction(logger)
  const manifestPath = fontManifest ?? resolve(toolsDir, '..', 'assets', 'fonts', 'manifest.json')
  const spriteDir = join(dataDir, 'sprites')
  const limits = { ...TIMEOUTS, ...timeouts }
  const memo = new Map()
  const pendingSprites = new Map()
  let files = null
  let spawnStamp = null

  function fileStat(path) {
    try {
      const stat = statSync(path, { bigint: true })
      return { size: stat.size, ms: stat.mtimeNs / 1_000_000n }
    } catch {
      return { size: -1n, ms: -1n }
    }
  }

  function fontEntries(manifestText) {
    try {
      const manifest = JSON.parse(manifestText.replace(/^﻿/, ''))
      return Object.entries(manifest.fonts ?? {}).map(([key, entry]) =>
        [key, isAbsolute(entry.path) ? entry.path : resolve(manifestPath, '..', entry.path)])
    } catch {
      return []
    }
  }

  function fileState() {
    const watched = [...CODE_FILES.map(name => join(toolsDir, name)), manifestPath]
    let stamp = watched.map(path => { const s = fileStat(path); return `${s.size}:${s.ms}` }).join('|')
    const fonts = files && files.stamp.startsWith(stamp + '#') ? files.fonts : null
    const entries = fonts ?? fontEntries(existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '')
    const fontPart = entries.map(([key, path]) => { const s = fileStat(path); return `${key}\t${s.size}\t${s.ms}` })
    stamp += '#' + fontPart.join('\n')
    if (files?.stamp === stamp) return files
    const code = createHash('sha256')
    for (const name of CODE_FILES) {
      try { code.update(readFileSync(join(toolsDir, name))) } catch {                              }
    }
    const fontsHash = createHash('sha256')
    try { fontsHash.update(readFileSync(manifestPath)) } catch {                   }
    for (const line of fontPart) fontsHash.update('\n' + line)
    files = { stamp, fonts: entries, code_hash: code.digest('hex'), fonts_hash: fontsHash.digest('hex') }
    return files
  }

  const render = createLane({
    env: { LETTERING_FONT_MANIFEST: manifestPath }, name: '渲染进程', script: join(toolsDir, 'typeset_worker.py'), pythonPath, spawnImpl, log,
    timeouts: limits, readyTimeout,
    onSpawn: () => { spawnStamp = fileState().stamp },
    isStale: () => fileState().stamp !== spawnStamp,
  })
  const analysis = createLane({
    env: { LETTERING_FONT_MANIFEST: manifestPath, LETTERING_MODEL_DIR: modelDir ?? '' }, name: '画面分析进程', script: join(toolsDir, 'scene_analysis.py'), pythonPath, spawnImpl, log,
    timeouts: limits, readyTimeout,
    onSpawn: child => {
      if (!child.pid) return
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL) } catch (error) {
        log(`画面分析进程: 无法降低优先级 ${error.message}`)
      }
    },
  })
  const analyses = new Map()

  function remember(sig, entry) {
    memo.set(sig, entry)
    if (memo.size > SPRITE_MEMO) memo.delete(memo.keys().next().value)
    return entry
  }

  function cachedSprite(sig, path) {
    try {
      if (!existsSync(path)) return null
      const meta = JSON.parse(readFileSync(path.replace(/\.png$/, '.json'), 'utf8'))
      return remember(sig, { sig, path, width: meta.width, height: meta.height, fonts: meta.fonts ?? [], missing: [] })
    } catch {
      return null
    }
  }

  async function renderSprite(sig, path, layer, language) {
    const result = await render.enqueue('sprite', { layer, language, output: path }, PRIORITY.sprite).promise
    if (result.error) {
      const failed = { sig: null, path: null, width: 0, height: 0, fonts: [], missing: result.missing ?? [], error: result.error }
      if (result.errors) failed.errors = result.errors
      return remember(sig, failed)
    }
    return remember(sig, { sig, path, width: result.width, height: result.height, fonts: result.fonts ?? [], missing: [] })
  }

  return {
    async sprite({ layer, language = 'zh' }) {
      const { code_hash: codeHash, fonts_hash: fontsHash } = fileState()
      const sig = spriteSig(layer, language, codeHash, fontsHash)
      const path = join(spriteDir, `${sig}.png`)
      const known = memo.get(sig)
      if (known && (!known.sig || existsSync(known.path))) return known
      const cached = cachedSprite(sig, path)
      if (cached) return cached
      if (!pendingSprites.has(sig)) {
        const pending = renderSprite(sig, path, layer, language).finally(() => pendingSprites.delete(sig))
        pendingSprites.set(sig, pending)
      }
      return pendingSprites.get(sig)
    },
    measure: ({ layer, language = 'zh', widths }) =>
      render.enqueue('measure', { layer, language, widths }, PRIORITY.measure).promise,
    compose: ({ input, output, document }) =>
      render.enqueue('compose', { input, output, document }, PRIORITY.compose).promise,
    thumb: ({ input, output, size = 240 }) =>
      render.enqueue('thumb', { input, output, size }, PRIORITY.thumb).promise,
    imageInfo: ({ path }) => render.enqueue('imageInfo', { path }, PRIORITY.imageInfo).promise,

    analyze({ path, sha }, { priority = 'now' } = {}) {
      if (!detectionEnabled) return Promise.resolve({ available: false, status: 'disabled', people: [], grid: null })
      const key = `${String(path).toLowerCase()}|${sha ?? ''}`
      const kind = priority === 'prefetch' ? 'prefetch' : 'now'
      let entry = analyses.get(key)
      if (entry && !entry.job.settled) {
        if (kind === 'now' && entry.job.kind === 'prefetch') Object.assign(entry.job, { kind: 'now', priority: 0 })
      } else {
        entry = analysis.enqueue('analyze', { path, sha }, kind === 'now' ? 0 : 1, { kind })
        if (!entry.job) return kind === 'now' ? entry.promise : entry.promise.catch(() => null)
        analyses.set(key, entry)
        const forget = () => { if (analyses.get(key) === entry) analyses.delete(key) }
        entry.promise.then(forget, forget)
        entry.quiet = entry.promise.catch(error => { log(`画面预取失败: ${error.message}`); return null })
      }
      return kind === 'now' ? entry.promise : entry.quiet
    },

    cancelPrefetch() {
      analysis.drop(job => job.kind === 'prefetch', null)
    },
    async hashes() {
      const { code_hash: codeHash, fonts_hash: fontsHash } = fileState()
      return { code_hash: codeHash, fonts_hash: fontsHash }
    },
    status: () => ({ render: render.status(), analysis: analysis.status() }),
    async close() {
      await Promise.all([render.close(), analysis.close()])
    },
  }
}
