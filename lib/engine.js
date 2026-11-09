import { randomUUID, createHash } from 'node:crypto'
import {
  mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, statSync, readdirSync, renameSync, rmSync,
  openSync, readSync, closeSync,
} from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir, homedir } from 'node:os'
import { Store, translationGaps } from './store.js'
import * as layoutLib from './layout.js'
import * as stickerLib from './stickers.js'
import { importPlan, publishFinal } from './image_import.js'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const API = '/plugins/lettering-workbench/api'
const LANGUAGES = ['zh', 'en', 'ja', 'ko']
const KINDS = ['dialogue', 'thought', 'narration', 'sfx']

const SCENE_CACHE = 'scene4:'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const GC_NAME = /^[0-9a-f]{16}-\d+-(zh|en|ja|ko)(-preview\.png|-final\.png|\.json|-layers)$/
const DAY = 24 * 3600 * 1000
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const hashText = text => createHash('sha256').update(text).digest('hex')
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const byOrder = (a, b) => a.order - b.order
const keyOf = shotId => hashText(shotId).slice(0, 16)

export const STYLE_DEFAULTS = {
  dialogue: { font: 'wenkai', size_ratio: 0.042 },
  thought: { font: 'wenkai', size_ratio: 0.036 },
  narration: { font: 'wenkai', size_ratio: 0.034 },
  sfx: { font: 'wenkai', size_ratio: 0.06 },
}

export function pngSize(path) {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(24)
    if (readSync(fd, head, 0, 24, 0) < 24 || !head.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
  } finally { closeSync(fd) }
}

export function imageSize(path) {
  const size = pngSize(path)
  if (!size) throw new Error('当前图不是有效 PNG')
  return size
}

const optionalCache = new Map()
function optional(path, logger) {
  if (!optionalCache.has(path)) {

    optionalCache.set(path, import(path).catch(error => {
      logger?.warn?.(`工作台可选模块 ${path} 未加载: ${error.message}`)
      return null
    }))
  }
  return optionalCache.get(path)
}

function estimateMeasure(layer, widths) {
  const size = layer.font_size ?? 40, spacing = layer.letter_spacing ?? 0
  const lines = String(layer.text ?? '').split('\n')
  return widths.map(max_width => {
    const perLine = Math.max(1, Math.floor(max_width / (size + spacing)))
    const counts = lines.map(line => Math.max(1, [...line].length))
    const rows = counts.reduce((sum, n) => sum + Math.ceil(n / perLine), 0)
    const width = Math.min(max_width, Math.max(...counts.map(n => Math.min(n, perLine))) * (size + spacing)) + 8
    return { max_width, width, height: Math.round(rows * size * 1.25) + 8 }
  })
}

