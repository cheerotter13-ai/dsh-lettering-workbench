import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWorkbench } from '../lib/engine.js'
import { createAssets } from '../lib/assets.js'

export const python = process.env.TEST_PYTHON || 'python'
export function temp(label) {
  const root = process.env.TEST_TMPDIR || tmpdir()
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, `${label}-`))
}
export function picture(path, color = '#e0eaf5', width = 640, height = 800) {
  execFileSync(python, ['-c', 'from PIL import Image,ImageDraw\nimport sys\nim=Image.new("RGBA",(int(sys.argv[3]),int(sys.argv[4])),sys.argv[2]);im.save(sys.argv[1])',
    path, color, String(width), String(height)], { windowsHide: true })
}
export function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
export async function fixture(options = {}) {
  const root = temp('lettering'), input = join(root, 'input')
  mkdirSync(input)
  const image = join(input, 'page1.png'), second = join(input, 'page2.png')
  picture(image); picture(second, '#efe0f5')
  const wb = createWorkbench({ logger: { warn() {} } }, { dataDir: join(root, 'data'), pythonPath: python, autoGc: false, ...options })
  wb.config.assets = createAssets({ dataDir: wb.config.dataDir, imageInfo: path => wb.workers.imageInfo({ path }) })
  const imported = await wb.importImages({ paths: [second, image] })
  return { root, wb, image, second, work: imported.work, id: imported.shot.id }
}
export async function add(wb, id, text = '你好，世界', extra = {}) {
  return wb.line({ shot_id: id, version: wb.store.shot(id).version, op: 'add', kind: 'narration', speaker: 'none', text, ...extra })
}
