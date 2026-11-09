import test from 'node:test'
import assert from 'node:assert/strict'
import { planLayout } from '../lib/layout.js'

test('basic layout respects manually protected regions without detection', async () => {
  const shot = { dialogues: [{ id: 'text', text: 'Hello', kind: 'narration', order: 0 }],
    layouts: { zh: { layers: [], regions: { protected: [{ x: 0, y: 0, width: 640, height: 400, kind: 'manual' }] } } } }
  const result = await planLayout({ shot, work: { characters: [] }, size: { width: 640, height: 800 } })
  assert.ok(result.layers[0].y >= 400, 'text must stay below the protected top half')
  assert.equal(result.warnings.some(w => w.code === 'no_space'), false)
})

test('relayout preserves locked manual text positions', async () => {
  const layer = { dialogue_id: 'text', x: 54, y: 72, font_size: 36, max_width: 180, locked: true }
  const shot = { dialogues: [{ id: 'text', text: 'Hello', kind: 'narration', order: 0 }],
    layouts: { zh: { layers: [layer] } } }
  const result = await planLayout({ shot, work: { characters: [] }, size: { width: 640, height: 800 } })
  assert.deepEqual(result.layers[0], layer)
})
