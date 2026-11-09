

const HEX = /^#[0-9a-f]{6}$/i
const PALETTE = ['#2f5f9a', '#9b3a4a', '#2f6f4e', '#7a4e2d', '#5c4d7a', '#8a5a2b', '#245c6b', '#6b3f55']

export function readableColor(value = '#222222') {
  if (!HEX.test(value)) throw new Error('颜色必须为 #RRGGBB')
  const channels = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  const scale = Math.min(1, 110 / Math.max(1, luminance))
  return '#' + channels.map(v => Math.round(v * scale).toString(16).padStart(2, '0')).join('')
}

export function characterColor(character, index = 0) {
  if (typeof character.color === 'string' && HEX.test(character.color)) return character.color
  if (character.faceless) return '#000000'
  const feature = character.gender === 'female' ? character.eye_color : character.hair_color
  const source = [feature, character.eye_color, character.hair_color].find(c => typeof c === 'string' && HEX.test(c))
  return readableColor(source ?? PALETTE[index % PALETTE.length])
}

export function autoLayout(shot, work, language, size, regions = {}) {
  const errors = [], layers = [], characters = regions.characters ?? []
  const faces = (regions.protected ?? []).filter(r => r.kind === 'face')
  const hard = [...(regions.protected ?? [])]
  let cursor = 36
  const hits = (box, extra) => extra.some(r =>
    box.x < r.x + r.width && box.x + box.width > r.x && box.y < r.y + r.height && box.y + box.height > r.y)
  for (const dialogue of [...shot.dialogues].sort((a, b) => a.order - b.order)) {
    const existing = shot.layouts[language]?.layers.find(l => l.dialogue_id === dialogue.id)
    if (existing?.locked) { layers.push({ ...existing }); cursor = existing.y + (existing.font_size ?? 36) * 2; continue }
    const text = language === 'zh' ? dialogue.text : dialogue.translations?.[language]
    if (text === undefined) { errors.push(`台词 ${dialogue.id} 缺少 ${language} 译文`); continue }
    const speaker = work.characters.find(c => c.id === dialogue.speaker_id)
    const region = characters.find(c => c.speaker_id === dialogue.speaker_id)
    const font_size = dialogue.kind === 'sfx' ? 48 : 36
    const plain = text.replace(/\s+/g, '')
    const clauses = plain.split(/(?<=[。！？…～~!?，、；：])/).filter(Boolean)
    const clauseWidths = (clauses.length ? clauses : [plain || ' ']).map(part => Math.max(font_size * 2, [...part].length * font_size))
    const widths = [...new Set(clauseWidths.map(w => Math.min(size.width - 48, Math.round(w))))].sort((a, b) => b - a)
    const others = characters.filter(c => c !== region)
    const anchorOf = body => ({ x: body.x + body.width / 2, y: body.y + Math.min(body.height * 0.35, 220) })
    const distance = (px, py, point) => Math.hypot(px - point.x, py - point.y)
    const place = max_width => {
      const lines = Math.ceil(Math.max(1, [...plain].length) * font_size / max_width)
      const height = Math.max(font_size + 26, lines * (font_size + 14) + 12)
      let best = null
      for (let y = 16; y + height <= size.height - 16; y += 36) {
        for (let x = 16; x + max_width <= size.width - 16; x += 36) {
          const box = { x, y, width: max_width, height }
          if (hits(box, hard)) continue
          if (layers.some(l => hits(box, [{ x: l.x, y: l.y, width: l.max_width || max_width, height: font_size * 2 }]))) continue
          const cx = x + max_width / 2, cy = y + height / 2
          if (others.some(body => cx > body.x && cx < body.x + body.width && cy > body.y && cy < body.y + body.height)) continue
          if (region && others.length) {
            const mine = distance(cx, cy, anchorOf(region))
            const nearestOther = Math.min(...others.map(body => distance(cx, cy, anchorOf(body))))
            if (!(mine < nearestOther)) continue
          }
          let score = region ? distance(cx, cy, anchorOf(region)) : y + x / 1000
          if (region && hits(box, [region])) score += 2000
          if (y + 8 < cursor) score += 800
          if (!best || score < best.score) best = { x, y, max_width, height, score }
        }
      }
      return best
    }
    let chosen = null
    for (const max_width of widths) { chosen = place(max_width); if (chosen) break }
    for (let max_width = (widths[0] || font_size * 4) - font_size; !chosen && max_width >= font_size * 3; max_width -= font_size) {
      chosen = place(max_width)
    }
    if (!chosen) {
      errors.push(`台词 ${dialogue.id} 空间不足，不缩字/删字，请人工校准`)
      chosen = { x: 24, y: cursor, max_width: widths[0] || font_size * 4, height: font_size + 26 }
    }
    const { max_width, height } = chosen
    layers.push({ dialogue_id: dialogue.id, x: chosen.x, y: chosen.y, font_size, font: dialogue.kind, mode: 'horizontal',
      rotation: dialogue.kind === 'sfx' ? -8 : 0, letter_spacing: dialogue.kind === 'sfx' ? 3 : 0,
      color: speaker ? characterColor(speaker, work.characters.indexOf(speaker)) : '#222222', max_width, locked: false })
    cursor = chosen.y + height + 20
  }
  const protectedRegions = [...new Map([...(regions.protected ?? []), ...faces].map(r => [JSON.stringify(r), r])).values()]
  return { language, layers, regions: { ...regions, protected: protectedRegions }, errors,
    manual_regions_confirmed: regions.manual_regions_confirmed === true }
}

