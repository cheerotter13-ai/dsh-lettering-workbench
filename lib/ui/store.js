

import { React } from './react.js'
import * as api from './api.js'

export function createSaveQueue({ send, onChange = () => {} } = {}) {
  const items = []
  let seq = 0, running = false
  let waiters = []

  const busy = () => items.some(i => i.status === 'queued' || i.status === 'running')
  const notify = () => { try { onChange() } catch {                                         } }

  function settle() {
    if (busy()) return
    const list = waiters
    waiters = []
    list.forEach(fn => fn())
  }

  async function pump() {
    if (running) return
    const next = items.find(i => i.status === 'queued')
    if (!next) { settle(); return }
    running = true
    next.status = 'running'
    notify()
    try {
      const data = await send(next.action, next.params(), {})
      items.splice(items.indexOf(next), 1)
      try { next.apply?.(data) } catch (error) { console.error?.('[lettering-workbench] apply failed', error) }
      next.resolve(data)
    } catch (error) {
      next.status = 'error'
      next.error = error?.message || String(error)
      next.reject(error)
    } finally {
      running = false
      notify()
      pump()
    }
  }

  function push(op) {
    const item = { ...op, id: ++seq, status: 'queued', error: '' }
    item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject })
    item.promise.catch(() => {})
    items.push(item)
    notify()
    pump()
    return item.promise
  }

  return {
    push,
    whenIdle: () => busy() ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve(),
    idle: () => !busy(),
    snapshot: () => items.map(({ id, label, shotId, dialogueId, status, error }) =>
      ({ id, label, shotId, dialogueId, status, error })),
    errorsFor: shotId => items.filter(i => i.status === 'error' && (!shotId || i.shotId === shotId)),
    pendingFor: shotId => items.filter(i => i.status !== 'error' && (!shotId || i.shotId === shotId)).length,
    retry(id) {
      const item = items.find(i => i.id === id && i.status === 'error')
      if (!item) return null
      item.status = 'queued'
      item.error = ''
      item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject })
      item.promise.catch(() => {})
      notify()
      pump()
      return item.promise
    },
    dismiss(id) {
      const index = items.findIndex(i => i.id === id && i.status === 'error')
      if (index >= 0) items.splice(index, 1)
      notify()
      settle()
    },

    flush(fire) {
      const waiting = items.filter(i => i.status === 'queued')
      for (const item of waiting) {
        items.splice(items.indexOf(item), 1)
        try { fire(item.action, item.params()) } catch {                          }
        item.resolve(null)
      }
      if (waiting.length) notify()
      settle()
      return waiting.length
    },
  }
}

export function createUndoLog(limit = 50) {
  const pages = new Map()
  const of = id => {
    if (!pages.has(id)) pages.set(id, { undo: [], redo: [] })
    return pages.get(id)
  }
  return {
    record(shotId, entry) {
      const log = of(shotId)
      log.undo.push(entry)
      if (log.undo.length > limit) log.undo.shift()
      log.redo = []
    },
    undo(shotId) {
      const log = of(shotId), entry = log.undo.pop()
      if (entry) log.redo.push(entry)
      return entry || null
    },
    redo(shotId) {
      const log = of(shotId), entry = log.redo.pop()
      if (entry) log.undo.push(entry)
      return entry || null
    },
    canUndo: shotId => (pages.get(shotId)?.undo.length || 0) > 0,
    canRedo: shotId => (pages.get(shotId)?.redo.length || 0) > 0,
    clear(shotId) { pages.delete(shotId) },
  }
}

export function createLock() {
  let held = false
  return {
    get held() { return held },
    async run(task) {
      if (held) return null
      held = true
      try { return await task() } finally { held = false }
    },
  }
}

export const KINDS = { dialogue: '对白', thought: '内心', narration: '旁白', sfx: '拟声' }
export const KIND_FONT = { dialogue: 'wenkai', thought: 'wenkai', narration: 'wenkai', sfx: 'wenkai' }
export const FONTS = { wenkai: '霞鹜文楷' }
export const LANGUAGES = { zh: '中文', ja: '日文', ko: '韩文', en: '英文' }
export const RANGE_LIMIT = 60
export const QUICK_RANGE = 20
const storageKey = 'lettering-workbench:last'

const initialState = () => ({
  works: [], worksError: '',
  workId: '', work: null, pages: [], seq: 0, booting: false, bootError: '',
  shotId: '', page: null, pageLoading: false, pageError: '',
  language: 'zh', selectedId: '', overrides: {}, editingId: '',
  showOriginal: false, assignMode: false, markMode: false, zoom: null,
  filter: 'all', railAnchor: '', notice: null,
  ops: [], finalizing: false, finalizeError: '', readOnlyLocal: rememberedReadOnly(),
  tab: 'page', drawer: null, dialog: null,
  addFocus: 0,
  liveMode: '', scene: null, gcReport: null, undoTick: 0,
  stickerId: '', stickerOverrides: {},
  assets: null, assetsLoading: false, assetsError: '', assetFilter: { category: '', q: '', hidden: false },
})

let state = initialState()
let host = null
const listeners = new Set()

export function getState() { return state }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch
  if (!next) return
  state = { ...state, ...next }
  listeners.forEach(fn => fn())
}
export function useAppState() { return React.useSyncExternalStore(subscribe, getState, getState) }