export function createWorkbench(ctx, options = {}) {
  const config = { dataDir: join(homedir(), '.dsh-lettering-workbench'), pythonPath: 'python',
    renderer: join(root, 'tools', 'typeset_stroke.py'), fontManifest: join(root, 'assets', 'fonts', 'manifest.json'), detectionEnabled: false, ...options }
  mkdirSync(config.dataDir, { recursive: true })
  const store = new Store(join(config.dataDir, 'workbench.sqlite'))
  const logger = ctx.logger
  let closed = false
  const listeners = new Map()
  function subscribe(workId, fn) {
    if (!listeners.has(workId)) listeners.set(workId, new Set())
    listeners.get(workId).add(fn)
    return () => {
      listeners.get(workId)?.delete(fn)
      if (!listeners.get(workId)?.size) listeners.delete(workId)
    }
  }
  function publish(workId, event) {
    for (const fn of [...(listeners.get(workId) ?? [])]) {
      try { fn(event) } catch (error) { logger?.warn?.(`工作台推送失败: ${error.message}`) }
    }
  }
  store.onChange = row => publish(row.work_id, { type: 'change', ...row })

  function freeTitle(base) {
    const taken = new Set(store.works().map(work => work.title))
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base} (${n})`)) n += 1
    return `${base} (${n})`
  }

  let loadedWorkers = null, workerPromise = null
  function legacyWorkers() {
    return {
      async sprite() { return { sig: null, path: null, missing: [], error: 'worker_unavailable' } },
      async measure({ layer, widths }) { return estimateMeasure(layer, widths) },
      async compose({ input, output, document }) {
        const layoutPath = `${output}.json`
        writeFileSync(layoutPath, JSON.stringify(document))
        try {
          const { stdout } = await run(config.pythonPath, ['-X', 'utf8', config.renderer, '-i', input, '-o', output, '--layout', layoutPath, '--allow-invalid'],
            { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
          return JSON.parse(stdout)
        } catch (error) {
          try { return JSON.parse(error.stdout) } catch { throw new Error(`渲染失败: ${error.message}`) }
        } finally { rmSync(layoutPath, { force: true }) }
      },
      async thumb({ input, output, size = 240 }) {
        const script = 'from PIL import Image\nimport sys\nwith Image.open(sys.argv[1]) as im:\n  im=im.convert("RGB"); im.thumbnail((int(sys.argv[3]),)*2); im.save(sys.argv[2], "JPEG", quality=72); print(im.size[0], im.size[1])'
        const { stdout } = await run(config.pythonPath, ['-c', script, input, output, String(size)], { windowsHide: true })
        const [width, height] = stdout.trim().split(/\s+/).map(Number)
        return { output, width, height }
      },
      async imageInfo({ path }) {
        const script = 'from PIL import Image\nimport sys\nwith Image.open(sys.argv[1]) as im: print(im.size[0], im.size[1])'
        const { stdout } = await run(config.pythonPath, ['-c', script, path], { windowsHide: true })
        const [width, height] = stdout.trim().split(/\s+/).map(Number)
        return { width, height }
      },
      async analyze({ sha: imageSha }) { return { version: 1, sha: imageSha, available: false, people: [], grid: null } },
      cancelPrefetch() {},
      async hashes() { return { code_hash: sha(config.renderer), fonts_hash: sha(config.fontManifest) } },
      async close() {},
    }
  }
  function loadWorkers() {
    if (loadedWorkers) return Promise.resolve(loadedWorkers)
    workerPromise ??= (async () => {
      let made = config.workers
      if (!made) {
        const mod = await optional('./render-worker.js', logger)
        made = typeof mod?.createWorkers === 'function'
          ? mod.createWorkers({ pythonPath: config.pythonPath, dataDir: config.dataDir, toolsDir: dirname(config.renderer), fontManifest: config.fontManifest, detectionEnabled: config.detectionEnabled, modelDir: config.modelDir, logger })
          : legacyWorkers()
      }
      if (closed) { await made.close?.(); throw new Error('工作台已关闭') }
      loadedWorkers = made
      return made
    })()
    return workerPromise
  }
  const workers = {
    cancelPrefetch() { loadedWorkers?.cancelPrefetch?.() },
    async close() { const w = loadedWorkers ?? config.workers; loadedWorkers = null; await w?.close?.() },
  }
  for (const name of ['sprite', 'measure', 'compose', 'thumb', 'imageInfo', 'analyze', 'hashes']) {
    workers[name] = async (...args) => (await loadWorkers())[name](...args)
  }

  const shaMemo = new Map(), sizeMemo = new Map()
  function fileSha(path) {
    const st = statSync(path), key = `${resolve(path).toLowerCase()}|${st.mtimeMs}|${st.size}`
    if (!shaMemo.has(key)) {
      if (shaMemo.size > 4000) shaMemo.clear()
      shaMemo.set(key, sha(path))
    }
    return shaMemo.get(key)
  }
  const safeSha = path => { try { return path && existsSync(path) ? fileSha(path) : null } catch { return null } }

  async function sizeOfPath(path, { persist = true } = {}) {
    const st = statSync(path), key = `imgsize:${resolve(path).toLowerCase()}`
    const fresh = record => record && record.mtimeMs === st.mtimeMs && record.size === st.size
    if (fresh(sizeMemo.get(key))) return { width: sizeMemo.get(key).width, height: sizeMemo.get(key).height }
    let record = store.meta(key)
    if (!fresh(record)) {
      const size = pngSize(path) ?? await workers.imageInfo({ path })
      record = { width: size.width, height: size.height, mtimeMs: st.mtimeMs, size: st.size }
      if (persist && !closed) store.meta(key, record)
    }
    sizeMemo.set(key, record)
    return { width: record.width, height: record.height }
  }
  function knownSize(shot) {
    if (shot.image_width && shot.image_height) return { width: shot.image_width, height: shot.image_height }
    if (!shot.image) return null
    const memo = sizeMemo.get(`imgsize:${resolve(shot.image).toLowerCase()}`)
    return memo ? { width: memo.width, height: memo.height } : null
  }
  async function sizeOfShot(shot, { persist = false } = {}) {
    const known = knownSize(shot)
    if (known) return known
    if (shot.image && existsSync(shot.image)) {
      try { return await sizeOfPath(shot.image, { persist }) } catch (error) { logger?.warn?.(`读取图片尺寸失败: ${error.message}`) }
    }
    return { width: 1216, height: 832 }
  }

  let manifestMemo = null
  function manifest() {
    const mtime = statSync(config.fontManifest).mtimeMs
    if (manifestMemo?.mtime !== mtime) manifestMemo = { mtime, value: JSON.parse(readFileSync(config.fontManifest, 'utf8').replace(/^\uFEFF/, '')) }
    return manifestMemo.value
  }

  function settings(work) {
    const saved = work?.settings ?? {}, styles = {}
    for (const kind of KINDS) styles[kind] = { ...STYLE_DEFAULTS[kind], ...(saved.styles?.[kind] ?? {}) }
    return { read_only: false, ...saved, styles }
  }
  function letteredPathOf(work, shot) {
    if (work.source?.kind !== 'images' || !shot.image) return null
    const outputDir = work.source.output_dir ?? join(dirname(work.source.folder), '嵌字成品')
    return join(outputDir, `${shot.id}.png`)
  }
  

  function protection(shot) { return store.finalized(shot.id) ? '已定稿' : null }
  function statusOf(shot, record) {
    if (record && record.version === shot.version) return 'final'
    if (record) return 'stale'
    return shot.dialogues.length ? 'draft' : 'empty'
  }

  const planMemo = new Map(), lastPlans = new Map()
  function previousLayers(shot, language) {
    const prev = store.previousShot(shot.id)
    if (!prev) return []
    return (prev.layouts?.[language]?.layers ?? []).map(layer => {
      const d = prev.dialogues.find(item => item.id === layer.dialogue_id)
      return { speaker_id: d?.speaker_id ?? null, kind: d?.kind ?? 'dialogue', x: layer.x, y: layer.y, max_width: layer.max_width }
    })
  }
  function sceneCached(shot) {
    const imageSha = safeSha(shot.image)
    return imageSha ? store.meta(`${SCENE_CACHE}${imageSha}`) : null
  }
  const measureFor = language => async (layer, widths) => {
    try { return await workers.measure({ layer, language, widths }) } catch { return estimateMeasure(layer, widths) }
  }
  function fallbackLayer(dialogue, index, size) {
    return { dialogue_id: dialogue.id, x: 24, y: 24 + index * 72, font_size: dialogue.kind === 'sfx' ? 48 : 36, font: dialogue.kind,
      mode: 'horizontal', rotation: dialogue.kind === 'sfx' ? -8 : 0, letter_spacing: 0, color: '#222222',
      max_width: Math.max(16, Math.min(600, size.width - 48)), locked: false }
  }
  function fallbackFor(shot, id, size) {
    const sorted = [...shot.dialogues].sort(byOrder), index = sorted.findIndex(d => d.id === id)
    return index < 0 ? null : fallbackLayer(sorted[index], index, size)
  }
  function legacyPlan(shot, work, language, size, only) {
    const layout = shot.layouts?.[language]
    const regions = layout?.manual_regions_confirmed ? layout.regions : shot.visual?.regions ?? layout?.regions ?? {}
    let result
    try { result = layoutLib.autoLayout(shot, work, language, size, regions) }
    catch (error) { result = { language, layers: [], regions, errors: [`自动排版失败：${error.message}`] } }
    const wanted = only ? new Set(only) : null
    const layers = result.layers.filter(layer => !wanted || wanted.has(layer.dialogue_id))
    const dialogues = [...shot.dialogues].sort(byOrder)
    dialogues.forEach((d, index) => {
      if ((!wanted || wanted.has(d.id)) && !layers.some(layer => layer.dialogue_id === d.id) && textOf(d, language) !== undefined) {
        layers.push(fallbackLayer(d, index, size))
      }
    })
    const warnings = (result.errors ?? []).map(message => ({ dialogue_id: null, code: 'no_space', message: String(message) }))
    return { layers, candidates: {}, warnings, layout: result }
  }

  async function plan(shot, work, language, { only = null } = {}) {
    const memoKey = JSON.stringify([shot.id, shot.version, language, only, hashText(JSON.stringify([shot.dialogues, shot.layouts?.[language], shot.stickers ?? []]))])
    if (planMemo.has(memoKey)) return planMemo.get(memoKey)
    const size = await sizeOfShot(shot)
    let planned = null
    if (typeof layoutLib.planLayout === 'function') {
      try {
        const scene = sceneCached(shot)
        const cast = store.meta(`cast:${shot.id}`) ?? await guessedCast(shot, work, scene)
        planned = await layoutLib.planLayout({ shot, work, language, size, scene, cast, previous: previousLayers(shot, language),
          settings: settings(work), only, measure: measureFor(language), stickers: shot.stickers ?? [] })
      } catch (error) { logger?.warn?.(`排版 v2 失败，改用旧排版: ${error.message}`) }
    }
    planned ??= legacyPlan(shot, work, language, size, only)
    if (planMemo.size > 300) planMemo.clear()
    planMemo.set(memoKey, planned)
    lastPlans.set(`${shot.id}:${language}`, { ...(lastPlans.get(`${shot.id}:${language}`) ?? {}), ...(planned.candidates ?? {}) })
    return planned
  }
  async function guessedCast() { return null }

  function textOf(dialogue, language) { return language === 'zh' ? dialogue.text : dialogue.translations?.[language] }

  function resolveLayers(shot, work, language, layers) {
    const out = []
    for (const layer of layers) {
      const d = shot.dialogues.find(item => item.id === layer.dialogue_id)
      const text = d && textOf(d, language)
      if (!d || text === undefined) continue
      const speaker = work.characters.find(c => c.id === d.speaker_id)
      const color = !layer.color_manual && speaker
        ? layoutLib.characterColor(speaker, work.characters.indexOf(speaker)) : (layer.color ?? '#222222')
      const { transient, ...rest } = layer
      void transient
      out.push({ font_size: 40, rotation: 0, letter_spacing: 0, max_width: 600, mode: 'horizontal', ...rest,
        font: layer.font ?? d.kind, color, text, kind: d.kind, speaker_id: d.speaker_id, order: d.order })
    }
    return out
  }
  async function displayOf(shot, work, language) {
    const existing = shot.layouts?.[language]?.layers ?? []
    const missing = shot.dialogues.filter(d => !existing.some(l => l.dialogue_id === d.id) && textOf(d, language) !== undefined).map(d => d.id)
    const layers = existing.map(layer => ({ ...layer }))
    let warnings = []
    if (missing.length) {
      const planned = await plan(shot, work, language, { only: missing })
      warnings = planned.warnings ?? []
      for (const id of missing) {
        const layer = planned.layers.find(item => item.dialogue_id === id) ?? fallbackFor(shot, id, await sizeOfShot(shot))
        if (layer) layers.push({ ...layer, transient: true })
      }
    }
    const colors = new Map(resolveLayers(shot, work, language, layers).map(l => [l.dialogue_id, l.color]))
    return { language, layers: layers.map(l => colors.has(l.dialogue_id) ? { ...l, color: colors.get(l.dialogue_id) } : l), warnings }
  }
  const spriteUrl = sig => `${API}?action=sprite&sig=${sig}`
  const usedSprites = new Set()
  async function spritesFor(shot, work, language, layers) {
    return Promise.all(resolveLayers(shot, work, language, layers).map(async layer => {
      const base = { dialogue_id: layer.dialogue_id, x: layer.x, y: layer.y }
      try {
        const r = await workers.sprite({ layer, language })
        if (r.sig) usedSprites.add(r.sig)
        return { ...base, sig: r.sig ?? null, url: r.sig ? spriteUrl(r.sig) : null, width: r.width ?? null, height: r.height ?? null,
          missing: r.missing ?? [], ...(r.error ? { error: r.error } : {}) }
      } catch (error) {
        return { ...base, sig: null, url: null, width: null, height: null, missing: [], error: error.message }
      }
    }))
  }
  async function changedSprites(shot, language, ids) {
    const work = store.work(shot.work_id), wanted = new Set(ids)
    const layers = (shot.layouts?.[language]?.layers ?? []).filter(layer => wanted.has(layer.dialogue_id))
    return spritesFor(shot, work, language, layers)
  }

  function works() {
    const counts = store.shotCounts()
    return store.works().map(w => ({ id: w.id, title: w.title, source: w.source, count: counts[w.id] ?? 0,
      characters: w.characters, settings: settings(w) }))
  }
  async function bootstrap({ work_id: workId }) {
    const work = store.work(workId), states = store.pageStates(workId), finals = store.finalizedAll()
    const pages = store.shots(workId).map((shot, index) => {
      const page = states[shot.id] ?? { hidden: false, edited: false, unlocked: false, finalize_error: null }
      const record = finals[shot.id]?.zh ?? null
      const anyRecord = record ?? Object.values(finals[shot.id] ?? {})[0] ?? null
      const lines = [...shot.dialogues].sort(byOrder)
      const size = knownSize(shot)
      return { id: shot.id, label: shot.label ?? null, index, version: shot.version,
        has_image: !!shot.image && existsSync(shot.image), width: size?.width ?? null, height: size?.height ?? null,
        lines: lines.length, text_preview: [...(lines[0]?.text ?? '')].slice(0, 24).join(''),
        status: statusOf(shot, record), finalized_version: record?.version ?? null,
        complete: record ? record.complete !== false : null, missing: record?.missing ?? [],
        edited: !!page.edited, hidden: !!page.hidden, finalize_error: page.finalize_error ?? null,
        protected: !!protection(shot, { page, finalized: anyRecord, work }) }
    })
    return { work: { id: work.id, title: work.title, source: work.source, characters: work.characters,
      settings: settings(work), baseline_confirmed: work.baseline_confirmed }, pages, seq: store.lastChange(workId), cache: cacheNotice(), fonts: Object.fromEntries(Object.keys(manifest().styles ?? {}).filter(k => !KINDS.includes(k)).map(k => [k, manifest().fonts?.[manifest().styles[k]]?.name ?? k])) }
  }

  function sceneStatus(shot) {
    const imageSha = safeSha(shot.image)
    if (!imageSha) return { status: 'none', scene: null, sha: null }
    const scene = store.meta(`${SCENE_CACHE}${imageSha}`)
    if (scene) return { status: scene.available ? 'ready' : (scene.status ?? 'unavailable'), scene, sha: imageSha }
    return { status: !config.detectionEnabled ? 'disabled' : sceneJobs.has(imageSha) ? 'pending' : 'none', scene: null, sha: imageSha }
  }

  async function page({ shot_id: shotId, language = 'zh' }) {
    const shot = store.shot(shotId), work = store.work(shot.work_id)
    const display = await displayOf(shot, work, language)
    const sprites = await spritesFor(shot, work, language, display.layers)
    const scene = sceneStatus(shot)
    const size = shot.image && existsSync(shot.image) ? await sizeOfShot(shot) : null
    return { shot, display, sprites,
      page_state: store.pageState(shotId), finalized: store.finalized(shotId, language), protected_reason: protection(shot),
      cast: store.meta(`cast:${shotId}`) ?? await guessedCast(shot, work, scene.scene), scene_status: scene.status,
      versions: store.recentVersions(shotId, 10).map(v => ({ version: v.version, origin: v.origin ?? null, time: v.edited_at ?? null,
        dialogues: [...v.dialogues].sort(byOrder).map(d => ({ id: d.id, text: d.text })) })),
      image: shot.image ? { url: `${API}?action=asset&shot_id=${encodeURIComponent(shotId)}&version=${shot.version}`,
        width: size?.width ?? null, height: size?.height ?? null } : null }
  }

  function changes({ work_id: workId, since = 0 }) {
    store.work(workId)
    return { seq: store.lastChange(workId), changes: store.changesSince(workId, since) }
  }

  function conflict(version, current) { return new Error(`版本冲突: 预期 ${version}, 当前 ${current}`) }

  function rebase(current, version, same) {
    if (!Number.isInteger(version)) throw new Error('缺少版本号')
    if (version === current.version) return
    const base = store.versionAt(current.id, version)
    if (!base || !same(base, current)) throw conflict(version, current.version)
  }
  async function editPage({ shotId, version, same, prepare, build, origin = 'user', kind = 'revision', batchId, attempts = 3 }) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = store.shot(shotId)
      rebase(current, version, same)
      const prepared = prepare ? await prepare(current) : undefined
      if (closed) throw new Error('工作台已关闭')
      if (store.shot(shotId).version !== current.version) continue
      return store.transaction(() => {
        const latest = store.shot(shotId)
        const out = build(latest, prepared)
        if (out.noop) return { shot: latest, ...out.extra }
        const next = store.editInside(shotId, latest.version, out.patch, kind, { origin, batch_id: batchId })
        out.after?.(next)
        return { shot: next, ...out.extra }
      })
    }
    throw new Error('版本冲突：页面正在被修改，请重试')
  }

  function markEdited(shot) { store.setPageState(shot.id, { edited: true }) }

  const renumber = list => list.map((d, i) => ({ ...d, order: i + 1 }))
  function speakerFor(speaker, kind, work, name) {
    if (speaker === undefined || speaker === null || speaker === 'pending') return { id: null }
    if (speaker === 'none') {
      if (!['sfx', 'narration'].includes(kind)) throw new Error('只有拟声和旁白可以不绑人')
      return { id: null }
    }
    if (speaker === 'new') {
      const trimmed = String(name ?? '').trim()
      if (!trimmed || [...trimmed].length > 40) throw new Error('请填写 40 字以内的新人物名字')
      if (work.characters.some(c => c.name === trimmed)) throw new Error('作品里已经有这个人物')
      return { id: randomUUID(), create: trimmed }
    }
    if (!work.characters.some(c => c.id === speaker)) throw new Error('所选人物不在当前作品')
    return { id: speaker }
  }
  const layoutLanguages = shot => {

    return [...new Set(['zh', ...Object.keys(shot.layouts ?? {}).filter(l => LANGUAGES.includes(l))])]
  }

  async function line(args) {
    const { shot_id: shotId, version, language = 'zh', op } = args
    if (op === 'add') return lineAdd(args)
    if (op === 'update') {
      const id = args.dialogue_id, patch = args.patch ?? {}
      if (Object.keys(patch).some(k => !['text', 'speaker_id', 'kind', 'translations'].includes(k))) throw new Error('台词修改字段不支持')
      if (patch.kind !== undefined && !KINDS.includes(patch.kind)) throw new Error('台词类型无效')
      if (patch.text !== undefined && typeof patch.text !== 'string') throw new Error('正文无效')
      const result = await editPage({ shotId, version,
        same: (a, b) => equal(a.dialogues.find(d => d.id === id), b.dialogues.find(d => d.id === id)),
        build: latest => {
          const before = latest.dialogues.find(d => d.id === id)
          if (!before) throw new Error('这条台词已经不在页面上')
          const next = { ...before }
          if (patch.text !== undefined) next.text = patch.text
          if (patch.kind !== undefined) next.kind = patch.kind
          if (patch.speaker_id !== undefined) next.speaker_id = ['pending', 'none', ''].includes(patch.speaker_id) ? null : patch.speaker_id
          if (patch.translations !== undefined) next.translations = { ...(before.translations ?? {}), ...patch.translations }
          if (equal(next, before)) return { noop: true }
          const edited = ['text', 'kind', 'speaker_id'].some(k => (next[k] ?? null) !== (before[k] ?? null))
          const patchOut = { dialogues: latest.dialogues.map(d => d.id === id ? next : d) }
          if (next.kind !== before.kind) {

            const styles = settings(store.work(latest.work_id)).styles
            const auto = new Set([before.kind, styles[before.kind]?.font].filter(Boolean))
            const layouts = copy(latest.layouts ?? {})
            let changed = false
            for (const layout of Object.values(layouts)) for (const l of layout?.layers ?? []) {
              if (l.dialogue_id === id && l.font && auto.has(l.font) && !KINDS.includes(l.font) && styles[next.kind]?.font) {
                l.font = styles[next.kind].font
                changed = true
              }
            }
            if (changed) patchOut.layouts = layouts
          }
          return { patch: patchOut, after: shot => { if (edited) markEdited(shot, [id]) } }
        } })
      return { ...result, sprites: await changedSprites(result.shot, language, [id]), warnings: [] }
    }
    if (op === 'delete') {
      const id = args.dialogue_id
      const result = await editPage({ shotId, version,
        same: (a, b) => equal(a.dialogues.find(d => d.id === id), b.dialogues.find(d => d.id === id)),
        build: latest => {
          if (!latest.dialogues.some(d => d.id === id)) throw new Error('这条台词已经不在页面上')
          const layouts = copy(latest.layouts ?? {})
          for (const layout of Object.values(layouts)) if (Array.isArray(layout?.layers)) layout.layers = layout.layers.filter(l => l.dialogue_id !== id)
          return { patch: { dialogues: renumber([...latest.dialogues].sort(byOrder).filter(d => d.id !== id)), layouts }, after: shot => markEdited(shot, []) }
        } })
      return { ...result, sprites: [], warnings: [] }
    }
    if (op === 'reorder') {
      const order = args.order ?? []
      const result = await editPage({ shotId, version, same: (a, b) => equal(a.dialogues, b.dialogues),
        build: latest => {
          const ids = latest.dialogues.map(d => d.id)
          if (order.length !== ids.length || new Set(order).size !== ids.length || order.some(id => !ids.includes(id))) throw new Error('排序必须包含本页全部台词')
          const dialogues = renumber(order.map(id => latest.dialogues.find(d => d.id === id)))
          if (equal(dialogues, [...latest.dialogues].sort(byOrder))) return { noop: true }
          return { patch: { dialogues } }
        } })
      return { ...result, sprites: [], warnings: [] }
    }
    throw new Error('未知台词操作')
  }
  async function lineAdd(args) {
    const { shot_id: shotId, version, language = 'zh' } = args
    const kind = args.kind ?? 'dialogue'
    if (!KINDS.includes(kind)) throw new Error('台词类型无效')
    if (typeof args.text !== 'string') throw new Error('正文无效')
    const id = randomUUID()
    const insert = (list, dialogue) => {
      const sorted = [...list].sort(byOrder)
      const at = args.after ? sorted.findIndex(d => d.id === args.after) : -1
      if (args.after && at < 0) throw new Error('插入位置的台词不存在')
      sorted.splice(at < 0 ? sorted.length : at + 1, 0, dialogue)
      return renumber(sorted)
    }
    const warnings = []
    const result = await editPage({ shotId, version, same: (a, b) => equal(a.dialogues, b.dialogues),
      prepare: async current => {
        const work = store.work(current.work_id)
        const speaker = speakerFor(args.speaker, kind, work, args.name)
        const draft = { ...current, dialogues: insert(current.dialogues,
          { id, speaker_id: speaker.create ? null : speaker.id, kind, order: 0, text: args.text, translations: {} }) }
        const layers = {}
        for (const lang of layoutLanguages(current)) {
          if (lang !== 'zh') continue
          const planned = await plan(draft, work, lang, { only: [id] })
          warnings.push(...(planned.warnings ?? []).filter(w => !w.dialogue_id || w.dialogue_id === id))
          layers[lang] = planned.layers.find(l => l.dialogue_id === id) ?? null
        }
        return { layers, size: await sizeOfShot(current) }
      },
      build: (latest, prepared) => {
        const work = store.work(latest.work_id)
        const speaker = speakerFor(args.speaker, kind, work, args.name)
        if (speaker.create) store.updateWork(work.id, { characters: [...work.characters, { id: speaker.id, name: speaker.create }] })
        const dialogue = { id, speaker_id: speaker.id, kind, order: 0, text: args.text, translations: {} }
        const dialogues = insert(latest.dialogues, dialogue)
        const layouts = copy(latest.layouts ?? {})
        const index = dialogues.findIndex(d => d.id === id)
        for (const lang of layoutLanguages(latest)) {

          const layer = prepared.layers[lang] ?? prepared.layers.zh ?? fallbackLayer(dialogue, index, prepared.size)
          const layout = layouts[lang] ?? { language: lang, layers: [] }
          layout.layers = [...(layout.layers ?? []), { ...copy(layer), dialogue_id: id, locked: false }]
          layouts[lang] = layout
        }
        return { patch: { dialogues, layouts }, after: shot => markEdited(shot, [id]) }
      } })
    return { ...result, dialogue_id: id, sprites: await changedSprites(result.shot, language, [id]), warnings }
  }

  function validateLayerPatch(patch) {
    const allowed = ['x', 'y', 'max_width', 'font_size', 'font', 'color', 'color_manual', 'locked', 'mode', 'rotation', 'letter_spacing']
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(k => !allowed.includes(k))) throw new Error('图层修改字段不支持')
    const finite = v => typeof v === 'number' && Number.isFinite(v)
    const ranges = { x: [0, Infinity], y: [0, Infinity], font_size: [8, 256], rotation: [-360, 360], letter_spacing: [-4, 256], max_width: [16, 16384] }
    for (const [field, [min, max]] of Object.entries(ranges)) {
      if (patch[field] === undefined) continue
      if (!finite(patch[field]) || patch[field] < min || patch[field] > max) throw new Error(`图层 ${field} 超出范围`)
    }
    if (patch.font_size !== undefined && !Number.isInteger(patch.font_size)) throw new Error('字号必须是整数')
    if (patch.mode !== undefined && !['horizontal', 'vertical'].includes(patch.mode)) throw new Error('排列方向无效')
    if (patch.color !== undefined && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.color)) throw new Error('颜色必须为 #RRGGBB')
    for (const flag of ['locked', 'color_manual']) if (patch[flag] !== undefined && typeof patch[flag] !== 'boolean') throw new Error(`${flag} 必须是布尔值`)
    if (patch.font !== undefined && !(patch.font in (manifest().styles ?? {}))) throw new Error('字体不在字体清单里')
  }
  async function layer(args) {
    const { shot_id: shotId, version, language = 'zh', dialogue_id: id, patch = {} } = args
    if (!LANGUAGES.includes(language)) throw new Error('语言不支持')
    validateLayerPatch(patch)
    const find = shot => shot.layouts?.[language]?.layers?.find(l => l.dialogue_id === id)
    const result = await editPage({ shotId, version, same: (a, b) => equal(find(a), find(b)),
      prepare: async current => {
        if (find(current)) return null
        if (!current.dialogues.some(d => d.id === id)) throw new Error('这条台词已经不在页面上')
        const planned = await plan(current, store.work(current.work_id), language, { only: [id] })
        return planned.layers.find(l => l.dialogue_id === id) ?? fallbackLayer(current.dialogues.find(d => d.id === id), 0, await sizeOfShot(current))
      },
      build: (latest, planned) => {
        if (!latest.dialogues.some(d => d.id === id)) throw new Error('这条台词已经不在页面上')
        const layouts = copy(latest.layouts ?? {})
        const layout = layouts[language] ?? { language, layers: [] }
        layout.layers ??= []
        const index = layout.layers.findIndex(l => l.dialogue_id === id)
        const base = index >= 0 ? layout.layers[index] : { ...planned, dialogue_id: id }
        const next = { ...base, ...patch }
        delete next.transient
        if (['x', 'y', 'max_width', 'font_size'].some(k => patch[k] !== undefined)) next.locked = true
        if (patch.color !== undefined && patch.color_manual === undefined) next.color_manual = true
        if (index >= 0 && equal(next, base)) return { noop: true }
        if (index >= 0) layout.layers[index] = next
        else layout.layers.push(next)
        layouts[language] = layout
        return { patch: { layouts }, after: shot => { if (store.pageState(shot.id).unlocked) store.setPageState(shot.id, { unlocked: false }) } }
      } })
    return { ...result, sprites: await changedSprites(result.shot, language, [id]), warnings: [] }
  }

  function letteringKit() { return { assets: config.assets } }

  async function sticker(args) {
    const { shot_id: shotId, version, op } = args
    let request
    if (op === 'add') {
      const kit = letteringKit()
      if (!kit?.assets) throw new Error('素材库未就绪')
      const source = kit.assets.stickerSource(String(args.asset_id ?? ''))
      const shot = store.shot(shotId)
      const size = shot.image && existsSync(shot.image) ? await sizeOfShot(shot) : null
      const finiteOr = value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
      request = { op: 'add', sticker: stickerLib.newSticker(source, { id: randomUUID(), x: finiteOr(args.x), y: finiteOr(args.y),
        width: finiteOr(args.width), z: ['below', 'above'].includes(args.z) ? args.z : undefined, size }) }
      stickerLib.validateSticker(request.sticker)
    } else if (op === 'restore') {
      stickerLib.validateSticker(args.sticker)
      const source = letteringKit().assets.stickerSource(args.sticker.asset_id)
      request = { op, sticker: { ...args.sticker, path: source.path, aspect: source.aspect }, index: args.index }
    } else if (['update', 'delete', 'order', 'arrange'].includes(op)) {
      request = { op, sticker_id: args.sticker_id, patch: args.patch, to: args.to === 'back' ? 'back' : 'front', order: args.order }
    } else throw new Error('未知贴图操作')
    const result = await editPage({ shotId, version, same: (a, b) => equal(a.stickers ?? [], b.stickers ?? []),
      build: latest => {
        const next = stickerLib.applyOp(latest.stickers, request)
        if (!next) return { noop: true }
        return { patch: { stickers: next }, after: shot => markEdited(shot, []) }
      } })
    return { ...result, sticker_id: request.sticker?.id ?? request.sticker_id, sprites: [], warnings: [] }
  }

  async function relayout(args) {
    const { shot_id: shotId, version, language = 'zh', dialogue_ids: requested, cycle } = args
    const key = `${shotId}:${language}`
    const same = (a, b) => equal(a.dialogues, b.dialogues) && equal(a.layouts?.[language], b.layouts?.[language])
    let candidates = {}, warnings = []
    const result = await editPage({ shotId, version, same, origin: 'auto', attempts: args.attempts ?? 3,
      prepare: async current => {
        const work = store.work(current.work_id)
        const existing = current.layouts?.[language]?.layers ?? []
        if (cycle) {
          let options = lastPlans.get(key)?.[cycle.dialogue_id]
          if (!options?.length) options = (await plan(current, work, language, { only: [cycle.dialogue_id] })).candidates?.[cycle.dialogue_id]
          if (!options?.length) throw new Error('这一句没有可换的位置')
          candidates = { [cycle.dialogue_id]: options }
          const pick = options[((Number(cycle.index) || 0) % options.length + options.length) % options.length]
          const planned = (await displayOf(current, work, language)).layers.find(l => l.dialogue_id === cycle.dialogue_id)
          return { [cycle.dialogue_id]: { ...planned, ...pick, dialogue_id: cycle.dialogue_id, locked: true } }
        }
        const unlocked = current.dialogues.filter(d => !existing.find(l => l.dialogue_id === d.id)?.locked).map(d => d.id)
        const ids = requested ? unlocked.filter(id => requested.includes(id)) : unlocked
        if (!ids.length) return {}
        const planned = await plan(current, work, language, { only: ids })
        candidates = Object.fromEntries(Object.entries(planned.candidates ?? {}).filter(([id]) => ids.includes(id)))
        warnings = planned.warnings ?? []
        return Object.fromEntries(planned.layers.filter(l => ids.includes(l.dialogue_id)).map(l => [l.dialogue_id, l]))
      },
      build: (latest, placed) => {
        const ids = Object.keys(placed)
        if (!ids.length) return { noop: true }
        const layouts = copy(latest.layouts ?? {})
        const layout = layouts[language] ?? { language, layers: [] }
        layout.layers ??= []
        for (const id of ids) {
          const { transient, score, ...next } = placed[id]
          void transient; void score
          const index = layout.layers.findIndex(l => l.dialogue_id === id)
          if (index >= 0 && layout.layers[index].locked && !cycle) continue
          if (index >= 0) layout.layers[index] = { ...layout.layers[index], ...next }
          else layout.layers.push(next)
        }
        layouts[language] = layout
        if (equal(layouts, latest.layouts ?? {})) return { noop: true }
        return { patch: { layouts } }
      } })
    const ids = cycle ? [cycle.dialogue_id] : (requested ?? result.shot.dialogues.map(d => d.id))
    return { ...result, sprites: await changedSprites(result.shot, language, ids), candidates, warnings }
  }
  async function saveCast({ shot_id: shotId, assignments }) {
    if (!assignments || typeof assignments !== 'object') throw new Error('人物指认格式无效')
    const shot = store.shot(shotId)
    store.meta(`cast:${shotId}`, { assignments: copy(assignments), confirmed: true, source: 'user', time: new Date().toISOString() })
    return relayout({ shot_id: shotId, version: shot.version, language: 'zh' })
  }

  async function relayoutLines(shotId, dialogueIds, { origin = 'auto' } = {}) {
    try {
      const shot = store.shot(shotId)
      void origin
      return await relayout({ shot_id: shotId, version: shot.version, language: 'zh', dialogue_ids: dialogueIds, attempts: 1 })
    } catch (error) {
      if (!/版本冲突/.test(error.message)) logger?.warn?.(`自动排版跳过: ${error.message}`)
      return null
    }
  }

  const precomposed = new Map(), finalizing = new Map()

  function documentOf(shot, work, language) {
    const document = textDocumentOf(shot, work, language)
    const stickers = stickerLib.documentStickers(shot.stickers, id => letteringKit()?.assets?.fileOf?.(id))
    return stickers ? { ...document, stickers } : document
  }
  function textDocumentOf(shot, work, language) {
    if (!shot.dialogues.length) return { language, layers: [], speaker_ids: work.characters.map(c => c.id), validation_errors: [] }

    const layers = shot.layouts?.[language]?.layers
    if (Array.isArray(layers) && new Set(layers.map(l => l.dialogue_id)).size !== layers.length) {
      const seen = new Set()
      const unique = layers.filter(l => !seen.has(l.dialogue_id) && seen.add(l.dialogue_id))
      shot = { ...shot, layouts: { ...shot.layouts, [language]: { ...shot.layouts[language], layers: unique } } }
    }
    return layoutLib.renderDocument(shot, work, language, true)
  }
  async function signatureOf(document, sourceHash) {
    const hashes = await workers.hashes().catch(() => null)
    return hashText(JSON.stringify([document, sourceHash, hashes]))
  }
  const previewPathOf = (shot, language) => join(config.dataDir, `${keyOf(shot.id)}-${shot.version}-${language}-preview.png`)
  async function composeTo(shot, work, language, document) {
    const sourceHash = fileSha(shot.image)
    const output = previewPathOf(shot, language)
    const signature = await signatureOf(document, sourceHash)
    const cached = precomposed.get(`${shot.id}:${language}`)
    if (cached?.signature === signature && existsSync(cached.path) && sha(cached.path) === cached.hash) {
      if (resolve(cached.path) !== resolve(output)) copyFileSync(cached.path, output)
      return { result: cached.result, output, signature, sourceHash }
    }
    const result = await workers.compose({ input: shot.image, output, document })
    if (!result?.output_path || !existsSync(output)) {
      const detail = (result?.errors ?? []).map(e => e.detail ?? e.code).join('；')
      throw new Error(`合成失败${detail ? `：${detail}` : ''}`)
    }
    return { result, output, signature, sourceHash }
  }
  async function precompose({ shot_id: shotId, version, language = 'zh' }) {
    const shot = store.shot(shotId), work = store.work(shot.work_id)
    if (shot.version !== version || !shot.image || !existsSync(shot.image)) return { ready: false }
    try {
      const display = await displayOf(shot, work, language)
      const draft = { ...shot, layouts: { ...shot.layouts, [language]: { ...(shot.layouts?.[language] ?? { language }),
        layers: display.layers.map(({ transient, ...l }) => { void transient; return l }) } } }
      const document = documentOf(draft, work, language)
      const { result, output, signature } = await composeTo(shot, work, language, document)
      precomposed.set(`${shotId}:${language}`, { signature, path: output, hash: sha(output), result })
      return { ready: true }
    } catch (error) {
      logger?.warn?.(`预合成失败: ${error.message}`)
      return { ready: false }
    }
  }

  function translationStatus({ work_id: workId, language }) {
    if (!LANGUAGES.includes(language) || language === 'zh') throw new Error('language 只能是 en、ja、ko')
    const pages = store.shots(workId).map(shot => ({ shot_id: shot.id, label: shot.label, ...translationGaps(shot, language) }))
      .filter(p => p.missing.length || p.stale.length)
    return { language, pages, missing: pages.reduce((n, p) => n + p.missing.length, 0), stale: pages.reduce((n, p) => n + p.stale.length, 0) }
  }

  function finalize(args) {
    const prior = finalizing.get(args.shot_id) ?? Promise.resolve()
    const task = prior.catch(() => {}).then(() => finalizeNow(args))
    finalizing.set(args.shot_id, task)
    task.finally(() => { if (finalizing.get(args.shot_id) === task) finalizing.delete(args.shot_id) }).catch(() => {})
    return task
  }
  async function finalizeNow({ shot_id: shotId, version, language = 'zh', preview_hash: expectedHash }) {
    try {
      if (!LANGUAGES.includes(language)) throw new Error('语言不支持')
      let shot = store.shot(shotId)
      if (shot.version !== version) throw conflict(version, shot.version)
      const work = store.work(shot.work_id)
      if (!shot.image || !existsSync(shot.image)) throw new Error('这一页没有可用图片，不能定稿')
      if (language !== 'zh') {
        const gaps = translationGaps(shot, language)
        if (gaps.missing.length || gaps.stale.length) throw new Error(`${language} 译文没就绪，不能定稿：缺译 ${gaps.missing.length} 条，中文改过、译文没跟着改 ${gaps.stale.length} 条`)
      }
      const lettered = join(work.source.output_dir, language, `${shot.id}.png`)
      const guardOwner = () => {
        if (!lettered) return

        const target = resolve(lettered).toLowerCase()
        for (const [otherId, records] of Object.entries(store.finalizedAll())) {
          if (otherId === shotId) continue
          const owner = Object.values(records).find(r => r?.output && resolve(String(r.output)).toLowerCase() === target)
          if (!owner) continue
          throw new Error(owner.work_id !== work.id ? '这张嵌字成品已被另一部作品的定稿占用，拒绝覆盖'
            : '这张嵌字成品已被本作品另一页（同名不同扩展名的图）占用，拒绝覆盖')
        }
      }
      guardOwner()

      const existing = shot.layouts?.[language]?.layers ?? []
      const missing = shot.dialogues.filter(d => !existing.some(l => l.dialogue_id === d.id)).map(d => d.id)
      if (missing.length) {
        const planned = await plan(shot, work, language, { only: missing })
        const size = await sizeOfShot(shot)
        const layouts = copy(shot.layouts ?? {})
        const layout = layouts[language] ?? { language, layers: [] }

        const placed = missing.map(id => planned.layers.find(l => l.dialogue_id === id) ?? fallbackFor(shot, id, size)).filter(Boolean)
        layout.layers = [...(layout.layers ?? []), ...placed.map(({ transient, score, ...l }) => { void transient; void score; return { ...l, locked: false } })]
        layouts[language] = layout
        shot = store.edit(shotId, shot.version, { layouts }, 'revision', { origin: 'auto' })
      }

      const document = documentOf(shot, work, language)
      const { result, output, sourceHash } = await composeTo(shot, work, language, document)

      const latest = store.shot(shotId)
      if (latest.version !== shot.version || latest.image !== shot.image) throw conflict(shot.version, latest.version)
      if (sha(latest.image) !== sourceHash) throw new Error('原图已变化，已中止定稿')
      const previewHash = sha(output)
      if (expectedHash && previewHash !== expectedHash) throw new Error('预览已变更，请重新审校')
      guardOwner()
      let published = null
      if (lettered) {
        published = publishFinal({ sourcePath: latest.image, previewPath: output, folder: dirname(latest.image), outputName: `${shotId}.png`, originalSource: latest.original_image ?? latest.image,
          outputDir: dirname(lettered), originalDir: work.source.original_dir ?? join(dirname(lettered), '原版'),
          historyDir: join(config.dataDir, 'finals-history', keyOf(shotId)), previewHash, sourceHash })
      }
      if (!existsSync(output) || result.error) throw new Error(result.error || '渲染没有生成图片')
      const drawn = new Set((result.layers ?? []).map(l => l.dialogue_id))
      const notDrawn = document.layers.map(l => l.dialogue_id).filter(id => !drawn.has(id))
      const proof = { valid: true, errors: [...(result.errors ?? []), ...(document.validation_errors ?? [])], version: shot.version, language,
        preview_hash: previewHash, path: output, source_hash: sourceHash, width: result.width, height: result.height,
        layers: result.layers ?? [], complete: !notDrawn.length, missing: notDrawn }
      return store.transaction(() => {
        const approved = store.approveInside(shotId, shot.version, language, proof)
        const previous = store.finalized(shotId, language)
        const record = store.setFinalized(shotId, language, { version: shot.version, sha256: previewHash,
          output: published?.lettered ?? output, preview_path: output,
          previous_preview_path: previous && previous.preview_path !== output ? previous.preview_path : previous?.previous_preview_path ?? null,
          time: new Date().toISOString(), complete: !notDrawn.length, missing: notDrawn, work_id: work.id })

        const page = store.pageState(shotId)
        if (page.finalize_error || page.unlocked) store.setPageState(shotId, { finalize_error: null, unlocked: false })
        return { shot: approved, finalized: record, published: published
          ? { lettered: published.lettered, original: published.original, original_created: published.original_created, history: published.history } : null }
      })
    } catch (error) {
      try { if (!closed) store.setPageState(shotId, { finalize_error: error.message }) } catch {                        }
      throw error
    }
  }

  async function approve(args) {
    if (!args.preview_hash) throw new Error('预览已变更，请重新审校')
    const result = await finalize(args)
    return result.published ? { ...result.shot, finalized: result.finalized, published: { ...result.published, shot_id: result.shot.id } }
      : { ...result.shot, finalized: result.finalized }
  }

  function pageStateAction({ shot_id: shotId, patch = {} }) {
    if (Object.keys(patch).some(k => !['hidden', 'edited', 'unlocked'].includes(k))) throw new Error('页面状态字段不支持')
    if (Object.values(patch).some(v => typeof v !== 'boolean')) throw new Error('页面状态必须是布尔值')
    return { shot_id: shotId, page_state: store.setPageState(shotId, patch) }
  }
  function saveSettings({ work_id: workId, settings: patch }) {
    if (!patch || Object.keys(patch).some(k => !['styles', 'read_only'].includes(k))) throw new Error('作品设置字段无效')
    const work = store.work(workId), saved = work.settings ?? {}, styles = { ...(saved.styles ?? {}) }
    for (const [kind, style] of Object.entries(patch.styles ?? {})) {
      if (!KINDS.includes(kind) || !Number.isFinite(style.size_ratio) || style.size_ratio < 0.005 || style.size_ratio > 0.3) throw new Error('字体比例无效')
      styles[kind] = { ...(styles[kind] ?? {}), ...style }
    }
    const next = store.updateWork(workId, { settings: { ...saved, ...copy(patch), styles } })
    return { work: next, settings: settings(next) }
  }
  function resolvedColors(shot, characters) {
    return Object.values(shot.layouts ?? {}).flatMap(layout => (layout?.layers ?? []).map(layer => {
      if (layer.color_manual) return layer.color
      const d = shot.dialogues.find(item => item.id === layer.dialogue_id)
      const index = characters.findIndex(c => c.id === d?.speaker_id)
      return index >= 0 ? layoutLib.characterColor(characters[index], index) : layer.color
    }))
  }
  function saveCharacters({ work_id: workId, characters }) {
    const work = store.work(workId), oldIds = new Set(work.characters.map(c => c.id))
    if (!Array.isArray(characters) || characters.some(c => !c?.id) || new Set(characters.map(c => c.id)).size !== characters.length) throw new Error('角色档案格式无效')
    const next = characters.map(c => {
      const out = copy(c)
      if (out.color === null || out.color === '') delete out.color
      if (out.color !== undefined && !/^#[0-9a-f]{6}$/i.test(out.color)) throw new Error('颜色必须为 #RRGGBB')
      if (out.gender !== undefined && out.gender !== null && !['female', 'male'].includes(out.gender)) throw new Error('性别无效')
      if (out.aliases !== undefined && (!Array.isArray(out.aliases) || out.aliases.some(a => typeof a !== 'string'))) throw new Error('别名必须是文字列表')
      return out
    })
    const ids = new Set(next.map(c => c.id))
    const shots = store.shots(workId)
    if (shots.some(s => s.dialogues.some(d => oldIds.has(d.speaker_id) && !ids.has(d.speaker_id)))) throw new Error('已绑定角色不能删除')
    const saved = store.updateWork(workId, { characters: next })
    let stale = 0
    for (const shot of shots) {
      const record = store.finalized(shot.id, 'zh')
      if (record?.version === shot.version && !equal(resolvedColors(shot, work.characters), resolvedColors(shot, next))) stale++
    }
    return { work: saved, stale_finalized: stale }
  }

  const sceneJobs = new Map()
  function analyzeImage(shot, priority) {
    const imageSha = safeSha(shot.image)
    if (!imageSha) return Promise.resolve(null)
    const cached = store.meta(`${SCENE_CACHE}${imageSha}`)
    if (cached) return Promise.resolve(cached)
    if (sceneJobs.has(imageSha)) return sceneJobs.get(imageSha)
    const task = workers.analyze({ path: shot.image, sha: imageSha }, { priority }).catch(error => ({ available: false, status: 'error', error: error.message, people: [], grid: null })).then(scene => {
      if (scene && !closed) store.meta(`${SCENE_CACHE}${imageSha}`, scene)
      return scene
    }).finally(() => sceneJobs.delete(imageSha))
    sceneJobs.set(imageSha, task)
    return task
  }
  async function scene(shotOrId) {
    const shot = typeof shotOrId === 'string' ? store.shot(shotOrId) : shotOrId
    return analyzeImage(shot, 'now')
  }
  async function sceneAction({ shot_id: shotId }) {
    const shot = store.shot(shotId)
    if (!shot.image || !existsSync(shot.image)) return { status: 'none', scene: null }
    const result = await scene(shot)
    return { status: result?.available ? 'ready' : result?.status ?? 'unavailable', scene: result }
  }
  function prefetch({ shot_ids: ids = [] }) {
    if (!config.detectionEnabled) return { queued: 0, status: 'disabled' }
    workers.cancelPrefetch()
    let queued = 0
    for (const id of ids) {
      let shot
      try { shot = store.shot(id) } catch { continue }
      const status = sceneStatus(shot)
      if (status.status !== 'none' || !status.sha) continue
      analyzeImage(shot, 'prefetch').catch(() => {})
      queued++
    }
    return { queued }
  }

  function deleteWork({ work_id: workId, confirm_title: title }) {
    const work = store.work(workId)
    if (title !== work.title) throw new Error('作品名对不上，没有删除')

    const backupDir = join(config.dataDir, '删除前备份')
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const backup = store.backupTo(join(backupDir, `${stamp}-${work.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}.sqlite`))
    for (const old of readdirSync(backupDir).filter(n => n.endsWith('.sqlite')).sort().slice(0, -30)) rmSync(join(backupDir, old), { force: true })
    return { ...store.deleteWork(workId), title: work.title, backup }
  }

  function discard(shotId) {
    const shot = store.shot(shotId), work = store.work(shot.work_id)
    store.hideShot(shotId)
    const states = store.pageStates(work.id)
    const remaining = store.shots(work.id).filter(item => !states[item.id]?.hidden).length
    return { hidden: true, shot_id: shotId, work_id: work.id, label: shot.label, files: { moved: [], missing: [], failed: [] }, remaining, reversible: true }
  }
  function restoreShot(shotId) {
    store.unhideShot(shotId)
    return { hidden: false, shot_id: shotId, version: store.shot(shotId).version }
  }

  function keepSet() {
    const paths = new Set(), stems = new Set()
    for (const prefix of ['preview:', 'final:', 'finalized:']) for (const { value } of store.metaLike(prefix)) {
      for (const path of [value?.path, value?.output, value?.preview_path, value?.previous_preview_path, ...(value?.layers ?? []).map(x => x.path)].filter(Boolean)) {
        paths.add(resolve(path).toLowerCase())
        for (const name of [basename(path), basename(dirname(path))]) {
          const stem = name.match(/^[0-9a-f]{16}-\d+-(zh|en|ja|ko)/); if (stem) stems.add(stem[0])
        }
      }
    }
    return { paths, stems }
  }
  function diskSize(path) {
    const st = statSync(path)
    if (!st.isDirectory()) return st.size
    return readdirSync(path).reduce((sum, name) => sum + diskSize(join(path, name)), 0)
  }
  function gcPlan(now = Date.now()) {
    const keep = keepSet(), found = []
    for (const name of readdirSync(config.dataDir)) {
      if (!GC_NAME.test(name)) continue
      const path = join(config.dataDir, name), st = statSync(path)
      if (now - st.mtimeMs < 15 * 60 * 1000) continue
      const stem = name.match(/^[0-9a-f]{16}-\d+-(zh|en|ja|ko)/)[0]
      if (keep.paths.has(resolve(path).toLowerCase()) || keep.stems.has(stem)) continue
      found.push({ path, relative: name, bytes: diskSize(path) })
    }

    const sprites = join(config.dataDir, 'sprites')
    if (existsSync(sprites)) {
      const groups = new Map()
      for (const name of readdirSync(sprites)) {
        const sig = name.replace(/\.[^.]*$/, '')
        if (!groups.has(sig)) groups.set(sig, [])
        groups.get(sig).push(name)
      }
      for (const [sig, names] of groups) {
        if (usedSprites.has(sig)) continue
        const stats = names.map(name => statSync(join(sprites, name)))
        if (stats.some(st => now - Math.max(st.mtimeMs, st.atimeMs) < 14 * DAY)) continue
        names.forEach((name, i) => found.push({ path: join(sprites, name), relative: `sprites/${name}`,
          bytes: stats[i].isDirectory() ? diskSize(join(sprites, name)) : stats[i].size }))
      }
    }
    return found
  }
  function gc({ dry_run: dryRun = true, consent = false } = {}) {
    const found = gcPlan()
    const bytes = found.reduce((sum, f) => sum + f.bytes, 0)
    const summary = { files: found.length, bytes, sample: found.slice(0, 20).map(f => f.relative) }
    if (dryRun !== false) return { ...summary, dry_run: true, consent: !!store.meta('gc:consent')?.granted }
    if (!consent && !store.meta('gc:consent')?.granted) throw new Error('第一次清理前需要确认')
    if (consent && !store.meta('gc:consent')?.granted) store.meta('gc:consent', { granted: true, time: new Date().toISOString() })
    const trashRoot = join(config.dataDir, '_gc_trash')
    const day = new Date().toISOString().slice(0, 10)
    let moved = 0
    for (const file of found) {
      const target = join(trashRoot, day, file.relative)
      try {
        mkdirSync(dirname(target), { recursive: true })
        renameSync(file.path, existsSync(target) ? `${target}.${Date.now()}` : target)
        moved++
      } catch (error) { logger?.warn?.(`清理移动失败 ${file.relative}: ${error.message}`) }
    }
    let purged = 0
    if (existsSync(trashRoot)) {
      for (const name of readdirSync(trashRoot)) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(name) ? Date.parse(`${name}T00:00:00Z`) : NaN
        if (Number.isFinite(date) && Date.now() - date > 7 * DAY) { rmSync(join(trashRoot, name), { recursive: true, force: true }); purged++ }
      }
    }
    return { ...summary, dry_run: false, moved, purged_days: purged, trash: join(trashRoot, day) }
  }

  function autoGc() {
    if (closed || !store.meta('gc:consent')?.granted) return
    try {
      const result = gc({ dry_run: false })
      if (result.moved) logger?.info?.(`自动清理预览缓存：${result.moved} 个文件放进回收区`)
    } catch (error) { logger?.warn?.(`自动清理预览缓存失败: ${error.message}`) }
  }
  const gcTimers = options.autoGc === false ? []
    : [setTimeout(autoGc, options.autoGcDelay ?? 2 * 60 * 1000), setInterval(autoGc, 6 * 3600 * 1000)]
  for (const timer of gcTimers) timer.unref?.()

  let cacheCount = null
  function cacheNotice() {
    if (store.meta('gc:consent')?.granted) return null
    if (!cacheCount || Date.now() - cacheCount.at > 30 * 60 * 1000) {
      let found = []
      try { found = gcPlan() } catch {                                      }
      cacheCount = { at: Date.now(), files: found.length, bytes: found.reduce((sum, f) => sum + f.bytes, 0) }
    }
    return cacheCount.bytes > (options.cacheNoticeBytes ?? 2 ** 30) ? { files: cacheCount.files, bytes: cacheCount.bytes } : null
  }

  async function autolayout(id, version, language, draft = false) {
    const shot = store.shot(id), work = store.work(shot.work_id), layout = shot.layouts[language]
    if (shot.version !== version) throw new Error('版本冲突')
    const planned = await plan(shot, work, language)
    const result = planned.layout ?? { ...(layout ?? {}), language, layers: planned.layers }
    if (layout?.manual_regions_confirmed) result.manual_regions_confirmed = true
    if (layout?.manual_continuity_confirmed) result.manual_continuity_confirmed = true
    return store.setLayout(id, version, language, result, true, draft ? 'draft' : 'revision')
  }
  async function preview(id, version, language) {
    const shot = store.shot(id)
    if (shot.version !== version) throw new Error('版本冲突')
    const textDocument = layoutLib.renderDocument(shot, store.work(shot.work_id), language, true)
    const stickers = stickerLib.documentStickers(shot.stickers, sid => letteringKit()?.assets?.fileOf?.(sid))
    const document = stickers ? { ...textDocument, stickers } : textDocument
    const sourceHash = sha(shot.image)
    const signature = hashText(JSON.stringify([document, sourceHash, shot.visual, sha(config.fontManifest), sha(config.renderer), 'manual-approval']))
    const cached = store.meta(`preview:${id}:${language}`)
    if (cached?.version === version && cached.signature === signature && cached.path && existsSync(cached.path) &&
        cached.layers.every(l => l.path && existsSync(l.path))) return cached
    const key = keyOf(id)
    const layoutPath = join(config.dataDir, `${key}-${version}-${language}.json`)
    const output = join(config.dataDir, `${key}-${version}-${language}-preview.png`)
    const layerDir = join(config.dataDir, `${key}-${version}-${language}-layers`)
    writeFileSync(layoutPath, JSON.stringify(document))
    let result
    try {
      const { stdout } = await run(config.pythonPath, ['-X', 'utf8', config.renderer, '-i', shot.image, '-o', output, '--layout', layoutPath, '--allow-invalid', '--layer-dir', layerDir], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      result = JSON.parse(stdout)
    } catch (error) {
      try { result = JSON.parse(error.stdout) } catch { throw new Error(`渲染失败: ${error.message}`) }
    }
    if (closed || store.shot(id).version !== version || sha(shot.image) !== sourceHash) throw new Error('版本冲突：预览已过期')
    const errors = [...(result.errors ?? []), ...(document.validation_errors ?? [])]
    for (let i = 0; i < (result.layers ?? []).length; i++) for (const b of result.layers.slice(i + 1)) {
      const a = result.layers[i]
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) errors.push({ code: 'layer_overlap', layers: [a.dialogue_id, b.dialogue_id] })
    }
    const layers = (result.layers ?? []).map(l => ({ ...l, url: l.path ?
      `${API}?action=preview-layer&shot_id=${encodeURIComponent(id)}&version=${version}&language=${language}&dialogue_id=${encodeURIComponent(l.dialogue_id)}` : null }))
    const proof = { valid: !!(result.output_path && existsSync(output)), errors, version, language, signature,
      preview_hash: existsSync(output) && result.output_path ? sha(output) : null, path: result.output_path ?? null,
      source_hash: sourceHash, layout_hash: sha(layoutPath), width: result.width, height: result.height, layers,
      url: result.output_path ? `${API}?action=preview-image&shot_id=${encodeURIComponent(id)}&version=${version}&language=${language}` : null }
    store.meta(`preview:${id}:${language}`, proof)
    return proof
  }

  async function preparePreview({ shot_id: id, version, language = 'zh' }) {
 let shot = store.shot(id)
 if (shot.version !== version) throw new Error('版本冲突')
 if (!shot.layouts[language]) shot = await autolayout(id, version, language, true)
 return { shot, preview: await preview(id, shot.version, language) }
}
  function exportMapping(workId) {
    const work = store.work(workId)
    return { schema_version: 1, work_id: work.id, title: work.title, source: work.source,
      characters: work.characters, shots: store.shots(workId).map((shot, index) => ({
        id: shot.id, position: index + 1, label: shot.label, version: shot.version,
        image: { path: shot.image, sha256: shot.image && existsSync(shot.image) ? sha(shot.image) : null },
        assets: shot.assets, dialogues: shot.dialogues, layouts: shot.layouts, approvals: shot.approvals,
        provenance: shot.provenance, source_note: shot.source_note,
      })) }
  }

  async function pickImagePaths() {
    const out = join(tmpdir(), `comic-pick-${randomUUID()}.json`)
    try {
      await run('powershell.exe', ['-NoProfile', '-STA', '-File', fileURLToPath(new URL('./pick_images.ps1', import.meta.url)), out], { windowsHide: false })
      if (!existsSync(out)) throw new Error('文件窗口没有返回结果')
      const picked = JSON.parse(readFileSync(out, 'utf8'))
      return { cancelled: !!picked.cancelled, paths: picked.paths ?? [] }
    } finally { if (existsSync(out)) rmSync(out, { force: true }) }
  }
  async function importImages(args = {}) {
    let paths = args.paths
    if (!Array.isArray(paths)) {
      const picked = await pickImagePaths()
      if (picked.cancelled || !picked.paths.length) return { cancelled: true, work: null, shot: null, count: 0 }
      paths = picked.paths
    }
    const plan = importPlan(paths)
    const existing = store.works().find(w => w.source?.kind === 'images' && String(w.source.folder ?? '').toLowerCase() === plan.folder.toLowerCase())
    if (existing) {
      return { cancelled: true, existing_work_id: existing.id, work: null, shot: null, count: 0,
        message: `这个文件夹已经导入为「${existing.title}」，请直接打开那部作品` }
    }
    for (const file of plan.files) if (!existsSync(file)) throw new Error('图片不存在')
    const sizes = new Map()
    for (const file of plan.files) {
      try { sizes.set(file, await sizeOfPath(file, { persist: false })) } catch {                                   }
    }
    const title = freeTitle(plan.title)
    const id = randomUUID()
    const work = store.transaction(() => {
      store.createWork({ id, title, characters: [], source: { kind: 'images', folder: plan.folder, output_dir: join(config.dataDir, 'works', id, 'finals'), original_dir: join(config.dataDir, 'works', id, 'originals'), count: plan.files.length } })
      store.updateWork(id, { baseline_confirmed: true })

      plan.files.forEach((image, index) => {
        const size = sizes.get(image)
        store.addShot(id, { label: basename(image).replace(/\.[^.]+$/, ''), image, original_image: image, dialogues: [], state: {},
          ...(size ? { image_width: size.width, image_height: size.height } : {}) }, index + 1)
      })
      return store.work(id)
    })
    return { work, shot: store.shots(id)[0], count: plan.files.length, cancelled: false }
  }

  function slotAfter(workId, afterId, skip = null) {
    for (let pass = 0; pass < 2; pass++) {
      const rows = store.positions(workId).filter(r => r.id !== skip)
      const at = afterId ? rows.findIndex(r => r.id === afterId) : -1
      if (afterId && at < 0) throw new Error('目标页不在这部作品里')
      const prev = rows[at]?.position, next = rows[at + 1]?.position
      if (prev == null) return next == null ? 1 : next - 1
      if (next == null) return prev + 1
      if (next - prev > 1e-9) return (prev + next) / 2
      store.respace(workId)
    }
    throw new Error('页面位置无法排开')
  }
  async function insertImages({ work_id: workId, after_id: afterId = null, paths } = {}) {
    const work = store.work(workId)
    if (work.source?.kind !== 'images' || !work.source.folder) throw new Error('只有从图片文件夹导入的作品能插图')
    if (!Array.isArray(paths)) {
      const picked = await pickImagePaths()
      if (picked.cancelled || !picked.paths.length) return { cancelled: true, added: [] }
      paths = picked.paths
    }
    const files = importPlan(paths).files
    const folder = work.source.folder
    const labels = new Set(store.shots(workId).map(shot => String(shot.label ?? '').toLowerCase()))
    const planned = []
    for (const file of files) {

      const stem = `插_${basename(file).replace(/\.[^.]+$/, '')}`
      let label = stem, n = 2
      while (labels.has(label.toLowerCase()) || existsSync(join(folder, `${label}.png`))) label = `${stem}-${n++}`
      labels.add(label.toLowerCase())
      const image = join(folder, `${label}.png`)
      if (/\.png$/i.test(file)) copyFileSync(file, image)
      else await run(config.pythonPath, ['-X', 'utf8', '-c', 'import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1])\nim.convert("RGBA" if "A" in im.getbands() else "RGB").save(sys.argv[2], "PNG")', file, image], { windowsHide: true })
      let size = null
      try { size = await sizeOfPath(image, { persist: false }) } catch {                     }
      planned.push({ label, image, size })
    }
    const added = store.transaction(() => {
      let after = afterId
      return planned.map(({ label, image, size }) => {
        const shot = store.addShot(workId, { label, image, original_image: image, dialogues: [], state: {}, ...(size ? { image_width: size.width, image_height: size.height } : {}) },
          slotAfter(workId, after))
        after = shot.id
        return shot.id
      })
    })
    return { cancelled: false, added }
  }
  function movePage({ shot_id: shotId, after_id: afterId = null }) {
    const shot = store.shot(shotId)
    if (afterId === shotId) return { moved: false }
    return store.transaction(() => { store.moveShot(shotId, slotAfter(shot.work_id, afterId, shotId)); return { moved: true } })
  }

  function exportOrdered({ work_id: workId, language = 'zh' }) {
    if (!LANGUAGES.includes(language)) throw new Error('语言不支持')
    const states = store.pageStates(workId), missing = [], stale = [], files = []
    for (const shot of store.shots(workId)) {
      if (states[shot.id]?.hidden) continue
      const record = store.finalized(shot.id, language)
      if (!record?.output || !existsSync(record.output)) { missing.push(shot.label); continue }
      if (record.version !== shot.version) { stale.push(shot.label); continue }
      files.push(record.output)
    }
    if (!files.length) throw new Error('没有可导出的当前定稿，请先定稿')
    const folder = join(config.dataDir, 'exports', workId, `${language}-${Date.now()}-${randomUUID().slice(0,8)}`)
    mkdirSync(folder, { recursive: true })
    files.forEach((file, i) => copyFileSync(file, join(folder, `${String(i+1).padStart(3,'0')}.png`)))
    return { folder, count: files.length, missing, stale }
  }
  function exportFinal(args) {
    const shot = store.shot(args.shot_id), proof = shot.approvals[args.language]
    if (shot.version !== args.version || !proof || proof.version !== shot.version || !proof.valid) throw new Error('此语言/版本尚未通过，不能导出最终 PNG')
    if (sha(shot.image) !== proof.source_hash || !existsSync(proof.path) || sha(proof.path) !== proof.preview_hash) throw new Error('资产或预览变化，审批已失效')
    const path = proof.path.replace('-preview.png', '-final.png')
    copyFileSync(proof.path, path)
    if (sha(path) !== proof.preview_hash) throw new Error('最终输出与预览不一致')
    store.meta(`final:${shot.id}:${args.language}`, { path, version: shot.version, sha256: sha(path) })
    return { path, sha256: sha(path), url: `${API}?action=final-image&shot_id=${encodeURIComponent(shot.id)}&version=${shot.version}&language=${args.language}` }
  }

  const api = { config, store, workers, autolayout, preview, preparePreview, exportMapping,
    importImages, pickImagePaths, insertImages, movePage, exportOrdered, exportFinal, discard, restoreShot, deleteWork,
    publish, subscribe, settings, imageSize: (path, opts) => sizeOfPath(path, opts), scene, relayoutLines,
    works, bootstrap, page, changes, line, layer, sticker, relayout, cast: saveCast, finalize, precompose,
    pageState: pageStateAction, saveSettings, saveCharacters, sceneAction, prefetch, gc, translationStatus,
    letteredPathOf, approve,
    async close() {
      if (closed) return
      closed = true
      for (const timer of gcTimers) clearTimeout(timer)
      listeners.clear()
      await workers.close()
      store.close()
    } }
  return api
}

