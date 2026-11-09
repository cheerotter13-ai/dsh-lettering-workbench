import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorkbench } from './engine.js'
import { createAssets } from './assets.js'
import { createPhotoshop } from './ps.js'

export const name = 'lettering-workbench'
export const inject = ['webServer']
const BASE = '/plugins/lettering-workbench'
const API = `${BASE}/api`
const UI_DIR = fileURLToPath(new URL('./ui/', import.meta.url))

function json(res, status, data) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(data))
}
function sendFile(res, path, type, cache) {
  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('cache-control', cache)
  res.end(readFileSync(path))
}
const notFound = res => json(res, 404, { ok: false, error: '不存在' })
async function body(req) {
  if (req.headers['x-dsh-lettering-workbench'] !== '1') throw new Error('缺少工作台请求标记')
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('需要 application/json')
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new Error('跨源请求被拒绝')
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw new Error('请求过大')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function safeRelative(raw) {
  let rel
  try { rel = decodeURIComponent(raw).replace(/^\/+/, '') } catch { return null }
  if (!rel || rel.includes('\0') || isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).some(part => part === '..')) return null
  return rel
}
function latestMtime(dir) {
  let max = 0
  if (!existsSync(dir)) return max
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    max = Math.max(max, entry.isDirectory() ? latestMtime(path) : statSync(path).mtimeMs)
  }
  return max
}