export function setHost(value) { host = value }
export function getHost() { return host }

export function resetStore() {
  for (const timer of [idleTimer, refreshTimer, reloadTimer]) if (timer) clearTimeout(timer)
  idleTimer = refreshTimer = reloadTimer = null
  prefetched.clear()
  cycleIndex.clear()
  state = initialState()
  undoLog = createUndoLog()
  queue = makeQueue()
  drafts.clear()
  listeners.forEach(fn => fn())
}

let send = (action, params, opts) => api.call(action, params, opts)

let background = false
const makeQueue = () => createSaveQueue({
  send: (action, params) => send(action, params, background ? { keepalive: true } : {}),
  onChange: () => setState({ ops: queue.snapshot() }),
})
export let queue = makeQueue()
let undoLog = createUndoLog()
const finalizeLock = createLock()

export const canUndo = () => undoLog.canUndo(state.shotId)
export const canRedo = () => undoLog.canRedo(state.shotId)
export const whenIdle = () => queue.whenIdle()

export function notify(text, kind = 'info') {
  setState({ notice: text ? { text, kind, at: Date.now() } : null })
}

export function isReadOnly(s = state) {
  return s.readOnlyLocal ?? !!s.work?.settings?.read_only
}

export function visiblePages(s = state) { return s.pages.filter(p => !p.hidden) }

export function sortedDialogues(shot) {
  return [...(shot?.dialogues || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function textOf(dialogue, language = state.language) {
  if (!dialogue) return ''
  return language === 'zh' ? dialogue.text || '' : dialogue.translations?.[language] ?? ''
}

export function statusOf(row) {
  if (row.finalized_version != null && row.finalized_version === row.version) return 'final'
  if (row.finalized_version != null) return 'stale'
  return row.lines > 0 ? 'draft' : 'empty'
}

function updateRow(shotId, patch) {
  setState(s => ({
    pages: s.pages.map(row => {
      if (row.id !== shotId) return row
      const merged = { ...row, ...patch }
      return { ...merged, status: statusOf(merged) }
    }),
  }))
}

function rowFromShot(shot) {
  const dialogues = sortedDialogues(shot)
  updateRow(shot.id, {
    version: shot.version,
    lines: dialogues.length,
    text_preview: (dialogues[0]?.text || '').slice(0, 24),
  })
}

function versionOf(shotId) {
  if (state.page?.shot?.id === shotId) return state.page.shot.version
  const row = state.pages.find(p => p.id === shotId)?.version
  const board = state.board.find(b => b.shot_id === shotId)?.version
  return Math.max(row ?? -1, board ?? -1) >= 0 ? Math.max(row ?? -1, board ?? -1) : undefined
}

function readMemory() {
  try { return JSON.parse(globalThis.localStorage?.getItem(storageKey) || '{}') || {} } catch { return {} }
}
function writeMemory(patch) {
  try {
    const memory = { ...readMemory(), ...patch }
    if (patch.pages) memory.pages = { ...readMemory().pages, ...patch.pages }
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(memory))
  } catch {                                         }
}
export const lastWorkId = () => readMemory().workId || ''

function rememberedReadOnly() { const v = readMemory().readOnly; return typeof v === 'boolean' ? v : null }

const drafts = new Set()

export function registerDraft(commit) { drafts.add(commit); return () => drafts.delete(commit) }
export function commitDrafts() { for (const commit of [...drafts]) { try { commit() } catch {              } } }

export async function loadWorks() {
  try {
    const works = await send('works', {})
    setState({ works: Array.isArray(works) ? works : [], worksError: '' })
  } catch (error) { setState({ worksError: error.message }) }
}

export async function deleteWork() {
  const work = state.work
  if (!work) return false
  if (!askUser(`删除作品「${work.title}」？\n只删工作台里的记录：页面、台词、排版、版本。原图文件夹和已经导出的嵌字成品不删。删了不能恢复。`)) return false
  try {
    await send('delete-work', { work_id: work.id, confirm_title: work.title })
    await openWork('')
    await loadWorks()
    notify(`已删除「${work.title}」`)
    return true
  } catch (error) { notify(`没有删除：${error.message}`, 'warn'); return false }
}

let workToken = 0
export async function openWork(workId, { shotId } = {}) {
  commitDrafts()
  const token = ++workToken
  if (!workId) {
    setState({ workId: '', work: null, pages: [], shotId: '', page: null })
    return
  }
  setState({
    workId, work: null, pages: [], shotId: '', page: null, booting: true, bootError: '',
    railAnchor: '',

  })
  try {
    const boot = await send('bootstrap', { work_id: workId })
    if (token !== workToken) return
    const pages = (boot.pages || []).map(row => ({ ...row, status: row.status || statusOf(row) }))
    setState({ work: boot.work, pages, seq: boot.seq || 0, booting: false })
    Object.assign(FONTS, boot.fonts ?? {})
    writeMemory({ workId })
    if (boot.cache?.bytes && !cacheNoticed) {
      cacheNoticed = true
      notify(`预览缓存占了 ${(boot.cache.bytes / 2 ** 30).toFixed(1)} GB，可在「⋯ 更多 → 清理预览缓存」清理；同意一次后会自动清理`, 'warn')
    }
    const visible = visiblePages()
    const wanted = shotId || readMemory().pages?.[workId]
    const target = visible.find(p => p.id === wanted) || visible[0]
    if (target) await openPage(target.id)
  } catch (error) {
    if (token === workToken) setState({ booting: false, bootError: error.message })
  }
}

let cacheNoticed = false
let refreshTimer = null

export function refreshRows(delay = 3000) {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    refreshTimer = null
    const workId = state.workId
    if (!workId) return
    try {
      const boot = await send('bootstrap', { work_id: workId })
      if (state.workId !== workId) return
      const pages = (boot.pages || []).map(row => ({ ...row, status: row.status || statusOf(row) }))
      setState({ pages, work: boot.work || state.work, seq: Math.max(state.seq, boot.seq || 0) })
    } catch {                                   }
  }, delay)
}

