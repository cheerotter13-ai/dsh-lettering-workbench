import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, rmSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')

export function findPhotoshop() {
  if (process.platform !== 'win32') return null
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const result = execFileSync('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe`, '/ve'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const file = result.match(/REG_SZ\s+(.+)/)?.[1]?.trim().replace(/^"|"$/g, '')
      if (file && existsSync(file)) return file
    } catch {                           }
  }
  return null
}

async function launch(file, configured) {
  const exe = configured || findPhotoshop()
  if (!exe || !existsSync(exe)) throw new Error('未找到 Photoshop，请安装或在插件配置中设置 photoshopPath')
  await new Promise((resolve, reject) => {
    const child = spawn(exe, [file], { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export function createPhotoshop({ wb, open = file => launch(file, wb.config.photoshopPath), interval = 1500, settleMs = 1500 }) {
  const sessions = new Map()
  let closed = false, scanning = null
  function state({ shot_id: id }) {
    const session = sessions.get(id)
    return { active: !!session, file: session?.file ?? null, error: session?.error ?? null,
      history: wb.store.meta(`ps-history:${id}`) ?? [], needs_relayout: !!wb.store.pageState(id).needs_relayout }
  }
  async function install(id, file) {
    const size = await wb.imageSize(file, { persist: false })
    if (closed) return
    const shot = wb.store.shot(id)
    const oldSize = await wb.imageSize(shot.image, { persist: false })
    if (closed) return
    const same = size.width === oldSize.width && size.height === oldSize.height
    const history = wb.store.meta(`ps-history:${id}`) ?? []
    if (!history.some(x => x.file === shot.image)) history.push({ file: shot.image, label: '之前的底图' })
    if (!history.some(x => x.file === file)) history.push({ file, label: '修图底图' })
    const current = wb.store.shot(id)
    if (current.image !== shot.image) throw new Error('底图已被其他操作替换，请重试')
    wb.store.transaction(() => {
      wb.store.edit(id, current.version, { image: file, image_width: size.width, image_height: size.height }, 'revision', { origin: 'user' })
      wb.store.meta(`ps-history:${id}`, history)
      wb.store.setPageState(id, { needs_relayout: !same })
    })
  }
  async function scan() {
    for (const [id, session] of sessions) {
      if (closed) break
      const candidates = [session.file, session.file.replace(/\.png$/i, '.psd')].filter(existsSync)
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      const path = candidates[0]
      if (!path) continue
      try {
        const st = statSync(path), key = `${path}|${st.mtimeMs}|${st.size}`
        if (key === session.done) continue
        if (session.pending !== key) { session.pending = key; session.since = Date.now(); continue }
        if (Date.now() - session.since < settleMs) continue
        const destination = join(session.dir, `${randomUUID()}.png`)
        try {
          if (extname(path).toLowerCase() === '.psd') {
            await run(wb.config.pythonPath, ['-c', 'from PIL import Image\nimport sys\nwith Image.open(sys.argv[1]) as im:\n im.load()\n im.convert("RGBA").save(sys.argv[2], "PNG")', path, destination],
              { windowsHide: true, timeout: 30000 })
          } else copyFileSync(path, destination)
          const after = statSync(path)
          if (after.mtimeMs !== st.mtimeMs || after.size !== st.size || sessions.get(id) !== session || closed) {
            rmSync(destination, { force: true }); continue
          }
          if (sha(destination) !== session.hash) {
            await install(id, destination)
            session.hash = sha(destination)
          } else rmSync(destination, { force: true })
          session.done = key
          session.error = null
        } catch (error) {
          rmSync(destination, { force: true })
          throw error
        }
      } catch (error) { session.error = `修图文件尚未成功读取：${error.message}。PSD 请保存兼容合成图。` }
    }
  }
  function tick() {
    if (closed) return Promise.resolve()
    if (!scanning) scanning = scan().finally(() => { scanning = null })
    return scanning
  }
  const timer = setInterval(() => { tick().catch(() => {}) }, interval)
  timer.unref?.()
  return {
    state, tick,
    async psOpen({ shot_id: id }) {
      const shot = wb.store.shot(id)
      if (sessions.has(id)) return state({ shot_id: id })
      if (!existsSync(shot.image)) throw new Error('底图不存在')
      const dir = join(wb.config.dataDir, 'ps-edits', id, randomUUID())
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'background.png')

      await run(wb.config.pythonPath, ['-c', 'from PIL import Image\nimport sys\nwith Image.open(sys.argv[1]) as im:\n im.convert("RGBA").save(sys.argv[2], "PNG")', shot.image, file],
        { windowsHide: true, timeout: 30000 })
      const st = statSync(file)
      await open(file)
      sessions.set(id, { dir, file, hash: sha(file), done: `${file}|${st.mtimeMs}|${st.size}`, error: null })
      return state({ shot_id: id })
    },
    async psDone({ shot_id: id }) { sessions.delete(id); await scanning; return state({ shot_id: id }) },
    async restore({ shot_id: id, index }) {
      if (!Number.isInteger(index)) throw new Error('历史项无效')
      const history = wb.store.meta(`ps-history:${id}`) ?? []
      if (!history[index]) throw new Error('历史项不存在')
      sessions.delete(id)
      await scanning
      await install(id, history[index].file)
      return state({ shot_id: id })
    },
    async close() { closed = true; clearInterval(timer); sessions.clear(); await scanning },
  }
}
