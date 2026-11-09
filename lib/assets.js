import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

export function createAssets({ dataDir, imageInfo }) {
  const dir = join(dataDir, 'stickers'), index = join(dir, 'index.json')
  mkdirSync(dir, { recursive: true })
  let items = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) : []
  function save() {
    writeFileSync(`${index}.tmp`, JSON.stringify(items, null, 2))
    renameSync(`${index}.tmp`, index)
  }
  function get(id) {
    const item = items.find(i => i.id === id)
    if (!item) throw new Error('素材不存在')
    return item
  }
  return {
    async import(paths) {
      let count = 0
      for (const path of paths) {
        if (extname(path).toLowerCase() !== '.png') throw new Error('贴纸请使用 PNG 图片')
        const size = await imageInfo(path)
        const bytes = readFileSync(path)
        const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
        if (items.some(i => i.id === id)) continue
        copyFileSync(path, join(dir, `${id}.png`))
        items.push({ id, rel: basename(path), width: size.width, height: size.height, category: '其他', text: '', mood: '', hidden: false })
        count++
      }
      save()
      return { count }
    },
    view({ category = '', q = '', hidden = false } = {}) {
      const counts = { 其他: items.filter(i => !i.hidden).length }
      return { available: true, categories: ['其他'], summary: { total: items.length, hidden: items.filter(i => i.hidden).length, counts },
        items: items.filter(i => (hidden || !i.hidden) && (!category || i.category === category) && `${i.rel} ${i.text} ${i.mood}`.toLowerCase().includes(q.toLowerCase())) }
    },
    update(id, patch) {
      const item = get(id)
      for (const key of Object.keys(patch)) {
        if (!['text', 'mood', 'hidden', 'category'].includes(key)) throw new Error('素材修改字段无效')
        if (key === 'hidden' ? typeof patch[key] !== 'boolean' : typeof patch[key] !== 'string') throw new Error('素材修改格式无效')
      }
      Object.assign(item, patch)
      save()
      return item
    },
    fileOf(id) { get(id); return join(dir, `${id}.png`) },
    stickerSource(id) {
      const item = get(id)
      return { asset_id: id, path: join(dir, `${id}.png`), width: item.width, aspect: item.height / item.width }
    },
  }
}