function normalizePage(page) {
  return {
    ...page,
    display: { language: state.language, warnings: [], ...(page.display || {}), layers: page.display?.layers || [] },
    sprites: page.sprites || [],
    candidates: page.candidates || {},
    versions: page.versions || [],
    jobs: page.jobs || [],
    positions: {},
  }
}

let pageToken = 0
export async function openPage(shotId, { keepSelection = false } = {}) {
  if (!shotId) return
  commitDrafts()
  const previous = state.shotId
  if (previous && previous !== shotId) undoLog.clear(previous)
  const token = ++pageToken
  const same = previous === shotId
  setState({
    shotId, pageLoading: true, pageError: '',
    page: same ? state.page : null,
    selectedId: same && keepSelection ? state.selectedId : '',
    overrides: same ? state.overrides : {}, editingId: same ? state.editingId : '',
    stickerId: same && keepSelection ? state.stickerId : '', stickerOverrides: same ? state.stickerOverrides : {},
    assignMode: same && state.assignMode, markMode: same && state.markMode,
    finalizeError: same ? state.finalizeError : '', scene: same ? state.scene : null,
    showOriginal: false,
  })
  if (state.workId) writeMemory({ pages: { [state.workId]: shotId } })
  try {
    const page = await send('page', { shot_id: shotId, language: state.language })
    if (token !== pageToken) return
    const normalized = normalizePage(page)
    const ids = sortedDialogues(normalized.shot).map(d => d.id)
    const stickerKept = keepSelection && (normalized.shot?.stickers || []).some(st => st.id === state.stickerId)
    const selectedId = stickerKept ? '' : keepSelection && ids.includes(state.selectedId) ? state.selectedId : ids[0] || ''
    setState({ page: normalized, pageLoading: false, selectedId, stickerId: stickerKept ? state.stickerId : '' })
    if (normalized.shot) rowFromShot(normalized.shot)
    scheduleIdleWork()
  } catch (error) {
    if (token === pageToken) setState({ pageLoading: false, pageError: error.message })
  }
}

export const reloadPage = () => openPage(state.shotId, { keepSelection: true })

export function neighbor(delta) {
  const list = visiblePages()
  const index = list.findIndex(p => p.id === state.shotId)
  return index < 0 ? null : list[index + delta] || null
}

export function goPrev() {
  const row = neighbor(-1)
  if (row) openPage(row.id)
}

export function jumpTo(query) {
  const text = String(query || '').trim()
  if (!text) return false
  const list = visiblePages()
  const n = Number(text)
  const row = Number.isInteger(n) && n >= 1 && n <= list.length
    ? list[n - 1]
    : list.find(p => p.label === text) || list.find(p => String(p.label || '').includes(text))
  if (!row) { notify(`没有找到「${text}」`, 'warn'); return false }
  openPage(row.id)
  return true
}

let idleTimer = null
const prefetched = new Set()

export function scheduleIdleWork(delay = 1000) {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    const page = state.page
    if (!page?.shot || isReadOnly() || !queue.idle() || state.editingId) return
    const shot = page.shot
    send('precompose', { shot_id: shot.id, version: shot.version, language: state.language }).catch(() => {})
    if (!prefetched.has(shot.id)) {
      prefetched.add(shot.id)
      const list = visiblePages(), index = list.findIndex(p => p.id === shot.id)
      const ids = list.slice(Math.max(0, index - 10), index + 11).map(p => p.id).filter(id => id !== shot.id)
      if (ids.length) send('prefetch', { shot_ids: ids }).catch(() => {})
    }
  }, delay)
}

async function finalizeCurrent() {
  const shot = state.page?.shot
  if (!shot) throw new Error('这一页还没载入')
  const data = await send('finalize', { shot_id: shot.id, version: shot.version, language: state.language })
  undoLog.clear(shot.id)
  const fresh = data?.shot || shot
  const record = data?.finalized || {}
  if (state.page?.shot?.id === shot.id) {
    setState(s => ({ page: { ...s.page, shot: fresh, finalized: data?.finalized ?? s.page.finalized }, undoTick: s.undoTick + 1 }))
  }
  rowFromShot(fresh)
  updateRow(shot.id, {
    finalized_version: record.version ?? fresh.version,
    complete: record.complete ?? true, missing: record.missing || [], finalize_error: null,
  })
  return data
}

function localError(message) { const error = new Error(message); error.local = true; return error }