export function renderDocument(shot, work, language, allowInvalid = false) {
  const dialogues = shot.dialogues ?? []
  const layout = shot.layouts?.[language] ?? (dialogues.length ? null : { layers: [] })
  if (!layout) throw new Error('此语言尚无独立排版')
  const source = layout.layers ?? []
  const ids = source.map(l => l.dialogue_id)
  if (new Set(ids).size !== ids.length || dialogues.some(d => !ids.includes(d.id))) throw new Error('台词漏排或图层重复')
  const characters = work.characters ?? []
  const layers = source.map(layer => {
    const d = dialogues.find(d => d.id === layer.dialogue_id)
    if (!d) throw new Error('台词不存在')
    const text = language === 'zh' ? d.text : d.translations?.[language]
    if (text === undefined) throw new Error(`${d.id} 缺少译文`)
    const speaker = characters.find(c => c.id === d.speaker_id)
    const color = !layer.color_manual && speaker ? characterColor(speaker, characters.indexOf(speaker)) : layer.color
    return { ...layer, color, text, speaker_id: d.speaker_id, kind: d.kind, order: d.order }
  }).sort((a, b) => a.order - b.order)
  const unordered = layers.some((l, i) => i > 0 && l.y <= layers[i - 1].y)
  if (unordered && !allowInvalid) throw new Error('台词阅读顺序必须从上到下')
  return { ...layout, layers, language, speaker_ids: characters.map(c => c.id),
    validation_errors: unordered ? [{ code: 'reading_order', message: '请将台词按阅读顺序从上到下排列' }] : [] }
}

export function paintSpeakerColors(shot, characters) {
  const colors = new Map(characters.map((c, i) => [c.id, characterColor(c, i)]))
  let changed = false
  const layouts = {}
  for (const [language, layout] of Object.entries(shot.layouts || {})) {
    layouts[language] = { ...layout, layers: (layout.layers || []).map(layer => {
      const dialogue = shot.dialogues.find(d => d.id === layer.dialogue_id)
      const color = colors.get(dialogue?.speaker_id)
      if (!color || layer.color_manual || layer.color === color) return layer
      changed = true
      return { ...layer, color }
    }) }
  }
  return { changed, layouts }
}

export const DEFAULT_STYLES = {
  dialogue: { font: 'dialogue', size_ratio: .042 },
  thought: { font: 'thought', size_ratio: .036 },
  narration: { font: 'narration', size_ratio: .034 },
  sfx: { font: 'sfx', size_ratio: .06 },
}
const MARGIN = 12
const GAP = 4

const GAP_X = 1.2, GAP_Y = .6
const PAD = 8
const CANDIDATES = 5
const CHAR_OPTIONS = [5, 6, 7, 8, 10, 12, 14, 16]

const SIZE_STEPS = [1, .875, .75, .625, .5]