export function createRoutes(ctx, wb, handoff = null) {
  const store = wb.store
  const streams = new Set()
  const thumbJobs = new Map()

  async function action(args) {
    switch (args.action) {
      case 'works': return wb.works(args)
      case 'bootstrap': return wb.bootstrap(args)
      case 'page': return wb.page(args)
      case 'changes': return wb.changes(args)
      case 'line': return wb.line(args)
      case 'layer': return wb.layer(args)
      case 'relayout': return wb.relayout(args)
      case 'finalize': return wb.finalize(args)
      case 'precompose': return wb.precompose(args)
      case 'prefetch': return wb.prefetch(args)
      case 'gc': return wb.gc(args)
      case 'import-images': return wb.importImages(args)
      case 'insert-images': return wb.insertImages(args)
      case 'move-page': return wb.movePage(args)
      case 'export-ordered': return wb.exportOrdered(args)
      case 'delete-work': return wb.deleteWork(args)
      case 'prepare-preview': return wb.preparePreview(args)
      case 'translation-status': return wb.translationStatus(args)
      case 'page-state': return wb.pageState(args)
      case 'settings': return wb.saveSettings(args)
      case 'characters': return wb.saveCharacters(args)
      case 'scene': return wb.sceneAction(args)
      case 'cast': return wb.cast(args)
      case 'sticker-edit': return wb.sticker(args)
      case 'sticker': return wb.sticker(args)
      case 'assets': return wb.config.assets.view(args)
      case 'asset-update': return wb.config.assets.update(args.asset_id, args.patch ?? {})
      case 'assets-import': {
        const picked = Array.isArray(args.paths) ? { paths: args.paths } : await wb.pickImagePaths()
        return wb.config.assets.import(picked.paths ?? [])
      }
      case 'ps-open': return handoff.psOpen(args)
      case 'ps-done': return handoff.psDone(args)
      case 'ps-state': store.shot(args.shot_id); return handoff.state(args)
      case 'ps-restore': return handoff.restore(args)
      case 'mapping': return wb.exportMapping(args.work_id)
      case 'layout': return store.setLayout(args.shot_id, args.version, args.language, args.layout)
      case 'delete': return wb.discard(args.shot_id)
      case 'restore': return wb.restoreShot(args.shot_id)
      case 'export': return wb.exportFinal(args)
      default: throw new Error('未知工作台动作')
    }
  }

  async function getAsset(url, res) {
    const action = url.searchParams.get('action')
    if (action === 'sprite') {
      const sig = url.searchParams.get('sig') ?? ''
      const path = join(wb.config.dataDir, 'sprites', `${sig}.png`)
      if (!/^[0-9a-f]{16,64}$/.test(sig) || !existsSync(path)) return notFound(res)
      return sendFile(res, path, 'image/png', 'private, max-age=31536000, immutable')
    }
    if (action === 'sticker') {
      const assets = wb.config.assets
      const kind = url.searchParams.get('kind') === 'thumb' ? 'thumb' : 'full'
      let path = null
      try { path = assets?.fileOf(url.searchParams.get('id') ?? '', kind) } catch { path = null }
      if (!path || !existsSync(path)) return notFound(res)
      return sendFile(res, path, 'image/png', 'private, max-age=300')
    }
    const id = url.searchParams.get('shot_id'), version = Number(url.searchParams.get('version')), lang = url.searchParams.get('language')
    const shot = store.shot(id)
    let path
    if (action === 'thumb') {
      if (!shot.image || !existsSync(shot.image)) return json(res, 404, { ok: false, error: '这一镜没有图片' })
      const st = statSync(shot.image)
      const key = createHash('sha256').update(`${shot.image}|${st.mtimeMs}|${st.size}`).digest('hex').slice(0, 24)
      const dir = join(wb.config.dataDir, 'thumbs')
      mkdirSync(dir, { recursive: true })
      path = join(dir, `${key}.jpg`)
      if (!existsSync(path)) {
        if (!thumbJobs.has(path)) {
          thumbJobs.set(path, wb.workers.thumb({ input: shot.image, output: path, size: 240 }).finally(() => thumbJobs.delete(path)))
        }
        await thumbJobs.get(path)
      }
      return sendFile(res, path, 'image/jpeg', 'private, max-age=86400')
    }
    if (action === 'asset') path = store.versionAt(id, version)?.image
    else if (action === 'preview-image' || action === 'preview-layer') {
      const proof = store.meta(`preview:${id}:${lang}`)
      if (proof?.version === version && shot.version === version) path = action === 'preview-image' ? proof.path
        : proof.layers.find(layer => layer.dialogue_id === url.searchParams.get('dialogue_id'))?.path
    } else if (action === 'final-image') {
      const final = store.meta(`final:${id}:${lang}`)
      if (shot.version === version && shot.approvals[lang]?.version === version && final?.version === version) path = final.path
    } else if (action === 'output') {
      path = wb.letteredPathOf(store.work(shot.work_id), shot)
    } else return json(res, 400, { ok: false, error: '未知图片动作' })
    if (!path || !existsSync(path)) return json(res, 404, { ok: false, error: '此版本资产不可用' })
    const type = /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : 'image/png'
    return sendFile(res, path, type, 'no-store')
  }

  const apiRoute = { kind: 'exact', path: API, async handler(req, res) {
    try {
      const url = new URL(req.url ?? API, 'http://127.0.0.1')
      if (req.method === 'GET' && url.searchParams.get('action')) return await getAsset(url, res)
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只支持工作台 POST/已登记图片 GET' })
      const args = await body(req)
      json(res, 200, { ok: true, data: await action(args) })
    } catch (error) { json(res, 400, { ok: false, error: error.message }) }
  } }

  const uiRoute = { kind: 'prefix', path: `${BASE}/ui`, handler(req, res) {
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const rest = pathname.slice(`${BASE}/ui`.length)
      if (rest === '/rev') return json(res, 200, { rev: String(Math.floor(latestMtime(UI_DIR))) })
      const rel = safeRelative(rest)
      const type = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[extname(rel ?? '').toLowerCase()]
      if (!rel || !type) return notFound(res)
      const path = resolve(UI_DIR, rel)
      if (!path.startsWith(resolve(UI_DIR) + sep) || !existsSync(path) || !statSync(path).isFile()) return notFound(res)
      sendFile(res, path, type, 'no-cache')
    } catch (error) { json(res, 500, { ok: false, error: error.message }) }
  } }

  function fontManifest() { return JSON.parse(readFileSync(wb.config.fontManifest, 'utf8').replace(/^﻿/, '')) }
  const fontPath = entry => isAbsolute(entry.path) ? entry.path : resolve(wb.config.fontManifest, '..', entry.path)
  const fontRoute = { kind: 'prefix', path: `${BASE}/fonts`, handler(req, res) {
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const key = safeRelative(pathname.slice(`${BASE}/fonts`.length))
      const manifest = fontManifest()
      if (key === 'faces.css') {
        const rules = Object.entries(manifest.fonts ?? {}).map(([name, entry]) => {
          let version = 0
          try { version = Math.floor(statSync(fontPath(entry)).mtimeMs) } catch {                          }
          const weight = name === 'noto_serif' ? "\n  font-weight: 200;\n  font-variation-settings: 'wght' 200;" : ''
          return `@font-face {\n  font-family: "cw-${name}";\n  src: url("${BASE}/fonts/${name}?v=${version}");\n  font-display: swap;${weight}\n}`
        })
        res.statusCode = 200
        res.setHeader('content-type', 'text/css; charset=utf-8')
        res.setHeader('cache-control', 'no-cache')
        return res.end(rules.join('\n'))
      }
      const fontKey = manifest.fonts?.[key] ? key : manifest.styles?.[key]
      const entry = manifest.fonts?.[fontKey]
      if (!key || !entry || !existsSync(fontPath(entry))) return notFound(res)
      const ext = extname(entry.path).toLowerCase()
      const type = { '.ttf': 'font/ttf', '.ttc': 'font/collection', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff' }[ext] ?? 'application/octet-stream'
      sendFile(res, fontPath(entry), type, 'private, max-age=31536000, immutable')
    } catch (error) { json(res, 500, { ok: false, error: error.message }) }
  } }

  const liveRoute = { kind: 'prefix', path: `${BASE}/live`, handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const workId = url.searchParams.get('work_id')
    try { store.work(workId) } catch { return json(res, 404, { ok: false, error: '作品不存在' }) }
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    res.flushHeaders?.()
    const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch { stop() } }
    const stream = { stop }
    let unsubscribe = null, ping = null, stopped = false
    function stop() {
      if (stopped) return
      stopped = true
      unsubscribe?.()
      clearInterval(ping)
      streams.delete(stream)
      try { res.end() } catch {                      }
    }
    for (const row of store.changesSince(workId, url.searchParams.get('since') ?? 0)) send('change', row)
    unsubscribe = wb.subscribe(workId, event => {
      if (event.type === 'job') return send('job', event)
      const { type, ...row } = event
      void type
      send('change', row)
    })
    ping = setInterval(() => send('ping', { time: new Date().toISOString() }), 15000)
    streams.add(stream)

    if (typeof res.on === 'function') res.on('close', stop)
    else req.on?.('close', stop)
  } }

  function closeStreams() { for (const stream of [...streams]) stream.stop() }
  return { action, routes: [apiRoute, uiRoute, fontRoute, liveRoute], closeStreams, streams }
}

export function apply(ctx, config = {}) {
  const wb = createWorkbench(ctx, config)
  const assets = createAssets({ dataDir: wb.config.dataDir, imageInfo: (path) => wb.workers.imageInfo({ path }) })
  wb.config.assets = assets
  const handoff = createPhotoshop({ wb })
  const http = createRoutes(ctx, wb, handoff)
  for (const route of http.routes) {
    if (typeof ctx.effect === 'function') ctx.effect(() => ctx.webServer.register(route))
    else ctx.webServer.register(route)
  }
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    http.closeStreams()
    await handoff.close()
    await wb.close()
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  else ctx.on?.('dispose', dispose)
  ctx.logger?.info?.('嵌字工作台已加载（本地编辑，无模型服务）')
  return { wb, handoff, http, dispose }
}