export function finalizeHere() {
  if (isReadOnly()) { notify('只读浏览中，不会定稿', 'warn'); return Promise.resolve(null) }
  return finalizeLock.run(async () => {
    const shotId = state.shotId
    setState({ finalizing: true, finalizeError: '' })
    try {
      commitDrafts()
      await queue.whenIdle()
      if (!shotId || state.shotId !== shotId || state.page?.shot?.id !== shotId) return null
      if (queue.errorsFor(state.shotId).length) throw localError('本页有没保存成功的修改，先重试或放弃再定稿')
      const data = await finalizeCurrent()
      notify(data?.finalized?.complete === false ? '已定稿，但有句子缺字' : '已定稿', data?.finalized?.complete === false ? 'warn' : 'info')
      return data
    } catch (error) {
      setState({ finalizeError: error.message })
      if (!error.local) updateRow(state.shotId, { finalize_error: error.message })
      if (/版本冲突|conflict/i.test(error.message)) reloadPage()
      return null
    } finally { setState({ finalizing: false }) }
  })
}

export function finalizeAndNext() {
  return finalizeLock.run(async () => {
    const shotId = state.shotId
    if (!shotId) return false
    commitDrafts()
    await queue.whenIdle()
    if (state.shotId !== shotId) return false
    if (queue.errorsFor(shotId).length) {
      notify('本页有没保存成功的修改，请先处理', 'warn')
      return false
    }
    const next = neighbor(1)
    if (next) await openPage(next.id)
    else notify('已是最后一页')
    return true
  }).then(result => result ?? false)
}

function mergePage(page, data, language) {
  const shot = data.shot || page.shot
  const stored = new Map((shot.layouts?.[language]?.layers || []).map(l => [l.dialogue_id, l]))
  const shown = new Map((page.display?.layers || []).map(l => [l.dialogue_id, l]))
  const dialogues = sortedDialogues(shot)
  const layers = data.display?.layers || dialogues.map(d => {
    const own = stored.get(d.id), old = shown.get(d.id)
    if (!own && !old) return null
    const base = own ? { ...old, ...own, transient: false } : old
    return { ...base, text: textOf(d, language), kind: d.kind, speaker_id: d.speaker_id }
  }).filter(Boolean)
  const alive = new Set(dialogues.map(d => d.id))
  const sprites = new Map(page.sprites.filter(s => alive.has(s.dialogue_id)).map(s => [s.dialogue_id, s]))
  for (const sprite of data.sprites || []) sprites.set(sprite.dialogue_id, sprite)
  return {
    ...page,
    shot,
    display: { ...page.display, layers, warnings: data.warnings ?? page.display.warnings },
    sprites: [...sprites.values()],
    positions: { ...page.positions, ...(data.candidates || {}) },
  }
}

function applyEdit(shotId, data, dialogueId) {
  if (!data) return
  if (data.shot) rowFromShot(data.shot)
  if (state.page?.shot?.id !== shotId) return
  const overrides = { ...state.overrides }
  if (dialogueId) delete overrides[dialogueId]
  setState({ page: mergePage(state.page, data, state.language), overrides })
  scheduleIdleWork()
}

function onEditError(shotId, error) {
  if (/版本冲突|conflict/i.test(error?.message || '') && state.shotId === shotId) {
    notify('这一页在别处改过，已重新载入；刚才那步没有覆盖新版本', 'warn')
    reloadPage()
  }
}

function blocked() {
  if (!isReadOnly()) return false
  notify('只读浏览中，不能修改（在顶栏关掉「只读浏览」后再改）', 'warn')
  return true
}

function edit({ label, action, build, dialogueId, shotId = state.shotId, after }) {
  if (blocked() || !shotId) return Promise.resolve(null)
  const language = state.language
  return queue.push({
    label, shotId, dialogueId, action,
    params: () => ({ shot_id: shotId, version: versionOf(shotId), language, ...build() }),
    apply: data => { applyEdit(shotId, data, dialogueId); after?.(data) },
  }).catch(error => { onEditError(shotId, error); return null })
}

function currentDialogue(id) {
  return sortedDialogues(state.page?.shot).find(d => d.id === id) || null
}
export function displayLayer(id) {
  const layer = state.page?.display?.layers?.find(l => l.dialogue_id === id)
  return layer ? { ...layer, ...(state.overrides[id] || {}) } : null
}

function run(spec, entry) {
  const p = spec.params
  if (spec.action === 'sticker') return stickerEdit('撤销贴图修改', p, { stickerId: p.sticker_id || p.sticker?.id })
  if (spec.action === 'layer') return patchLayer(p.dialogue_id, p.patch, { record: false })
  if (p.op === 'update') return updateLine(p.dialogue_id, p.patch, { record: false })
  if (p.op === 'reorder') return reorderLines(p.order, { record: false })
  if (p.op === 'delete') return deleteLine(p.dialogue_id, { record: false })
  if (p.op === 'add') return addLine(p, { record: false, entry })
  return Promise.resolve(null)
}

export function undo() {
  const entry = undoLog.undo(state.shotId)
  if (!entry) { notify('没有可撤销的修改'); return null }
  setState(s => ({ undoTick: s.undoTick + 1 }))
  return run(entry.inverse, entry)
}