const W = { anchor: 2.5, side: .6, nearerOther: .8, offscreen: 2, narration: 2, sfx: 2, fallbackBand: .8,
  fallbackCorner: 1.5, body: 1.5, busy: 1.2, order: 3, orderSide: .15, continuity: .4, widthPref: .015, wrap: 1.2, low: .3, hard: 8,
  tall: .5, crowd: .8 }
const MAX_LINES = 4

const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
const inflate = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d]
const center = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
const pointToBox = (p, b) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]))

function hashOf(text) {
  let h = 2166136261
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0
  return h
}

function units(text) {
  let n = 0
  for (const ch of text) n += ch.codePointAt(0) < 0x2e80 ? .55 : 1
  return n
}

const PHRASE_END = new Set('。！？…～~!?'), CLAUSE_END = new Set('，、；：,;')
const CLOSE_PUNCT = new Set('，。、！？：；）》」』】〉”’～~,!?;:)♡♥❤♪')
const GLUE = new Set('…—.')

export function wrapShape(text, perLine) {
  const sum = chars => chars.reduce((n, ch) => n + units(ch), 0)
  const lines = []
  for (const segment of String(text).split('\n')) {
    let current = []
    for (const ch of segment) {
      if (CLOSE_PUNCT.has(ch) && current.length) { current.push(ch); continue }
      if (GLUE.has(ch) && current.length && sum(current) + units(ch) > perLine + 1e-9) {

        let at = current.length; while (at > 0 && GLUE.has(current[at - 1])) at--
        if (at > 1) { lines.push(current.slice(0, at - 1)); current = current.slice(at - 1) }
        current.push(ch); continue
      }
      if (current.length && sum(current) + units(ch) > perLine + 1e-9) {
        const split = current.reduce((at, c, i) => (PHRASE_END.has(c) || CLAUSE_END.has(c) ? i + 1 : at), 0)
        if (split && sum(current.slice(split)) + units(ch) <= perLine) {
          lines.push(current.slice(0, split)); current = current.slice(split)
        } else { lines.push(current); current = [] }
      }
      current.push(ch)
    }
    lines.push(current)
  }
  return lines.map(sum)
}

export function shapePenalty(widths) {
  const lines = (widths ?? []).filter(n => n > 0)
  if (lines.length < 2) return 0
  const longest = Math.max(...lines)
  return lines.reduce((p, n) => p + Math.max(0, .6 - n / longest) * 3 + (n / longest <= .4 ? .6 : 0), 0)
}

export const wrapPenalty = (text, perLine) => shapePenalty(wrapShape(text, perLine))

const SOFT_BREAK = .7

function lineText(dialogue, language) {
  const text = language === 'zh' ? dialogue.text : dialogue.translations?.[language] ?? dialogue.text
  return String(text ?? '')
}

export function resolveStyle(settings, kind) {
  const base = DEFAULT_STYLES[kind] ?? DEFAULT_STYLES.dialogue
  const custom = settings?.styles?.[kind] ?? {}
  const ratio = Number(custom.size_ratio) > 0 ? Number(custom.size_ratio) : base.size_ratio
  return { font: custom.font || base.font, size_ratio: ratio }
}

export function estimateBox(text, fontSize, maxWidth, letterSpacing = 0, rotation = 0) {
  const step = fontSize + letterSpacing
  const perLine = Math.max(1, (maxWidth - 2 * PAD) / step)
  const segments = String(text || ' ').split('\n')
  const lines = segments.reduce((n, seg) => n + Math.max(1, Math.ceil(units(seg) / perLine - 1e-9)), 0)
  const longest = Math.max(...segments.map(seg => Math.min(units(seg), Math.floor(perLine))), 1)
  let width = Math.min(maxWidth, Math.ceil(longest * step + 2 * PAD))
  let height = Math.ceil(lines * (Math.ceil(fontSize * 1.45) + 8) - 8 + 2 * PAD)
  if (rotation) {
    const r = Math.abs(rotation) * Math.PI / 180
    ;[width, height] = [Math.ceil(width * Math.cos(r) + height * Math.sin(r)), Math.ceil(width * Math.sin(r) + height * Math.cos(r))]
  }
  return { max_width: maxWidth, width, height }
}

