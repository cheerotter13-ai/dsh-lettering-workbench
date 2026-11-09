import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { validateStickers } from './stickers.js'

const copy = value => JSON.parse(JSON.stringify(value))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const PAGE_DEFAULTS = Object.freeze({ hidden: false, edited: false, unlocked: false, finalize_error: null })

export const sourceKey = text => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 16)

export function stampTranslations(dialogues, previous = []) {
  for (const d of dialogues) {
    const before = previous.find(p => p.id === d.id)
    const src = { ...(before?.translation_src ?? {}), ...(d.translation_src ?? {}) }
    for (const language of Object.keys(src)) if (d.translations?.[language] === undefined) delete src[language]
    for (const [language, text] of Object.entries(d.translations ?? {})) {
      if (!before || before.translations?.[language] !== text || !src[language]) src[language] = sourceKey(d.text)
    }
    if (Object.keys(src).length) d.translation_src = src
    else delete d.translation_src
  }
}

export function translationGaps(shot, language) {
  const missing = [], stale = []
  for (const d of shot.dialogues ?? []) {
    const text = d.translations?.[language]
    if (typeof text !== 'string' || !text.trim()) missing.push(d.id)
    else if (d.translation_src?.[language] && d.translation_src[language] !== sourceKey(d.text)) stale.push(d.id)
  }
  return { missing, stale }
}