export function redo() {
  const entry = undoLog.redo(state.shotId)
  if (!entry) { notify('没有可重做的修改'); return null }
  setState(s => ({ undoTick: s.undoTick + 1 }))
  return run(entry.forward, entry)
}

function record(entry) {
  if (isReadOnly()) return
  undoLog.record(state.shotId, entry)
  setState(s => ({ undoTick: s.undoTick + 1 }))
}

export function addLine(spec, { record: remember = true, entry } = {}) {
  const before = new Set(sortedDialogues(state.page?.shot).map(d => d.id))
  const params = {
    op: 'add', speaker: spec.speaker || 'pending', kind: spec.kind || 'dialogue',
    text: spec.text ?? '', ...(spec.name ? { name: spec.name } : {}), ...(spec.after ? { after: spec.after } : {}),
  }
  const mine = entry || (remember ? { label: '加一句', forward: { action: 'line', params } } : null)
  return edit({
    label: '加一句', action: 'line', build: () => params,
    after: data => {
      const created = sortedDialogues(data?.shot).find(d => !before.has(d.id))
      if (!created) return

      if (params.speaker === 'new') refreshRows(0)
      setState({ selectedId: created.id })
      if (!mine) return
      if (mine.forward.params.op === 'add') {

        if (mine.forward.params.speaker === 'new') {
          const { name: _name, ...rest } = mine.forward.params
          mine.forward = { ...mine.forward, params: { ...rest, speaker: created.speaker_id || 'pending' } }
        }
        mine.inverse = { action: 'line', params: { op: 'delete', dialogue_id: created.id } }
      } else {
        mine.forward = { action: 'line', params: { op: 'delete', dialogue_id: created.id } }
        const order = (mine.order || []).map(id => id === mine.deletedId ? created.id : id)
        mine.order = order
        mine.deletedId = created.id
        if (order.length) reorderLines(order, { record: false })
      }
      if (remember) record(mine)
    },
  })
}

export function updateLine(id, patch, { record: remember = true, label = '改句' } = {}) {
  const old = currentDialogue(id)
  if (!old) return Promise.resolve(null)
  if (remember) {
    const inverse = Object.fromEntries(Object.keys(patch).map(k => [k, old[k] ?? null]))

    if (patch.translations) {
      inverse.translations = Object.fromEntries(Object.keys(patch.translations)
        .map(lang => [lang, old.translations?.[lang] ?? '']))
    }
    if ('text' in inverse && inverse.text === null) inverse.text = ''
    record({ label, forward: { action: 'line', params: { op: 'update', dialogue_id: id, patch } },
      inverse: { action: 'line', params: { op: 'update', dialogue_id: id, patch: inverse } } })
  }
  return edit({ label, action: 'line', dialogueId: id, build: () => ({ op: 'update', dialogue_id: id, patch }) })
}

export function setLineText(id, text) {
  const old = currentDialogue(id)
  if (!old || textOf(old) === text) return Promise.resolve(null)
  const patch = state.language === 'zh' ? { text } : { translations: { ...(old.translations || {}), [state.language]: text } }
  return updateLine(id, patch, { label: '改字' })
}

export function deleteLine(id, { record: remember = true } = {}) {
  const list = sortedDialogues(state.page?.shot)
  const index = list.findIndex(d => d.id === id)
  if (index < 0) return Promise.resolve(null)
  const old = list[index]
  if (remember) {
    record({
      label: '删句', order: list.map(d => d.id), deletedId: id,
      forward: { action: 'line', params: { op: 'delete', dialogue_id: id } },
      inverse: { action: 'line', params: {
        op: 'add', speaker: old.speaker_id || 'pending', kind: old.kind, text: old.text || '',
        ...(list[index - 1] ? { after: list[index - 1].id } : {}),
      } },
    })
  }
  const nextSelected = list[index + 1]?.id || list[index - 1]?.id || ''
  if (state.selectedId === id) setState({ selectedId: nextSelected })
  return edit({ label: '删句', action: 'line', dialogueId: id, build: () => ({ op: 'delete', dialogue_id: id }) })
}

export function reorderLines(order, { record: remember = true } = {}) {
  const old = sortedDialogues(state.page?.shot).map(d => d.id)
  if (old.join() === order.join()) return Promise.resolve(null)
  if (remember) record({ label: '调整顺序', forward: { action: 'line', params: { op: 'reorder', order } },
    inverse: { action: 'line', params: { op: 'reorder', order: old } } })
  return edit({ label: '调整顺序', action: 'line', build: () => ({ op: 'reorder', order }) })
}

const LAYER_DEFAULTS = { locked: false, color_manual: false, mode: 'horizontal', rotation: 0, letter_spacing: 0 }
export function inverseLayerPatch(old, keys, kind) {
  const inverse = {}
  for (const key of keys) {
    let value = old?.[key]
    if (value === undefined || value === null) value = key === 'font' ? (kind || 'dialogue') : LAYER_DEFAULTS[key]
    if (value !== undefined && value !== null) inverse[key] = value
  }
  return inverse
}