function widthOptions(text, fontSize, letterSpacing, imageWidth) {
  const longest = Math.max(1, ...String(text).split('\n').map(units))
  const counts = CHAR_OPTIONS.filter(n => n < longest)
  if (longest <= CHAR_OPTIONS.at(-1)) counts.push(Math.ceil(longest))
  const limit = imageWidth - 2 * MARGIN
  const widths = counts.map(n => Math.round(Math.min(limit, n * (fontSize + letterSpacing) + 2 * PAD + fontSize * .2)))
  return [...new Set(widths.map(w => Math.max(16, w)))].sort((a, b) => a - b)
}

function sceneModel(scene, size) {
  if (!scene) return null
  const sx = scene.width ? size.width / scene.width : 1
  const sy = scene.height ? size.height / scene.height : sx
  const scale = b => b && [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy]
  const people = (scene.people || []).map(p => {
    const box = scale(p.box || p.body || p.face)
    const face = scale(p.face)
    const body = scale(p.body) || box
    const hands = (p.hands || []).map(scale).filter(Boolean)

    const keys = (p.feet || []).map(scale).filter(Boolean)
    const head = face ? center(face) : box ? [(box[0] + box[2]) / 2, box[1] + (box[3] - box[1]) * .12] : null
    return { box, face, body, hands, keys, head }
  })
  let busy = null
  const g = scene.grid
  if (g && g.cols > 0 && g.rows > 0 && Array.isArray(g.busy) && g.busy.length >= g.cols * g.rows) {
    const cols = g.cols, rows = g.rows
    const sat = new Float64Array((cols + 1) * (rows + 1))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = Number(g.busy[r * cols + c]) || 0
        sat[(r + 1) * (cols + 1) + c + 1] = v + sat[r * (cols + 1) + c + 1] + sat[(r + 1) * (cols + 1) + c] - sat[r * (cols + 1) + c]
      }
    }
    busy = { cols, rows, cw: (g.cell_w || scene.width / cols) * sx, ch: (g.cell_h || scene.height / rows) * sy, sat }
  }

  const keys = (scene.keys || []).map(k => ({ kind: k.kind, box: scale(k.box) })).filter(k => k.box)
  return { people, keys, busy }
}

function busyMean(busy, box) {
  if (!busy) return 0
  const { cols, rows, cw, ch, sat } = busy
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(box[0] / cw))), c1 = Math.max(c0 + 1, Math.min(cols, Math.ceil(box[2] / cw)))
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(box[1] / ch))), r1 = Math.max(r0 + 1, Math.min(rows, Math.ceil(box[3] / ch)))
  const s = cols + 1
  const sum = sat[r1 * s + c1] - sat[r0 * s + c1] - sat[r1 * s + c0] + sat[r0 * s + c0]
  return sum / ((c1 - c0) * (r1 - r0))
}

function lineContext({ dialogue, model, cast, size, earlier = [], later = [], previous, speakers = 1, text = '', orderHard = false }) {
  const people = model?.people ?? []
  const assigned = cast?.assignments?.[dialogue.speaker_id]
  let person = Number.isInteger(assigned) && people[assigned] ? assigned : null

  if (person === null && assigned === undefined && people.length === 1 && dialogue.kind !== 'narration' &&
    (speakers <= 1 || dialogue.kind === 'sfx')) person = 0
  const speech = dialogue.kind === 'dialogue' || dialogue.kind === 'thought'
  const anchor = person !== null ? people[person].head : null
  const others = people.filter((p, i) => i !== person && p.head).map(p => p.head)
  let targets = []
  if (dialogue.kind === 'sfx') {
    const own = person !== null ? people[person].hands : []
    const hands = own.length ? own : people.flatMap(p => p.hands)
    targets = hands.length ? hands.map(center) : people.filter(p => p.body).map(p => center(p.body))
  }
  const continuity = (previous || [])
    .filter(p => p && p.speaker_id === (dialogue.speaker_id ?? null) && p.kind === dialogue.kind && Number.isFinite(p.x))
    .map(p => [p.x + (p.max_width || 0) / 2, p.y])

  const targetChars = Math.min(14, Math.max(8, Math.round(units(text) / 3)))
  return { kind: dialogue.kind, speech, anchor: speech ? anchor : null, others, targets,
    offscreen: speech && assigned === 'offscreen', earlier, later, continuity, size, model, targetChars, orderHard }
}

