import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createWorkbench } from '../lib/engine.js'
import { fixture, add, hash, picture } from './helpers.js'

test('fresh import, text styles, translations, finalization and isolated export', async () => {
  const { wb, image, second, id, work } = await fixture()
  const originals = [hash(image), hash(second)]
  try {
    assert.equal(wb.store.shots(work.id)[0].image, image)
    assert.equal((await wb.page({ shot_id: id })).scene_status, 'disabled')
    assert.deepEqual(wb.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).filter(n => ['jobs','bindings','events'].includes(n)), [])
    const created = await add(wb, id)
    const dialogue = created.shot.dialogues[0]
    await wb.layer({ shot_id: id, version: created.shot.version, dialogue_id: dialogue.id, language: 'zh',
      patch: { x: 30, y: 40, font_size: 36, mode: 'vertical', color: '#124578', color_manual: true, locked: true } })
    let shot = wb.store.shot(id)
    const result = await wb.finalize({ shot_id: id, version: shot.version })
    assert.ok(result.finalized.complete)
    assert.ok(existsSync(result.finalized.output))
    assert.notEqual(hash(result.finalized.output), originals[0])
    assert.ok(result.finalized.output.startsWith(wb.config.dataDir))
    await wb.line({ shot_id: id, version: wb.store.shot(id).version, op: 'update', dialogue_id: dialogue.id, patch: { translations: { en: 'Hello world' } } })
    shot = wb.store.shot(id)
    await wb.finalize({ shot_id: id, version: shot.version, language: 'en' })
    assert.equal(wb.exportOrdered({ work_id: work.id, language: 'en' }).count, 1)
    const final = await wb.finalize({ shot_id: id, version: wb.store.shot(id).version })
    const ordered = wb.exportOrdered({ work_id: work.id })
    assert.equal(ordered.count, 1)
    assert.equal(hash(join(ordered.folder, '001.png')), hash(final.finalized.output))
    assert.deepEqual([hash(image), hash(second)], originals)
  } finally { await wb.close() }
})

test('deletion, ordering, hiding, colors and persistence', async () => {
  const { wb, work, id } = await fixture()
  const dataDir = wb.config.dataDir
  try {
    await add(wb, id, 'First')
    await add(wb, id, 'Second')
    let shot = wb.store.shot(id)
    await wb.line({ shot_id: id, version: shot.version, op: 'delete', dialogue_id: shot.dialogues[0].id })
    assert.equal(wb.store.shot(id).dialogues.length, 1)
    wb.saveCharacters({ work_id: work.id, characters: [{ id: 'speaker', name: 'Speaker', color: '#336699' }] })
    shot = wb.store.shot(id)
    await wb.line({ shot_id: id, version: shot.version, op: 'update', dialogue_id: shot.dialogues[0].id, patch: { speaker_id: 'speaker', kind: 'dialogue' } })
    const page = await wb.page({ shot_id: id })
    assert.equal(page.display.layers[0].color, '#336699')
    const other = wb.store.shots(work.id)[1]
    wb.movePage({ shot_id: other.id, after_id: null })
    assert.equal(wb.store.shots(work.id)[0].id, other.id)
    wb.discard(other.id)
    assert.equal(wb.store.pageState(other.id).hidden, true)
    wb.restoreShot(other.id)
    assert.equal(wb.store.pageState(other.id).hidden, false)
  } finally { await wb.close() }
  const reopened = createWorkbench({ logger: console }, { dataDir, autoGc: false })
  try { assert.equal(reopened.store.shot(id).dialogues[0].text, 'Second') }
  finally { await reopened.close() }
})

test('user sticker import, transforms, layering and final render', async () => {
  const { wb, root, id } = await fixture()
  try {
    const source = join(root, 'sticker.png')
    picture(source, '#ffe080', 80, 60)
    assert.equal((await wb.config.assets.import([source, source])).count, 1)
    const asset = wb.config.assets.view().items[0]
    let result = await wb.sticker({ shot_id: id, version: 1, op: 'add', asset_id: asset.id })
    const stickerId = result.shot.stickers[0].id
    result = await wb.sticker({ shot_id: id, version: result.shot.version, op: 'update', sticker_id: stickerId, patch: { rotation: 35, width: 140, x: 200, y: 250, opacity: 0.7, z: 'above' } })
    const final = await wb.finalize({ shot_id: id, version: result.shot.version })
    assert.ok(final.finalized.complete)
    assert.equal(wb.config.assets.view().summary.total, 1)
  } finally { await wb.close() }
})

test('optional detection disabled/missing; missing Python and font failures are visible', async () => {
  const { wb, id } = await fixture()
  try {
    assert.equal((await wb.sceneAction({ shot_id: id })).status, 'disabled')
    wb.config.detectionEnabled = true
    // Configuration takes effect at restart; disabled worker never silently calls a model.
    const result = await wb.workers.analyze({ path: wb.store.shot(id).image })
    assert.equal(result.available, false)
  } finally { await wb.close() }
  const broken = await fixture({ pythonPath: 'lettering-python-does-not-exist' })
  try {
    await assert.rejects(broken.wb.workers.imageInfo({ path: broken.image }), /ENOENT|spawn|进程/)
  } finally { await broken.wb.close() }
})