export function patchLayer(id, patch, { record: remember = true, label = '调整位置' } = {}) {
  const old = displayLayer(id)
  if (!old) return Promise.resolve(null)
  if (remember) {
    const keys = [...new Set([...Object.keys(patch), ...('x' in patch || 'y' in patch || 'max_width' in patch || 'font_size' in patch ? ['locked'] : []),
      ...('color' in patch ? ['color_manual'] : [])])]
    const inverse = inverseLayerPatch(old, keys, currentDialogue(id)?.kind)
    record({ label, forward: { action: 'layer', params: { dialogue_id: id, patch } },
      inverse: { action: 'layer', params: { dialogue_id: id, patch: inverse } } })
  }
  if (!isReadOnly()) setState(s => ({ overrides: { ...s.overrides, [id]: { ...(s.overrides[id] || {}), ...patch } } }))
  return edit({ label, action: 'layer', dialogueId: id, build: () => ({ dialogue_id: id, patch }) })
}

export function relayout(ids) {
  return edit({ label: '本页重排', action: 'relayout', build: () => (ids?.length ? { dialogue_ids: ids } : {}) })
}

const cycleIndex = new Map()

export function cyclePosition(id) {
  if (!id) return Promise.resolve(null)
  const known = state.page?.positions?.[id]?.length || 5
  const index = ((cycleIndex.get(id) ?? 0) + 1) % Math.max(1, known)
  cycleIndex.set(id, index)
  return edit({ label: '换位置', action: 'relayout', dialogueId: id, build: () => ({ cycle: { dialogue_id: id, index } }) })
}

export function assignCast(assignments) {
  const shotId = state.shotId
  return edit({
    label: '指认人物', action: 'cast', build: () => ({ assignments }),
    after: () => {
      if (state.shotId !== shotId || !state.page) return
      setState(s => ({ page: { ...s.page, cast: { ...(s.page.cast || {}), assignments, confirmed: true, source: 'user' } } }))
    },
  })
}

export function castWith(assignments, characterId, index) {
  const next = {}
  for (const [id, value] of Object.entries(assignments || {})) if (id !== characterId && value !== index) next[id] = value
  next[characterId] = index
  return next
}

export function setSpeakerByIndex(n) {
  const id = state.selectedId
  if (!id) return null
  if (n === 0) return updateLine(id, { speaker_id: null }, { label: '换说话人' })
  const character = state.work?.characters?.[n - 1]
  if (!character) { notify(`没有第 ${n} 个角色`, 'warn'); return null }
  return updateLine(id, { speaker_id: character.id }, { label: '换说话人' })
}

export function selectLine(id) { setState({ selectedId: id, stickerId: '' }) }
export function stepLine(delta) {
  const list = sortedDialogues(state.page?.shot)
  if (!list.length) return
  const index = list.findIndex(d => d.id === state.selectedId)
  const next = list[(index + delta + list.length) % list.length]
  setState({ selectedId: next.id })
}

export function retryOp(id) { return queue.retry(id)?.catch(() => null) }
export function dismissOp(id) { queue.dismiss(id) }

let editorClosedAt = null
export function openEditor(id) {
  if (!id) return
  if (isReadOnly()) { notify('只读浏览中，不能改字', 'warn'); return }
  setState({ editingId: id, selectedId: id })
}
export function closeEditor() {
  editorClosedAt = Date.now()
  setState({ editingId: '' })
}
export const editorClosedTime = () => editorClosedAt

export function rangeIds(list, startId, endId) {
  const a = list.findIndex(p => p.id === startId), b = list.findIndex(p => p.id === endId)
  if (a < 0 || b < 0) return []
  return list.slice(Math.min(a, b), Math.max(a, b) + 1).map(p => p.id)
}

export function shiftSelect(id) { openPage(id) }



let reloadTimer = null
export function onLiveEvent({ type, data }) {
  if (type !== 'change' || !data) return
  if (Number(data.seq) > state.seq) setState({ seq: Number(data.seq) })
  if (data.shot_id === state.shotId && Number(data.version) > (versionOf(data.shot_id) || 0) && queue.idle() && !state.editingId) {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => { reloadTimer = null; if (queue.idle() && !state.editingId) reloadPage() }, 400)
  }
  refreshRows()
}

export async function saveSettings(patch) {
  if (!state.work) return null
  try {
    const data = await send('settings', { work_id: state.workId, settings: patch })
    const work = data?.id ? data : data?.work
    setState(s => ({ work: work || { ...s.work, settings: { ...(s.work.settings || {}), ...patch } } }))
    notify('作品设置已保存')
    return data
  } catch (error) { notify(error.message, 'error'); return null }
}

export async function saveCharacters(characters) {
  try {
    const data = await send('characters', { work_id: state.workId, characters })
    setState(s => ({ work: data?.work || { ...s.work, characters } }))
    const stale = Number(data?.stale_finalized) || 0
    notify(stale ? `角色已保存；${stale} 张已定稿页的颜色变了，需要重新定稿` : '角色已保存', stale ? 'warn' : 'info')
    if (state.shotId) reloadPage()
    return data
  } catch (error) { notify(error.message, 'error'); return null }
}

export function setReadOnly(value) { writeMemory({ readOnly: !!value }); setState({ readOnlyLocal: !!value }) }

export function setLanguage(language) {
  if (language === state.language) return
  commitDrafts()
  setState({ language })
  reloadPage()
}



function askUser(text) {
  try { return globalThis.confirm ? globalThis.confirm(text) : false } catch { return false }
}