export class Store {
  constructor(path) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shots(id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), position REAL NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(shot_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(shot_id,version));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT NOT NULL, shot_id TEXT, version INTEGER, kind TEXT NOT NULL, time TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS changes_work ON changes(work_id, seq);`)
    this.inserts = 0
    this.pending = null
    this.onChange = null
  }
  close() { this.db.close() }
  transaction(fn) {

    if (this.pending) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.pending = []
    let rows
    try { const r = fn(); this.db.exec('COMMIT'); rows = this.pending; return r }
    catch (e) { this.db.exec('ROLLBACK'); throw e }
    finally { this.pending = null; if (rows) for (const row of rows) this.emit(row) }
  }
  emit(row) {
    try { this.onChange?.(row) } catch {                                    }
  }

  change(workId, shotId, version, kind) {
    const time = new Date().toISOString()
    const info = this.db.prepare('INSERT INTO changes(work_id,shot_id,version,kind,time) VALUES (?,?,?,?,?)')
      .run(workId, shotId ?? null, version ?? null, kind, time)
    const row = { seq: Number(info.lastInsertRowid), work_id: workId, shot_id: shotId ?? null, version: version ?? null, kind, time }
    if (++this.inserts % 500 === 0) this.pruneChanges(workId)
    if (this.pending) this.pending.push(row)
    else this.emit(row)
    return row
  }
  pruneChanges(workId, keep = 20000) {
    const edge = this.db.prepare('SELECT seq FROM changes WHERE work_id=? ORDER BY seq DESC LIMIT 1 OFFSET ?').get(workId, keep)
    if (edge) this.db.prepare('DELETE FROM changes WHERE work_id=? AND seq<=?').run(workId, edge.seq)
  }
  changesSince(workId, seq = 0) {
    return this.db.prepare('SELECT seq,shot_id,version,kind,time FROM changes WHERE work_id=? AND seq>? ORDER BY seq')
      .all(workId, Number(seq) || 0).map(r => ({ ...r }))
  }
  lastChange(workId) {
    return this.db.prepare('SELECT MAX(seq) AS seq FROM changes WHERE work_id=?').get(workId)?.seq ?? 0
  }
  read(table, id) {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id)
    if (!row) throw new Error(`${table} 不存在: ${id}`)
    return JSON.parse(row.body)
  }
  work(id) { return this.read('works', id) }
  shot(id) { return this.read('shots', id) }

  works() { return this.db.prepare('SELECT body FROM works').all().map(r => JSON.parse(r.body)) }
  shots(workId) { return this.db.prepare('SELECT body FROM shots WHERE work_id=? ORDER BY position').all(workId).map(r => JSON.parse(r.body)) }

  shotCounts() {
    const rows = this.db.prepare('SELECT work_id, COUNT(*) AS n FROM shots GROUP BY work_id').all()
    return Object.fromEntries(rows.map(r => [r.work_id, r.n]))
  }
  previousShot(id) {
    const row = this.db.prepare(`SELECT s.body FROM shots s JOIN shots c ON c.id=? AND s.work_id=c.work_id
      WHERE s.position < c.position ORDER BY s.position DESC LIMIT 1`).get(id)
    return row ? JSON.parse(row.body) : null
  }
  allShots() { return this.db.prepare('SELECT body FROM shots').all().map(r => JSON.parse(r.body)) }

  metaLike(prefix) {
    return this.db.prepare('SELECT key, body FROM meta WHERE substr(key,1,?)=?').all(prefix.length, prefix)
      .map(r => ({ key: r.key, value: JSON.parse(r.body) }))
  }
  versionAt(id, version) {
    const row = this.db.prepare('SELECT body FROM versions WHERE shot_id=? AND version=?').get(id, version)
    return row ? JSON.parse(row.body) : null
  }
  recentVersions(id, limit = 10) {
    return this.db.prepare('SELECT body FROM versions WHERE shot_id=? ORDER BY version DESC LIMIT ?')
      .all(id, limit).map(r => JSON.parse(r.body))
  }
  versions(id) { return this.db.prepare('SELECT body FROM versions WHERE shot_id=? ORDER BY version').all(id).map(r => JSON.parse(r.body)) }
  createWork({ id = randomUUID(), title, characters = [], source = null, report = [] }) {
    if (!title || !Array.isArray(characters) || new Set(characters.map(c => c.id)).size !== characters.length) throw new Error('作品/角色数据无效')
    const body = { id, title, characters, source, report, baseline_confirmed: false }
    this.db.prepare('INSERT INTO works VALUES (?,?)').run(id, JSON.stringify(body))
    return body
  }

  backupTo(file) {
    mkdirSync(dirname(file), { recursive: true })
    this.db.prepare('VACUUM INTO ?').run(file)
    return file
  }

  deleteWork(id) {
    this.work(id)
    const shotIds = this.db.prepare('SELECT id FROM shots WHERE work_id=?').all(id).map(r => r.id)
    const ids = [id, ...shotIds]
    return this.transaction(() => {
      for (const sid of shotIds) {
        this.db.prepare('DELETE FROM versions WHERE shot_id=?').run(sid)
      }

      const keys = this.db.prepare('SELECT key, body FROM meta').all()
        .filter(r => ids.some(x => r.key.includes(x) || false)).map(r => r.key)
      for (const key of keys) this.db.prepare('DELETE FROM meta WHERE key=?').run(key)
      for (const table of ['shots', 'changes']) this.db.prepare(`DELETE FROM ${table} WHERE work_id=?`).run(id)
      this.db.prepare('DELETE FROM works WHERE id=?').run(id)
      return { work_id: id, pages: shotIds.length, meta: keys.length }
    })
  }
  updateWork(id, patch) {
    const w = { ...this.work(id), ...copy(patch), id }
    if (new Set(w.characters.map(c => c.id)).size !== w.characters.length) throw new Error('角色 ID 重复')
    this.db.prepare('UPDATE works SET body=? WHERE id=?').run(JSON.stringify(w), id)
    this.change(id, null, null, 'work')
    return w
  }
  addShot(workId, input, position) {
    this.work(workId)
    const state = copy(input.state ?? input.entry_state ?? {})
    const shot = {
      id: input.id ?? randomUUID(), work_id: workId, version: 1,
      image: input.image ?? '', assets: input.assets ?? [], entry_state: state,
      changes: [], exit_state: copy(state), dialogues: input.dialogues ?? [],
      layouts: {}, approvals: {}, needs_review: false, visual: { status: 'not_checked' },
      ...copy(input), work_id: workId, version: 1,
    }
    stampTranslations(shot.dialogues)
    this.validateDialogues(shot)
    const pos = position ?? this.shots(workId).length + 1
    this.db.prepare('INSERT INTO shots VALUES (?,?,?,?)').run(shot.id, workId, pos, JSON.stringify(shot))
    this.db.prepare('INSERT INTO versions VALUES (?,?,?)').run(shot.id, 1, JSON.stringify(shot))
    this.change(workId, shot.id, 1, 'added')
    return shot
  }

  positions(workId) { return this.db.prepare('SELECT id, position FROM shots WHERE work_id=? ORDER BY position').all(workId) }

  moveShot(id, position) {
    const shot = this.shot(id)
    this.db.prepare('UPDATE shots SET position=? WHERE id=?').run(position, id)
    this.change(shot.work_id, id, shot.version, 'moved')
  }

  respace(workId) {
    this.positions(workId).forEach((row, i) => this.db.prepare('UPDATE shots SET position=? WHERE id=?').run(i + 1, row.id))
  }
  validateDialogues(shot) {
    if (!Array.isArray(shot.dialogues)) throw new Error('台词必须是数组')
    const speakers = new Set(this.work(shot.work_id).characters.map(c => c.id)), ids = new Set(), orders = new Set()
    for (const d of shot.dialogues) {
      if (!d.id || ids.has(d.id)) throw new Error('台词 ID 缺失或重复')
      ids.add(d.id)
      if (typeof d.text !== 'string' || !['dialogue', 'thought', 'narration', 'sfx'].includes(d.kind)) throw new Error('台词类型或正文无效')
      if (!Number.isInteger(d.order) || orders.has(d.order)) throw new Error('台词阅读顺序重复或无效')
      orders.add(d.order)
      if (['dialogue', 'thought', 'sfx'].includes(d.kind) && d.speaker_id && !speakers.has(d.speaker_id)) throw new Error('说话人需确认，不猜测归属')
      if (d.translations && Object.entries(d.translations).some(([k, v]) => !['en', 'ja', 'ko'].includes(k) || typeof v !== 'string')) throw new Error('译文无效')
    }
  }

  edit(id, version, patch, eventKind = 'revision', meta = {}) {
    return this.transaction(() => this.editInside(id, version, patch, eventKind, meta))
  }

  editInside(id, version, patch, eventKind = 'revision', meta = {}) {
    const current = this.shot(id)
    if (current.version !== version) throw new Error(`版本冲突: 预期 ${version}, 当前 ${current.version}`)
    const allowed = ['image', 'image_width', 'image_height', 'assets', 'entry_state', 'changes', 'exit_state', 'dialogues', 'layouts', 'visual', 'needs_review', 'stickers']
    if (Object.keys(patch).some(k => !allowed.includes(k))) throw new Error('非法修改字段')
    const next = { ...current, ...copy(patch), version: version + 1, approvals: {} }
    delete next.origin
    delete next.batch_id
    if (meta.origin) next.origin = meta.origin
    if (meta.batch_id) next.batch_id = meta.batch_id
    next.edited_at = new Date().toISOString()
    if (next.image !== current.image && (next.image_width !== current.image_width || next.image_height !== current.image_height)) {
      next.visual = { status: 'not_checked' }
      next.layouts = copy(next.layouts)
      for (const layout of Object.values(next.layouts)) {
        layout.manual_regions_confirmed = false
        layout.manual_regions_editing = false
        layout.manual_continuity_confirmed = false
        layout.regions = { characters: [], protected: [] }
      }
    }
    stampTranslations(next.dialogues, current.dialogues)
    this.validateDialogues(next)
    validateStickers(next.stickers)
    if (Array.isArray(next.stickers) && !next.stickers.length) delete next.stickers

    for (const layout of Object.values(next.layouts)) {
      if (!Array.isArray(layout.layers)) throw new Error('图层格式无效')
      for (const layer of layout.layers) {
        delete layer.text
        delete layer.transient
        if (!next.dialogues.some(d => d.id === layer.dialogue_id)) throw new Error('图层台词不存在')
        const dialogue = next.dialogues.find(d => d.id === layer.dialogue_id)
        const before = current.dialogues.find(d => d.id === layer.dialogue_id)
        if (before && dialogue.kind !== before.kind && (!layer.font || ['dialogue','thought','narration','sfx'].includes(layer.font))) layer.font = dialogue.kind
      }
    }

    this.db.prepare('UPDATE shots SET body=? WHERE id=?').run(JSON.stringify(next), id)
    this.db.prepare('INSERT INTO versions VALUES (?,?,?)').run(id, next.version, JSON.stringify(next))
    this.change(next.work_id, id, next.version, eventKind)
    return next
  }

  setLayout(id, version, language, layout, automatic = false, eventKind = 'revision') {
    if (!['zh', 'en', 'ja', 'ko'].includes(language)) throw new Error('语言不支持')
    const shot = this.shot(id)
    const next = copy(layout)
    if (automatic) for (const old of shot.layouts[language]?.layers ?? []) if (old.locked) {
      const i = next.layers.findIndex(l => l.dialogue_id === old.dialogue_id)
      if (i >= 0) next.layers[i] = copy(old)
      else next.layers.push(copy(old))
    }
    if (shot.version !== version) throw new Error('版本冲突')
    if (equal(shot.layouts[language], next)) return shot
    return this.edit(id, version, { layouts: { ...shot.layouts, [language]: next } }, eventKind)
  }
  approve(id, version, language, proof) {
    if (!proof.valid || !proof.preview_hash) throw new Error('排版未通过校验')
    return this.transaction(() => this.approveInside(id, version, language, proof))
  }
  approveInside(id, version, language, proof) {
    if (!proof.valid || !proof.preview_hash) throw new Error('排版未通过校验')
    const shot = this.shot(id)
    if (shot.version !== version) throw new Error('版本冲突')
    shot.approvals[language] = { ...proof, version, time: new Date().toISOString() }
    this.db.prepare('UPDATE shots SET body=? WHERE id=?').run(JSON.stringify(shot), id)
    this.change(shot.work_id, id, version, 'approved')
    return shot
  }

  finalized(shotId, language = 'zh') { return this.meta(`finalized:${shotId}:${language}`) }
  setFinalized(shotId, language, record) {
    const shot = this.shot(shotId)
    const value = { ...copy(record), work_id: record.work_id ?? shot.work_id }
    this.meta(`finalized:${shotId}:${language}`, value)
    this.change(shot.work_id, shotId, value.version ?? null, 'finalized')
    return value
  }

  finalizedAll() {
    const all = {}
    for (const row of this.db.prepare("SELECT key, body FROM meta WHERE key LIKE 'finalized:%'").all()) {
      const rest = row.key.slice('finalized:'.length), cut = rest.lastIndexOf(':')
      const shotId = rest.slice(0, cut), language = rest.slice(cut + 1)
      ;(all[shotId] ??= {})[language] = JSON.parse(row.body)
    }
    return all
  }
  pageState(shotId) {
    return { ...PAGE_DEFAULTS, ...(this.meta(`page:${shotId}`) ?? {}) }
  }

  setPageState(shotId, patch) {
    const shot = this.shot(shotId)
    const next = { ...this.pageState(shotId), ...copy(patch) }
    this.meta(`page:${shotId}`, next)
    this.change(shot.work_id, shotId, shot.version, 'page')
    return next
  }
  pageStates(workId) {
    const ids = new Set(this.db.prepare('SELECT id FROM shots WHERE work_id=?').all(workId).map(r => r.id))
    const states = {}
    for (const row of this.db.prepare("SELECT key, body FROM meta WHERE key LIKE 'page:%'").all()) {
      const id = row.key.slice('page:'.length)
      if (ids.has(id)) states[id] = { ...PAGE_DEFAULTS, ...JSON.parse(row.body) }
    }
    return states
  }

  hideShot(id) { return this.setPageState(id, { hidden: true }) }
  unhideShot(id) { return this.setPageState(id, { hidden: false }) }

  meta(key, value) {
    if (value !== undefined) this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key, JSON.stringify(value))
    return JSON.parse(this.db.prepare('SELECT body FROM meta WHERE key=?').get(key)?.body ?? 'null')
  }
}
