import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, existsSync } from 'node:fs'
import { createPhotoshop } from '../lib/ps.js'
import { fixture, add, hash, picture } from './helpers.js'

async function settle(ps) { await ps.tick(); await ps.tick() }
test('PS open/save, layout preservation, resize warning, history restore, stop', async () => {
  const { wb, id, image } = await fixture()
  let file
  const ps = createPhotoshop({ wb, open: path => { file = path }, interval: 100000, settleMs: 0 })
  const originalHash = hash(image)
  try {
    await add(wb, id, 'Background edit')
    const layers = JSON.stringify(wb.store.shot(id).layouts)
    await wb.finalize({ shot_id: id, version: wb.store.shot(id).version })
    await ps.psOpen({ shot_id: id })
    assert.ok(file && file !== image)
    picture(file, '#aaccee')
    await settle(ps)
    const revised = wb.store.shot(id)
    assert.notEqual(revised.image, image)
    assert.equal(JSON.stringify(revised.layouts), layers)
    assert.notEqual(revised.version, wb.store.finalized(id).version)
    assert.equal(hash(image), originalHash)
    await wb.finalize({ shot_id: id, version: revised.version })
    picture(file, '#bbccdd', 480, 640)
    await settle(ps)
    assert.equal(ps.state({ shot_id: id }).needs_relayout, true)
    assert.equal(JSON.stringify(wb.store.shot(id).layouts.zh.layers), JSON.stringify(JSON.parse(layers).zh.layers))
    await ps.restore({ shot_id: id, index: 0 })
    assert.equal(wb.store.shot(id).image, image)
    await ps.psOpen({ shot_id: id })
    await ps.psDone({ shot_id: id })
    const stopped = wb.store.shot(id).image
    picture(file, '#4488aa')
    await settle(ps)
    assert.equal(wb.store.shot(id).image, stopped)
  } finally { await ps.close(); await wb.close() }
})

test('PS bad PNG/PSD and failed launch do not replace current background', async () => {
  const { wb, id, image } = await fixture()
  let file
  const ps = createPhotoshop({ wb, open: path => { file = path }, interval: 100000, settleMs: 0 })
  try {
    await ps.psOpen({ shot_id: id })
    writeFileSync(file, 'partial PNG')
    await settle(ps)
    assert.equal(wb.store.shot(id).image, image)
    assert.match(ps.state({ shot_id: id }).error, /读取/)
    writeFileSync(file.replace('.png', '.psd'), 'bad PSD')
    await settle(ps)
    assert.equal(wb.store.shot(id).image, image)
    assert.match(ps.state({ shot_id: id }).error, /PSD/)
  } finally { await ps.close() }
  const missing = createPhotoshop({ wb, open: () => { throw new Error('Photoshop not installed') } })
  try {
    await assert.rejects(missing.psOpen({ shot_id: id }), /not installed/)
    assert.equal(missing.state({ shot_id: id }).active, false)
    assert.ok(existsSync(image))
  } finally { await missing.close(); await wb.close() }
})

test('compatible PSD composite is decoded and repeated saves update the page', async () => {
  const { wb, id } = await fixture()
  let file
  const ps = createPhotoshop({ wb, open: path => { file = path }, interval: 100000, settleMs: 0 })
  function savePsd(color) {
    // Minimal uncompressed RGB PSD with no layers and a valid merged composite.
    const header = Buffer.alloc(26)
    header.write('8BPS'); header.writeUInt16BE(1, 4); header.writeUInt16BE(3, 12)
    header.writeUInt32BE(800, 14); header.writeUInt32BE(640, 18)
    header.writeUInt16BE(8, 22); header.writeUInt16BE(3, 24)
    const data = Buffer.concat([header, Buffer.alloc(14), ...color.map(v => Buffer.alloc(640 * 800, v))])
    writeFileSync(file.replace('.png', '.psd'), data)
  }
  try {
    await ps.psOpen({ shot_id: id })
    savePsd([150, 200, 240])
    await settle(ps)
    assert.equal(ps.state({ shot_id: id }).error, null)
    const first = wb.store.shot(id)
    assert.ok(first.version > 1)
    savePsd([240, 200, 150])
    await settle(ps)
    assert.ok(wb.store.shot(id).version > first.version)
    assert.notEqual(hash(wb.store.shot(id).image), hash(first.image))
  } finally { await ps.close(); await wb.close() }
})