export async function importImages() {
  try {
    const data = await send('import-images', {})
    if (data?.existing_work_id) {
      notify(data.message || '这个文件夹已经导入过，已打开那部作品', 'warn')
      await loadWorks()
      await openWork(data.existing_work_id)
      return data
    }
    if (data?.cancelled || !data?.work) return data
    await loadWorks()
    await openWork(data.work.id)
    return data
  } catch (error) { notify(error.message, 'error'); return null }
}

async function rereadRows() {
  const workId = state.workId
  const boot = await send('bootstrap', { work_id: workId })
  if (state.workId !== workId) return
  setState({ pages: (boot.pages || []).map(row => ({ ...row, status: row.status || statusOf(row) })), seq: Math.max(state.seq, boot.seq || 0) })
}

export async function insertImages() {
  if (blocked() || !state.workId) return null
  try {
    const data = await send('insert-images', { work_id: state.workId, after_id: state.shotId || null })
    if (data?.cancelled) return data
    await rereadRows()
    if (data.added?.[0]) await openPage(data.added[0])
    notify(`已插入 ${data.added.length} 页`)
    return data
  } catch (error) { notify(error.message, 'error'); return null }
}

export async function movePage(shotId, afterId) {
  if (blocked() || shotId === afterId) return false
  setState(s => {
    const moving = s.pages.find(p => p.id === shotId)
    if (!moving) return {}
    const rest = s.pages.filter(p => p.id !== shotId)
    const at = afterId ? rest.findIndex(p => p.id === afterId) + 1 : 0
    rest.splice(at, 0, moving)
    return { pages: rest.map((p, index) => ({ ...p, index })) }
  })
  try {
    await send('move-page', { shot_id: shotId, after_id: afterId || null })
    return true
  } catch (error) {
    notify(`没有挪动：${error.message}`, 'error')
    await rereadRows().catch(() => null)
    return false
  }
}

export async function exportOrdered() {
  if (!state.workId) return null
  try {
    const data = await send('export-ordered', { work_id: state.workId, language: state.language })
    const notes = [data.missing.length ? `${data.missing.length} 页没定稿没导出（${data.missing.slice(0, 5).join('、')}${data.missing.length > 5 ? '…' : ''}）` : '',
      data.stale.length ? `${data.stale.length} 页定稿后又改过，已跳过（${data.stale.slice(0, 5).join('、')}${data.stale.length > 5 ? '…' : ''}）` : ''].filter(Boolean)
    notify(`已按顺序导出 ${data.count} 页到 ${data.folder}${notes.length ? `；${notes.join('；')}` : ''}`, notes.length ? 'warn' : 'info')
    return data
  } catch (error) { notify(error.message, 'error'); return null }
}

export function addRegion(box, kind = 'protected', speakerId = null) {
  const shotId = state.shotId, language = state.language
  if (blocked() || !shotId) return Promise.resolve(null)
  return queue.push({
    label: '标记区域', shotId, action: 'layout',
    params: () => {
      const shot = state.page?.shot
      const old = shot?.layouts?.[language] || { language, layers: [], regions: { characters: [], protected: [] } }
      const regions = { characters: old.regions?.characters || [], protected: old.regions?.protected || [] }
      if (kind === 'character') regions.characters = [...regions.characters.filter(r => r.speaker_id !== speakerId), { ...box, speaker_id: speakerId }]
      else regions.protected = [...regions.protected, { ...box, kind: 'manual' }]
      return { shot_id: shotId, version: versionOf(shotId), language, layout: { ...old, regions, manual_regions_confirmed: false } }
    },
    apply: data => { if (data?.id) applyEdit(shotId, { shot: data }) },
  }).catch(error => { onEditError(shotId, error); return null })
}

export async function exportMapping() {
  try { return await send('mapping', { work_id: state.workId }) } catch (error) { notify(error.message, 'error'); return null }
}

export async function setHidden(shotId, hidden) {
  if (blocked()) return false
  const wasCurrent = shotId === state.shotId
  const next = wasCurrent ? (neighbor(1) || neighbor(-1)) : null
  try {
    await send('page-state', { shot_id: shotId, patch: { hidden } })
    updateRow(shotId, { hidden })
    if (hidden && wasCurrent && next) openPage(next.id)
    notify(hidden ? '这一页已隐藏（原图不动，可在「更多」里恢复）' : '已恢复这一页')
    return true
  } catch (error) { notify(error.message, 'error'); return false }
}

export async function gcDryRun() {
  try {
    const report = await send('gc', { dry_run: true })
    setState({ gcReport: report })
    return report
  } catch (error) { notify(error.message, 'error'); return null }
}

export async function gcRun() {
  try {
    const result = await send('gc', { dry_run: false, consent: true })
    setState({ gcReport: null, dialog: state.dialog === 'gc' ? null : state.dialog })
    notify(`已清理 ${result?.files ?? 0} 个缓存文件（先放进回收区，7 天后删除）`)
    return result
  } catch (error) { notify(error.message, 'error'); return null }
}

export async function loadScene() {
  const shotId = state.shotId
  if (!shotId) return null
  setState({ scene: { status: 'loading', scene: null } })
  try {
    const data = await send('scene', { shot_id: shotId })
    if (state.shotId === shotId) setState({ scene: data })
    return data
  } catch (error) {
    if (state.shotId === shotId) setState({ scene: { status: 'error', error: error.message, scene: null } })
    return null
  }
}