function softCost(box, ctx, chars) {
  const { width: Wd, height: Ht } = ctx.size
  const people = ctx.model?.people ?? []
  const [cx, cy] = center(box)
  let cost = 0
  if (ctx.anchor) {
    const own = pointToBox(ctx.anchor, box)
    cost += W.anchor * own / Wd
    if (ctx.others.length) {
      const mean = ctx.others.reduce((s, p) => s + p[0], 0) / ctx.others.length
      const away = Math.sign(ctx.anchor[0] - mean)
      if (away && (cx - ctx.anchor[0]) * away < 0) cost += W.side
      if (Math.min(...ctx.others.map(p => pointToBox(p, box))) < own) cost += W.nearerOther
    }
  } else if (ctx.offscreen) {
    cost += W.offscreen * Math.min(box[0], Wd - box[2], box[1], Ht - box[3]) / Wd
  } else if (ctx.kind === 'narration') {
    const corner = Math.min(...[[0, 0], [Wd, 0], [0, Ht], [Wd, Ht]].map(p => pointToBox(p, box))) / Wd
    const band = Math.min(box[1], Ht - box[3]) / Ht
    cost += W.narration * Math.min(corner, band)
  } else if (ctx.kind === 'sfx' && ctx.targets.length) {
    cost += W.sfx * Math.min(...ctx.targets.map(p => Math.hypot(p[0] - cx, p[1] - cy))) / Wd
  } else {

    const band = Math.max(0, Math.min(box[2], Wd * .7) - Math.max(box[0], Wd * .3)) / Math.max(1, box[2] - box[0])
    cost += W.fallbackBand * band + W.fallbackCorner * Math.min(pointToBox([0, 0], box), pointToBox([Wd, 0], box)) / Wd
  }

  if (!ctx.anchor && ctx.speech && ctx.others.length) {
    cost += W.crowd * Math.max(0, 1 - Math.min(...ctx.others.map(p => pointToBox(p, box))) / (Wd * .3))
  }

  if (ctx.speech) cost += W.low * box[1] / Ht
  const a = Math.max(1, area(box))
  let bodies = 0
  for (const p of people) if (p.body) bodies += overlap(box, p.body) / a
  cost += W.body * Math.min(1, bodies)
  cost += W.busy * busyMean(ctx.model?.busy, box)

  cost += Math.max(0, ...ctx.earlier.map(b => orderCost(b, box)), ...ctx.later.map(b => orderCost(box, b)))
  for (const p of ctx.continuity) cost -= W.continuity * Math.max(0, 1 - Math.hypot(p[0] - cx, p[1] - box[1]) / (Wd * .2))
  cost += W.widthPref * Math.abs(chars - ctx.targetChars)
  return cost
}

function orderCost(first, second) {
  if (second[1] > first[1] + 2) return 0
  if (second[0] >= first[2]) return W.orderSide
  return W.order
}

function violation(box, obstacles, size) {
  if (box[0] < MARGIN || box[1] < MARGIN || box[2] > size.width - MARGIN || box[3] > size.height - MARGIN) {
    const a = Math.max(1, area(box))
    const inside = overlap(box, [MARGIN, MARGIN, size.width - MARGIN, size.height - MARGIN])
    return 1 - inside / a + .001
  }
  let v = 0
  for (const o of obstacles) if (hit(box, o)) v += overlap(box, o) / Math.max(1, area(box)) + .001
  return v
}

function axis(lo, hi, stride) {
  if (hi < lo) return [lo]
  const out = []
  for (let v = lo; v < hi; v += stride) out.push(Math.round(v))
  out.push(Math.round(hi))
  return out
}

