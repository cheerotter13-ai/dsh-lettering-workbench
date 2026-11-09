

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

export const MAX_STICKERS = 60
const FIELDS = ['id', 'asset_id', 'path', 'aspect', 'x', 'y', 'width', 'rotation', 'opacity', 'z', 'flip', 'locked']
const PATCHABLE = ['x', 'y', 'width', 'rotation', 'opacity', 'z', 'flip', 'locked']
const finite = value => typeof value === 'number' && Number.isFinite(value)

export function validateSticker(sticker) {
  if (!sticker || typeof sticker !== 'object' || Array.isArray(sticker)) throw new Error('贴图格式无效')
  if (Object.keys(sticker).some(key => !FIELDS.includes(key))) throw new Error('贴图字段不支持')
  if (typeof sticker.id !== 'string' || !/^[\w-]{1,64}$/.test(sticker.id)) throw new Error('贴图 ID 无效')
  if (typeof sticker.asset_id !== 'string' || !/^[0-9a-f]{16}$/.test(sticker.asset_id)) throw new Error('贴图素材 ID 无效')
  if (typeof sticker.path !== 'string' || !sticker.path) throw new Error('贴图素材路径无效')
  const ranges = { aspect: [0.01, 100], x: [-100000, 100000], y: [-100000, 100000], width: [4, 16384], rotation: [-360, 360], opacity: [0, 1] }
  for (const [field, [min, max]] of Object.entries(ranges)) {
    if (!finite(sticker[field]) || sticker[field] < min || sticker[field] > max) throw new Error(`贴图 ${field} 超出范围`)
  }
  if (!['below', 'above'].includes(sticker.z)) throw new Error('贴图层次无效')
  for (const flag of ['flip', 'locked']) if (typeof sticker[flag] !== 'boolean') throw new Error(`贴图 ${flag} 必须是布尔值`)
}

export function validateStickers(list) {
  if (list === undefined) return
  if (!Array.isArray(list)) throw new Error('贴图必须是数组')
  if (list.length > MAX_STICKERS) throw new Error(`一页最多 ${MAX_STICKERS} 张贴图`)
  const ids = new Set()
  for (const sticker of list) {
    validateSticker(sticker)
    if (ids.has(sticker.id)) throw new Error('贴图 ID 重复')
    ids.add(sticker.id)
  }
}

export function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) throw new Error('缺少贴图修改')
  if (Object.keys(patch).some(key => !PATCHABLE.includes(key))) throw new Error('贴图修改字段不支持')
}

export function newSticker(source, { id, x, y, width, z, size }) {
  const pageWidth = size?.width || 832, pageHeight = size?.height || 1216

  const natural = finite(source.width) && source.width > 0 ? source.width * Math.max(pageWidth, pageHeight) / 1216 : Infinity
  let w = width ?? Math.round(Math.min(pageWidth / 3, natural))
  if (w * source.aspect > pageHeight / 2) w = Math.round(pageHeight / 2 / source.aspect)
  return { id, asset_id: source.asset_id, path: source.path, aspect: source.aspect,
    x: x ?? Math.round(pageWidth / 2), y: y ?? Math.round(pageHeight / 2), width: Math.max(4, w),
    rotation: 0, opacity: 1, z: z ?? 'below', flip: false, locked: false }
}

export function applyOp(list, op) {
  const current = Array.isArray(list) ? list : []
  const at = id => current.findIndex(s => s.id === id)
  if (op.op === 'add' || op.op === 'restore') {
    if (at(op.sticker.id) >= 0) throw new Error('贴图已经在页面上')
    const next = [...current]
    const index = op.op === 'restore' && Number.isInteger(op.index) ? Math.max(0, Math.min(op.index, next.length)) : next.length
    next.splice(index, 0, op.sticker)
    return next
  }
  if (op.op === 'arrange') {
    const order = Array.isArray(op.order) ? op.order : []
    if (order.length !== current.length || new Set(order).size !== order.length || order.some(id => at(id) < 0)) throw new Error('贴图顺序必须包含本页全部贴图')
    const next = order.map(id => current[at(id)])
    return next.every((s, i) => s.id === current[i].id) ? null : next
  }
  const index = at(op.sticker_id)
  if (index < 0) throw new Error('这张贴图已经不在页面上')
  if (op.op === 'delete') return current.filter((_, i) => i !== index)
  if (op.op === 'update') {
    validatePatch(op.patch)
    const next = { ...current[index], ...op.patch }
    if (FIELDS.every(key => next[key] === current[index][key])) return null
    return current.map((s, i) => (i === index ? next : s))
  }
  if (op.op === 'order') {
    const rest = current.filter((_, i) => i !== index)
    const moved = current[index]
    const next = op.to === 'front' ? [...rest, moved] : [moved, ...rest]
    return next.every((s, i) => s.id === current[i].id) ? null : next
  }
  throw new Error('未知贴图操作')
}

const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex')

export function documentStickers(list, resolve) {
  if (!Array.isArray(list) || !list.length) return null
  return list.map(sticker => {
    let path = null
    try { path = resolve?.(sticker.asset_id) || null } catch { path = null }
    if (!path) path = sticker.path
    const exists = !!path && existsSync(path)
    return { id: sticker.id, path, sha: exists ? fileSha(path) : null, x: sticker.x, y: sticker.y, width: sticker.width,
      height: Math.max(1, Math.round(sticker.width * sticker.aspect)), rotation: sticker.rotation, opacity: sticker.opacity,
      z: sticker.z, flip: sticker.flip }
  })
}