export function toggleAssign(on = !state.assignMode) {
  if (on && isReadOnly()) { notify('只读浏览中，不能指认', 'warn'); return }
  setState({ assignMode: on, markMode: false })
  if (on && !state.scene?.scene) loadScene()
}

export function flushNow() {
  commitDrafts()
  return queue.flush((action, params) => api.beacon(action, params))
}

export function setBackground(hidden) {
  background = !!hidden
  if (hidden) commitDrafts()
}

export async function exitPanel() {
  commitDrafts()
  if (!queue.idle()) notify('正在保存，保存完就退出…')
  await queue.whenIdle()
  host?.layout?.selectPanel?.(null)
}

export function setSender(fn) { send = fn || ((action, params, opts) => api.call(action, params, opts)) }

export function pageStickers(s = state) {
  return (s.page?.shot?.stickers || []).map(st => (s.stickerOverrides[st.id] ? { ...st, ...s.stickerOverrides[st.id] } : st))
}
function storedSticker(id) { return (state.page?.shot?.stickers || []).find(st => st.id === id) || null }

export function selectSticker(id) {
  setState(id ? { stickerId: id, selectedId: '', tab: 'assets' } : { stickerId: '' })
}

function dropStickerOverride(id) {
  if (!id || !state.stickerOverrides[id]) return
  setState(s => {
    const next = { ...s.stickerOverrides }
    delete next[id]
    return { stickerOverrides: next }
  })
}

function stickerEdit(label, params, { stickerId, after } = {}) {
  return edit({ label, action: 'sticker', build: () => params, after })
    .finally(() => dropStickerOverride(stickerId))
}

export function addSticker(assetId, pos = {}) {
  if (!state.page?.shot) return Promise.resolve(null)
  return stickerEdit('加贴图', { op: 'add', asset_id: assetId, ...pos }, {
    after: data => {
      const list = data?.shot?.stickers || []
      const index = list.findIndex(st => st.id === data?.sticker_id)
      if (index < 0) return
      const created = list[index]
      setState({ stickerId: created.id, selectedId: '' })
      record({ label: '加贴图', forward: { action: 'sticker', params: { op: 'restore', sticker: created, index } },
        inverse: { action: 'sticker', params: { op: 'delete', sticker_id: created.id } } })
    },
  })
}

export function patchSticker(id, patch, { record: remember = true, label = '调整贴图' } = {}) {
  const old = storedSticker(id)
  if (!old) return Promise.resolve(null)
  const keys = Object.keys(patch)
  if (keys.every(key => old[key] === patch[key])) return Promise.resolve(null)
  if (remember) {
    record({ label, forward: { action: 'sticker', params: { op: 'update', sticker_id: id, patch } },
      inverse: { action: 'sticker', params: { op: 'update', sticker_id: id, patch: Object.fromEntries(keys.map(k => [k, old[k]])) } } })
  }
  if (!isReadOnly()) setState(s => ({ stickerOverrides: { ...s.stickerOverrides, [id]: { ...(s.stickerOverrides[id] || {}), ...patch } } }))
  return stickerEdit(label, { op: 'update', sticker_id: id, patch }, { stickerId: id })
}

export function deleteSticker(id) {
  const list = state.page?.shot?.stickers || []
  const index = list.findIndex(st => st.id === id)
  if (index < 0) return Promise.resolve(null)
  record({ label: '删贴图', forward: { action: 'sticker', params: { op: 'delete', sticker_id: id } },
    inverse: { action: 'sticker', params: { op: 'restore', sticker: list[index], index } } })
  if (state.stickerId === id) setState({ stickerId: '' })
  return stickerEdit('删贴图', { op: 'delete', sticker_id: id })
}

export function orderSticker(id, to) {
  const old = (state.page?.shot?.stickers || []).map(st => st.id)
  if (!old.includes(id)) return Promise.resolve(null)
  const rest = old.filter(x => x !== id)
  const order = to === 'back' ? [id, ...rest] : [...rest, id]
  if (order.join() === old.join()) return Promise.resolve(null)
  record({ label: '调整贴图前后', forward: { action: 'sticker', params: { op: 'arrange', order } },
    inverse: { action: 'sticker', params: { op: 'arrange', order: old } } })
  return stickerEdit('调整贴图前后', { op: 'arrange', order })
}

export async function loadAssets(filter = {}) {
  const wanted = { ...state.assetFilter, ...filter }
  setState({ assetFilter: wanted, assetsLoading: true })
  try {
    const data = await send('assets', wanted)
    if (JSON.stringify(state.assetFilter) !== JSON.stringify(wanted)) return data
    setState({ assets: data, assetsLoading: false, assetsError: '' })
    return data
  } catch (error) {
    setState({ assetsLoading: false, assetsError: error.message })
    return null
  }
}
export async function scanAssets() {
  try { await send('assets-import', {}); await loadAssets() } catch (error) { notify(error.message, 'error') }
}
export async function updateAsset(id, patch) {
  try {
    await send('asset-update', { asset_id: id, patch })
  } catch (error) { notify(`素材没改成：${error.message}`, 'error') }
  return loadAssets()
}