function search(measured, ctx, obstacles, hard) {
  const { width: Wd, height: Ht } = ctx.size
  const stride = Math.max(4, Math.round(Wd * .025))
  const pool = []
  const evaluate = (m, x, y) => {
    if (x < 0 || y < 0) return null
    const box = [x, y, x + m.width, y + m.height]
    const v = violation(box, obstacles, ctx.size)
    if (hard && v > 0) return null
    if (hard && ctx.orderHard && ctx.earlier.some(b => orderCost(b, box) >= W.order)) return null
    const cost = softCost(box, ctx, m.chars) + W.wrap * (m.wrap || 0) + W.tall * Math.max(0, (m.nLines || 1) - MAX_LINES) +
      (v > 0 ? W.hard * (1 + v) : 0)
    return { x, y, m, box, cost }
  }
  for (const m of measured) {
    for (const y of axis(MARGIN, Ht - MARGIN - m.height, stride)) {
      for (const x of axis(MARGIN, Wd - MARGIN - m.width, stride)) {
        const c = evaluate(m, x, y)
        if (c) pool.push(c)
      }
    }
  }
  pool.sort(byCost)

  const fine = Math.max(2, Math.round(stride / 3))
  const seen = new Set(pool.map(keyOf))
  for (const seed of pool.slice(0, 12)) {
    for (let dy = -stride; dy <= stride; dy += fine) {
      for (let dx = -stride; dx <= stride; dx += fine) {
        const x = seed.x + dx, y = seed.y + dy
        const key = `${seed.m.max_width}:${x}:${y}`
        if (seen.has(key)) continue
        seen.add(key)
        const c = evaluate(seed.m, x, y)
        if (c) pool.push(c)
      }
    }
  }
  return pool.sort(byCost)
}

const keyOf = c => `${c.m.max_width}:${c.x}:${c.y}`
const byCost = (a, b) => a.cost - b.cost || a.box[1] - b.box[1] || a.box[0] - b.box[0] || a.m.max_width - b.m.max_width

function diverse(pool, imageWidth, n = CANDIDATES) {
  const picked = []
  const minDist = imageWidth * .16
  for (const c of pool) {
    const [cx, cy] = center(c.box)
    if (picked.some(p => Math.hypot(center(p.box)[0] - cx, center(p.box)[1] - cy) < minDist)) continue
    picked.push(c)
    if (picked.length >= n) break
  }
  return picked
}

async function measureSafe(measure, layer, widths, text) {
  const fallback = () => widths.map(w => estimateBox(text, layer.font_size, w, layer.letter_spacing, layer.rotation))
  if (typeof measure !== 'function') return fallback()
  try {
    const result = await measure(layer, widths)
    if (!Array.isArray(result) || result.length !== widths.length) return fallback()
    return result.map((r, i) => r && r.width > 0 && r.height > 0
      ? { max_width: widths[i], width: Math.ceil(r.width), height: Math.ceil(r.height),
        ...(Array.isArray(r.lines) ? { lines: r.lines, soft_breaks: r.soft_breaks ?? 0 } : {}) }
      : estimateBox(text, layer.font_size, widths[i], layer.letter_spacing, layer.rotation))
  } catch {
    return fallback()
  }
}

export function keptBox(layer, text) {
  const fontSize = layer.font_size ?? 36
  const box = Number(layer.width) > 0 && Number(layer.height) > 0 ? { width: layer.width, height: layer.height }
    : estimateBox(text, fontSize, layer.max_width ?? 600, layer.letter_spacing ?? 0, layer.rotation ?? 0)
  return [layer.x ?? 0, layer.y ?? 0, (layer.x ?? 0) + box.width, (layer.y ?? 0) + box.height]
}

function snippet(text) {
  const chars = [...String(text).replace(/\s+/g, '')]
  return chars.length > 8 ? chars.slice(0, 8).join('') + '…' : chars.join('')
}

