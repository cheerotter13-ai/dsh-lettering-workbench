import { closeSync, constants, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export function naturalCompare(a, b) {
  const left = String(a).toLowerCase().match(/\d+|\D+/g) ?? []
  const right = String(b).toLowerCase().match(/\d+|\D+/g) ?? []
  const count = Math.max(left.length, right.length)
  for (let i = 0; i < count; i++) {
    const x = left[i] ?? ''
    const y = right[i] ?? ''
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const diff = BigInt(x) - BigInt(y)
      if (diff !== 0n) return diff < 0n ? -1 : 1
    } else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function letteredName(filename) {
  return extname(filename).toLowerCase() === '.png' ? filename : `${basename(filename, extname(filename))}.png`
}

export function folderTitle(folder) { return basename(resolve(folder)) }

export function importPlan(paths) {
  const files = [...new Set((paths ?? []).map(path => resolve(path)))]
  if (!files.length) throw new Error('没有选中图片')
  for (const file of files) {
    if (!IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) throw new Error('只能选择 png、jpg、jpeg、webp 图片')
  }
  const folders = new Set(files.map(file => dirname(file).toLowerCase()))
  if (folders.size !== 1) throw new Error('请在同一个文件夹里选择图片')
  const sorted = files.sort((a, b) => naturalCompare(basename(a), basename(b)) || naturalCompare(a, b))
  const names = sorted.map(file => basename(file).toLowerCase())
  if (new Set(names).size !== names.length) throw new Error('文件名重复，不能导入')

  const outputs = sorted.map(file => letteredName(basename(file)).toLowerCase())
  if (new Set(outputs).size !== outputs.length) throw new Error('有同名但扩展名不同的图（如 a.jpg 和 a.png），嵌字成品会互相覆盖，不能导入')
  const folder = dirname(sorted[0])
  const outputDir = join(dirname(folder), '嵌字成品')
  return {
    folder,
    files: sorted,
    title: folderTitle(folder),
    output_dir: outputDir,
    original_dir: join(outputDir, '原版'),
  }
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sha = path => hash(readFileSync(path))

function writeDurable(path, bytes) {
  const fd = openSync(path, 'w')
  try {
    writeSync(fd, bytes)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

export function publishFinal({ sourcePath, previewPath, folder, outputDir, originalDir, historyDir = null, previewHash = null, sourceHash = null, outputName = null, originalSource = sourcePath }) {
  const source = resolve(sourcePath)
  if (!existsSync(source)) throw new Error('原图不存在，不能定稿')
  if (dirname(source).toLowerCase() !== resolve(folder).toLowerCase()) throw new Error('原图不在导入文件夹里')
  if (!existsSync(previewPath)) throw new Error('预览不存在，不能定稿')
  const name = outputName ?? basename(source)
  const letteredPath = join(outputDir, letteredName(name))
  const originalPath = join(originalDir, name)
  if (resolve(originalPath) === source || resolve(letteredPath) === source) throw new Error('拒绝覆盖原图')
  const sourceBefore = sha(source)
  if (sourceHash && sourceBefore !== sourceHash) throw new Error('原图被改动，已中止')
  const bytes = readFileSync(previewPath)
  const outputHash = hash(bytes)
  if (previewHash && outputHash !== previewHash) throw new Error('嵌字成品与预览不一致')
  mkdirSync(outputDir, { recursive: true })
  const tmp = join(outputDir, `.${letteredName(name)}.tmp`)
  try {
    writeDurable(tmp, bytes)
    let history = null
    if (historyDir && existsSync(letteredPath) && sha(letteredPath) !== outputHash) {
      mkdirSync(historyDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      history = join(historyDir, `${basename(letteredName(name), '.png')}.${stamp}.png`)
      copyFileSync(letteredPath, history)
    }
    renameSync(tmp, letteredPath)
    mkdirSync(originalDir, { recursive: true })
    const originalCreated = !existsSync(originalPath)

    if (originalCreated) copyFileSync(originalSource, originalPath, constants.COPYFILE_EXCL)
    if (sha(source) !== sourceBefore) throw new Error('原图被改动，已中止')
    if (sha(letteredPath) !== outputHash) throw new Error('嵌字成品与预览不一致')
    if (originalCreated && sha(originalPath) !== sourceBefore) throw new Error('原版副本与原图不一致')
    return { lettered: letteredPath, original: originalPath, original_created: originalCreated,
      history, sha256: outputHash, source_hash: sourceBefore, source_unchanged: true }
  } finally {
    rmSync(tmp, { force: true })
  }
}

export function writeLetteringOutputs({ sourcePath, previewPath, folder, previewHash }) {
  const plan = importPlan([resolve(sourcePath)])
  if (plan.folder.toLowerCase() !== resolve(folder).toLowerCase()) throw new Error('原图不在导入文件夹里')
  const result = publishFinal({ sourcePath, previewPath, folder, outputDir: plan.output_dir,
    originalDir: plan.original_dir, previewHash })
  return { lettered: result.lettered, original: result.original, original_created: result.original_created, source_unchanged: true }
}