export async function planLayout({ shot, work, language = 'zh', size, scene = null, cast = null, previous = [],
  settings = null, only = null, measure = null, stickers = [] } = {}) {
  if (!size || !(size.width > 0) || !(size.height > 0)) throw new Error('排版需要图片尺寸')
  const characters = work?.characters ?? []
  const dialogues = [...(shot?.dialogues ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const existing = new Map()
  for (const layer of shot?.layouts?.[language]?.layers ?? []) if (!existing.has(layer.dialogue_id)) existing.set(layer.dialogue_id, layer)
  const onlySet = Array.isArray(only) ? new Set(only) : null
  const replan = d => {
    const layer = existing.get(d.id)
    if (layer?.locked) return false
    return !layer || !onlySet || onlySet.has(d.id)
  }
  const model = sceneModel(scene, size)
  const inflateBy = size.width * .06
  const forbidden = [...(model?.people ?? []).flatMap(p => [p.face, ...p.hands]).filter(Boolean).map(b => inflate(b, inflateBy)),
    ...(model?.people ?? []).flatMap(p => p.keys).map(b => inflate(b, size.width * .015)),
    ...(model?.keys ?? []).map(k => inflate(k.box, k.kind === 'face' ? inflateBy : size.width * .015)),
    ...(shot?.layouts?.[language]?.regions?.protected ?? []).map(r => [r.x, r.y, r.x + r.width, r.y + r.height])]

  const stickerAir = Math.round(Math.max(size.width, size.height) * .01)
  const stickerBoxes = (stickers ?? []).map(stickerBox).filter(Boolean).map(b => inflate(b, stickerAir))
  const speakers = new Set(dialogues.filter(d => d.kind === 'dialogue' || d.kind === 'thought').map(d => d.speaker_id ?? null)).size
  const ordered = d => d.kind !== 'sfx'

  const kept = dialogues.map(d => replan(d) ? null : keptBox(existing.get(d.id), lineText(d, language)))

  const runPass = async orderHard => {
  const boxes = [...kept]
  const result = new Map()
  const candidates = {}
  const warnings = []

  for (const [index, dialogue] of dialogues.entries()) {
    if (!replan(dialogue)) { result.set(dialogue.id, { ...existing.get(dialogue.id) }); continue }
    const text = lineText(dialogue, language) || ' '
    const kind = DEFAULT_STYLES[dialogue.kind] ? dialogue.kind : 'dialogue'
    const style = resolveStyle(settings, kind)

    const baseSize = Math.round(Math.max(size.width, size.height) * style.size_ratio)
    const rotation = kind === 'sfx' ? -8 - hashOf(dialogue.id) % 5 : 0
    const letter_spacing = kind === 'sfx' ? 3 : 0
    const speaker = characters.find(c => c.id === dialogue.speaker_id)
    const color = speaker ? characterColor(speaker, characters.indexOf(speaker)) : '#222222'
    if ((kind === 'dialogue' || kind === 'thought') && !speaker) {
      warnings.push({ dialogue_id: dialogue.id, code: 'speaker_unknown',
        message: `第 ${index + 1} 句「${snippet(text)}」还没有说话人，位置按画面空白处估算` })
    }
    const inOrder = ordered(dialogue)
    const earlier = inOrder ? boxes.slice(0, index).filter((b, i) => b && ordered(dialogues[i])) : []
    const later = inOrder ? boxes.slice(index + 1).filter((b, i) => b && ordered(dialogues[index + 1 + i])) : []
    const ctx = lineContext({ dialogue: { ...dialogue, kind }, model, cast, size, earlier, later, previous, speakers, text, orderHard })
    const gx = Math.max(GAP, baseSize * GAP_X), gy = Math.max(GAP, baseSize * GAP_Y)
    const obstacles = [...forbidden, ...stickerBoxes, ...boxes.filter(Boolean).map(b => [b[0] - gx, b[1] - gy, b[2] + gx, b[3] + gy])]

    let pool = []
    let measured = []
    let fontSize = baseSize
    for (const step of SIZE_STEPS) {
      fontSize = Math.max(8, Math.round(baseSize * step))
      const widths = widthOptions(text, fontSize, letter_spacing, size.width)
      const layer = { dialogue_id: dialogue.id, text, kind, font: style.font, font_size: fontSize, max_width: widths.at(-1),
        letter_spacing, rotation, mode: 'horizontal', color }
      measured = (await measureSafe(measure, layer, widths, text))
        .map(m => {
          const chars = (m.max_width - 2 * PAD) / (fontSize + letter_spacing)
          return { ...m, chars, nLines: m.lines ? m.lines.length : wrapShape(text, chars).length,
            wrap: m.lines ? shapePenalty(m.lines) + SOFT_BREAK * m.soft_breaks : wrapPenalty(text, chars) }
        })
      pool = search(measured, ctx, obstacles, true)
      if (pool.length) break
    }
    if (!pool.length) {
      pool = search(measured, ctx, obstacles, false)
      warnings.push({ dialogue_id: dialogue.id, code: 'no_space',
        message: `第 ${index + 1} 句「${snippet(text)}」放不下，已叠放在最空的位置：请缩短这句或拆成两句` })
    }
    const picks = diverse(pool, size.width)
    const best = picks[0]
    candidates[dialogue.id] = picks.map(c => ({ x: c.x, y: c.y, max_width: c.m.max_width, font_size: fontSize, rotation,
      score: Math.round(c.cost * 1000) / 1000 }))
    boxes[index] = best.box
    result.set(dialogue.id, { dialogue_id: dialogue.id, x: best.x, y: best.y, font_size: fontSize, font: style.font,
      mode: 'horizontal', rotation, letter_spacing, color, max_width: best.m.max_width, locked: false })
  }
  return { boxes, result, candidates, warnings }
  }

  let out = await runPass(false)

  const broken = out.boxes.some((b, j) => b && ordered(dialogues[j]) && replan(dialogues[j]) &&
    out.boxes.slice(0, j).some((a, i) => a && ordered(dialogues[i]) && orderCost(a, b) >= W.order))
  if (broken) {
    const strict = await runPass(true)
    const tight = r => r.warnings.filter(w => w.code === 'no_space').length
    if (tight(strict) <= tight(out)) out = strict
  }
  return { layers: dialogues.map(d => out.result.get(d.id)), candidates: out.candidates, warnings: out.warnings }
}

export function stickerBox(sticker) {
  if (!sticker || !Number.isFinite(sticker.x) || !Number.isFinite(sticker.y) || !(sticker.width > 0)) return null
  const h = sticker.width * (sticker.aspect > 0 ? sticker.aspect : 1)
  return [sticker.x - sticker.width / 2, sticker.y - h / 2, sticker.x + sticker.width / 2, sticker.y + h / 2]
}

export function keyBoxes(scene, size) {
  const model = sceneModel(scene, size)
  return [...(model?.people ?? []).flatMap(p => [p.face, ...p.keys]), ...(model?.keys ?? []).map(k => k.box)]
    .filter(Boolean).map(b => inflate(b, size.width * .03))
}

export function placeSticker({ size, width, aspect, prefer = {}, obstacles = [] }) {
  const Wd = size.width, Ht = size.height
  const px = Number.isFinite(prefer.x) ? prefer.x : Wd / 2, py = Number.isFinite(prefer.y) ? prefer.y : Ht / 2
  const stride = Math.max(4, Math.round(Math.min(Wd, Ht) * .02))
  let fallback = null
  for (const scale of [1, .85, .7, .55, .4]) {
    let w = Math.max(4, Math.round(width * scale)), h = Math.max(1, Math.round(w * aspect))
    const fit = Math.min(1, (Wd - 2 * MARGIN) / w, (Ht - 2 * MARGIN) / h)
    if (fit < 1) { w = Math.max(4, Math.floor(w * fit)); h = Math.max(1, Math.round(w * aspect)) }
    let best = null
    for (const y of axis(MARGIN, Ht - MARGIN - h, stride)) {
      for (const x of axis(MARGIN, Wd - MARGIN - w, stride)) {
        const box = [x, y, x + w, y + h]
        const over = obstacles.reduce((s, o) => s + overlap(box, o), 0) / (w * h)
        const cost = Math.hypot(x + w / 2 - px, y + h / 2 - py) / Wd + (over > 0 ? 10 + 10 * over : 0)
        if (!best || cost < best.cost) best = { cost, over, x: x + w / 2, y: y + h / 2, width: w }
      }
    }
    if (best && best.over === 0) return { x: Math.round(best.x), y: Math.round(best.y), width: best.width }
    if (best && (!fallback || best.over < fallback.over)) fallback = best
  }
  return fallback ? { x: Math.round(fallback.x), y: Math.round(fallback.y), width: fallback.width } : { x: Math.round(px), y: Math.round(py), width }
}
