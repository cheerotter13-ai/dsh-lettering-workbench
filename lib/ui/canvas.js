

import { React, h } from './react.js'
import * as store from './store.js'
import { urls } from './api.js'
import {
  fitScale, zoomStep, gesturePatch, gestureChanged, gestureTransform, toSource,
} from './geometry.js'
import { Button, cx } from './ui.js'
import { StickerBox, dropHandlers } from './stickers.js'

export function fontKey(font, kind) {
  return store.KIND_FONT[font] || font || store.KIND_FONT[kind] || 'maiyuan'
}
export function fontFamily(font, kind) {
  return `"cw-${fontKey(font, kind)}", "Microsoft YaHei", sans-serif`
}

export function imageSize(page, natural) {
  const img = page?.image
  if (img?.width && img?.height) return { width: img.width, height: img.height }
  const shot = page?.shot
  if (shot?.image_width && shot?.image_height) return { width: shot.image_width, height: shot.image_height }
  return natural || { width: 832, height: 1216 }
}

const GESTURE_LABEL = { move: '移动位置', resize: '改换行宽度', scale: '缩放字号' }

function InlineEditor({ layer, text, scale }) {
  const [value, setValue] = React.useState(text)
  const area = React.useRef(null)
  const done = React.useRef(false)
  React.useEffect(() => {
    const el = area.current
    if (!el) return
    el.focus()
    try { el.setSelectionRange(el.value.length, el.value.length) } catch {                         }
  }, [])
  const latest = React.useRef(value)
  latest.current = value
  function commit() {
    if (done.current) return
    done.current = true
    if (latest.current !== text) store.setLineText(layer.dialogue_id, latest.current)
    store.closeEditor()
  }

  const commitRef = React.useRef(commit)
  commitRef.current = commit
  React.useEffect(() => store.registerDraft(() => commitRef.current()), [])
  function onKeyDown(event) {
    event.stopPropagation()
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return
    if ((event.key === 'Enter' && (event.ctrlKey || event.metaKey)) || event.key === 'Escape') {
      event.preventDefault()
      commit()
    }
  }
  const size = layer.font_size || 36
  const lines = Math.max(1, String(value).split('\n').length)
  const vertical = layer.mode === 'vertical'
  return h('textarea', {
    ref: area, className: 'cw-editor', value, 'aria-label': '图内台词', spellCheck: false,
    onChange: e => setValue(e.target.value), onKeyDown, onBlur: commit,
    onPointerDown: e => e.stopPropagation(),
    style: {
      left: layer.x, top: layer.y,
      width: vertical ? undefined : Math.max(size * 3, layer.max_width || size * 8),
      height: vertical ? Math.max(size * 3, layer.max_width || size * 8) : undefined,
      minHeight: vertical ? undefined : Math.ceil(size * 1.22 * lines + 6),
      writingMode: vertical ? 'vertical-rl' : undefined,
      fontFamily: fontFamily(layer.font, layer.kind), fontSize: size,
      fontWeight: fontKey(layer.font, layer.kind) === 'noto_serif' ? 200 : undefined,
      letterSpacing: layer.letter_spacing ? `${layer.letter_spacing}px` : undefined,
      color: layer.color || '#222222', borderWidth: Math.max(1, 2 / scale),
    },
  })
}

function AssignOverlay({ s, scale }) {
  const [pick, setPick] = React.useState(null)
  const scene = s.scene?.scene
  const people = scene?.people || []
  const assignments = s.page?.cast?.assignments || {}
  const characters = s.work?.characters || []
  const owner = index => characters.filter(c => assignments[c.id] === index).map(c => c.name || c.id)
  const counter = { transform: `scale(${1 / scale})` }
  function choose(characterId) {
    const next = store.castWith(assignments, characterId, pick)
    setPick(null)
    store.assignCast(next)
  }
  return h(React.Fragment, null,
    people.map((person, index) => {
      const [x0, y0, x1, y1] = person.box
      const names = owner(index)
      return h('div', {
        key: index, className: cx('cw-person', names.length && 'cw-assigned'),
        style: { left: x0, top: y0, width: x1 - x0, height: y1 - y0, borderWidth: 2 / scale },
        onPointerDown: e => { e.stopPropagation(); setPick(index) },
        role: 'button', 'aria-label': `人物 ${index + 1}`,
      }, h('div', { className: 'cw-person-tag', style: counter },
        `人物 ${index + 1}${names.length ? ` · ${names.join('、')}` : ' · 点一下指认'}`))
    }),
    pick != null && people[pick] ? h('div', {
      className: 'cw-picker', role: 'menu', 'aria-label': '这是谁',
      style: { left: people[pick].box[0], top: people[pick].box[1] + 28 / scale, ...counter },
      onPointerDown: e => e.stopPropagation(),
    },
    h('div', { className: 'cw-menu-label' }, `人物 ${pick + 1} 是谁？`),
    characters.length
      ? characters.map(c => h('button', { key: c.id, type: 'button', onClick: () => choose(c.id) },
        h('span', { className: 'cw-swatch', style: { background: c.color || '#888', display: 'inline-block', marginRight: 6 } }), c.name || c.id))
      : h('div', { className: 'cw-faint cw-small', style: { padding: 6 } }, '还没有角色，先在 ⚙ 作品设置里加'),
    h('button', { type: 'button', onClick: () => setPick(null) }, '取消')) : null)
}

function MarkOverlay({ s, size, stageRef }) {
  const [box, setBox] = React.useState(null)
  const anchor = React.useRef(null)
  const regions = s.page?.shot?.layouts?.[s.language]?.regions?.protected || []
  const point = e => toSource(stageRef.current.getBoundingClientRect(), size, e.clientX, e.clientY)
  const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })
  return h(React.Fragment, null,
    regions.map((r, i) => h('div', { key: i, className: 'cw-region', style: { left: r.x, top: r.y, width: r.width, height: r.height } })),
    box ? h('div', { className: 'cw-region', style: { left: box.x, top: box.y, width: box.width, height: box.height } }) : null,
    h('div', {
      className: 'cw-mark-layer', 'aria-label': '在图上框选保护区域',
      onPointerDown: e => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); anchor.current = point(e) },
      onPointerMove: e => { if (anchor.current) setBox(rect(anchor.current, point(e))) },
      onPointerUp: e => {
        if (!anchor.current) return
        const done = rect(anchor.current, point(e))
        anchor.current = null
        setBox(null)
        if (done.width >= 5 && done.height >= 5) store.addRegion(done)
      },
    }))
}

export function CanvasView({ s }) {
  const page = s.page, shot = page?.shot
  const wrapRef = React.useRef(null)
  const stageRef = React.useRef(null)
  const gesture = React.useRef(null)
  const frame = React.useRef(0)
  const scaleRef = React.useRef(1)
  const [avail, setAvail] = React.useState({ width: 0, height: 0 })
  const [natural, setNatural] = React.useState(null)

  React.useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const measure = () => setAvail({ width: el.clientWidth, height: el.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    const onWheel = event => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      store.setState({ zoom: zoomStep(scaleRef.current, event.deltaY) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { observer.disconnect(); el.removeEventListener('wheel', onWheel) }
  }, [])

  React.useEffect(() => { setNatural(null) }, [shot?.id])
  React.useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  const size = imageSize(page, natural)
  const fit = fitScale(avail, size)
  const scale = s.zoom ?? fit
  scaleRef.current = scale

  const readOnly = store.isReadOnly(s)
  const dialogues = store.sortedDialogues(shot)
  const order = new Map(dialogues.map((d, i) => [d.id, i + 1]))
  const sprites = new Map((page?.sprites || []).map(sp => [sp.dialogue_id, sp]))
  const pendingIds = new Set(s.ops.filter(o => o.shotId === s.shotId && o.status !== 'error').map(o => o.dialogueId))
  const failedIds = new Set(s.ops.filter(o => o.shotId === s.shotId && o.status === 'error').map(o => o.dialogueId))

  function stageRect() { return stageRef.current.getBoundingClientRect() }

  function begin(event, layer, mode) {
    if (event.button !== 0) return
    event.stopPropagation()
    store.selectLine(layer.dialogue_id)
    if (s.editingId || readOnly || s.assignMode || s.markMode) return
    if (event.detail > 1) return
    const el = event.currentTarget.closest('[data-cw-layer]')
    if (!el) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    gesture.current = {
      mode, el, dialogue_id: layer.dialogue_id, x: layer.x, y: layer.y,
      width: el.offsetWidth, height: el.offsetHeight,
      max_width: layer.max_width || el.offsetWidth, font_size: layer.font_size || 36,
      clientX: event.clientX, clientY: event.clientY, patch: null,
    }
  }

  function paint() {
    frame.current = 0
    const g = gesture.current
    if (!g?.patch) return
    if (g.mode === 'resize') g.el.style.width = `${g.patch.max_width}px`
    else g.el.style.transform = gestureTransform(g, g.patch)
  }

  function move(event) {
    const g = gesture.current
    if (!g) return
    g.patch = gesturePatch(g, event, stageRect(), size)
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }

  function reset(g) {
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0 }
    g.el.style.transform = ''
    g.el.style.width = ''
  }

  function end(event) {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const patch = gesturePatch(g, event, stageRect(), size)
    if (!gestureChanged(g, patch)) { reset(g); return }

    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0 }
    store.patchLayer(g.dialogue_id, patch, { label: GESTURE_LABEL[g.mode] })
  }

  function cancel() {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    reset(g)
  }

  function layerBox(base) {
    const id = base.dialogue_id
    const override = s.overrides[id]
    const layer = override ? { ...base, ...override } : base
    if (s.editingId === id) {
      const dialogue = dialogues.find(d => d.id === id)
      return h(InlineEditor, { key: `edit:${id}`, layer, text: store.textOf(dialogue, s.language), scale })
    }
    const sprite = sprites.get(id)
    const ratio = override?.font_size && base.font_size ? override.font_size / base.font_size : 1
    const hasSprite = sprite?.url || sprite?.sig
    const selected = s.selectedId === id
    const font = layer.font_size || 36
    const width = hasSprite && sprite.width ? sprite.width * ratio : layer.max_width || font * 6
    const height = hasSprite && sprite.height ? sprite.height * ratio : undefined
    const handle = 10 / scale
    const geometry = [layer.x, layer.y, layer.max_width, layer.font_size].join(':')
    const number = order.get(id) || ''
    const failed = failedIds.has(id) || sprite?.error
    return h('div', {
      key: `${id}:${geometry}`, 'data-cw-layer': id,
      className: cx('cw-layer', selected && 'cw-sel', layer.transient && 'cw-transient',
        pendingIds.has(id) && 'cw-pending', failed && 'cw-failed'),
      style: { left: layer.x, top: layer.y, width, height, outlineWidth: selected ? 2 / scale : undefined },
      title: sprite?.error
        ? `第${number}句：${sprite.error === 'missing_glyph' ? '字体缺字' : sprite.error}`
        : `第${number}句 · 拖动移动 · 双击编辑`,
      'aria-label': `第${number}句台词`,
      onPointerDown: e => begin(e, layer, 'move'),
      onPointerMove: move, onPointerUp: end, onPointerCancel: cancel,
      onDoubleClick: e => { e.stopPropagation(); cancel(); store.openEditor(id) },
    },
    hasSprite
      ? h('img', {
        src: sprite.url || urls.sprite(sprite.sig), alt: '', draggable: false,
        style: { width: sprite.width, height: sprite.height, transform: ratio !== 1 ? `scale(${ratio})` : undefined },
      })
      : h('div', {
        className: 'cw-layer-fallback',
        style: {
          width: layer.max_width || font * 6, fontSize: font, lineHeight: 1.22, color: layer.color || '#222222',
          fontFamily: fontFamily(layer.font, layer.kind), writingMode: layer.mode === 'vertical' ? 'vertical-rl' : undefined,
        },
      }, layer.text || ''),
    selected && !readOnly ? h('div', {
      className: 'cw-handle cw-resize', 'aria-label': `调整第${number}句换行宽度`, title: '拖动改换行宽度',
      style: { left: (layer.max_width || width) - handle / 2, top: `calc(50% - ${handle}px)`, width: handle, height: handle * 2 },
      onPointerDown: e => begin(e, layer, 'resize'), onPointerMove: move, onPointerUp: end, onPointerCancel: cancel,
    }) : null,
    selected && !readOnly ? h('div', {
      className: 'cw-handle cw-scale', 'aria-label': `缩放第${number}句字号`, title: '拖动等比缩放',
      style: { right: -handle / 2, bottom: -handle / 2, width: handle * 1.2, height: handle * 1.2 },
      onPointerDown: e => begin(e, layer, 'scale'), onPointerMove: move, onPointerUp: end, onPointerCancel: cancel,
    }) : null)
  }

  const layers = page?.display?.layers || []
  const stickers = store.pageStickers(s)
  const stickerBox = st => h(StickerBox, {
    key: `${st.id}:${[st.x, st.y, st.width, st.rotation, st.opacity, st.flip, st.z].join(':')}`,
    sticker: st, selected: s.stickerId === st.id, readOnly, scale, size, stageRef,
  })
  const warnings = [
    ...(page?.display?.warnings || []).map(w => ({ id: w.dialogue_id, text: w.message || w.code })),
    ...(page?.sprites || []).filter(sp => sp.error || sp.missing?.length)
      .map(sp => ({ id: sp.dialogue_id, text: sp.error === 'missing_glyph' || sp.missing?.length ? '字体缺字' : sp.error })),
  ]
  const imageUrl = page?.image?.url || (shot ? urls.asset(shot.id, shot.version) : '')
  const list = store.visiblePages(s)
  const position = list.findIndex(p => p.id === s.shotId)

  const warningTitle = warnings.map(w => `第${order.get(w.id) || '?'}句：${w.text}`).join('\n')
  const info = h('div', { className: 'cw-canvas-info' },
    h('span', { className: 'cw-counter' }, shot ? `${shot.label || ''}` : ''),
    shot ? h('span', { className: 'cw-faint cw-small cw-hide-narrow' }, `第 ${position + 1} 页 · v${shot.version}`) : null,
    page?.protected_reason
      ? h('span', { className: 'cw-badge cw-warn', title: '修改后需重新定稿，旧导出不会被覆盖' }, `受保护 · ${page.protected_reason}`)
      : null,
    warnings.length ? h('span', { className: 'cw-badge cw-warn', title: warningTitle }, `⚠ ${warnings.length} 条提示`) : null)

  const tool = (label, title, onClick, extra = {}) =>
    h(Button, { kind: 'ghost', small: true, title, onClick, ...extra }, label)
  const tools = h('div', { className: 'cw-canvas-tools' },
    tool('指认', '点人指认（C）', () => store.toggleAssign(), { kind: s.assignMode ? 'on' : 'ghost', disabled: !shot }),
    tool('换位置', '换个位置（P）', () => store.cyclePosition(s.selectedId), { disabled: !s.selectedId || readOnly }),
    tool('重排', '本页未锁定的句子重排（R）', () => store.relayout(), { disabled: !shot || readOnly }),
    tool('原图', '按住看原图（按住 \\）', undefined, {
      kind: s.showOriginal ? 'on' : 'ghost',
      onPointerDown: () => store.setState({ showOriginal: true }),
      onPointerUp: () => store.setState({ showOriginal: false }),
      onPointerLeave: () => s.showOriginal && store.setState({ showOriginal: false }),
    }),
    h('span', { className: 'cw-sep' }),
    tool('−', '缩小（Ctrl+滚轮）', () => store.setState({ zoom: zoomStep(scale, 1) }), { label: '缩小' }),
    tool(`${Math.round(scale * 100)}%`, '适合窗口', () => store.setState({ zoom: null }), { kind: s.zoom == null ? 'on' : 'ghost' }),
    tool('+', '放大（Ctrl+滚轮）', () => store.setState({ zoom: zoomStep(scale, -1) }), { label: '放大' }))

  const bar = h('div', { className: 'cw-canvas-bar' }, info, tools)

  let message = null
  if (s.assignMode) {
    const status = s.scene?.status
    message = status === 'loading' ? '正在识别画面里的人…'
      : s.scene?.error ? `识别失败：${s.scene.error}`
        : s.scene?.scene && s.scene.scene.available === false ? '本机识别模型不可用；可在 ⚙ 里给角色设好性别后让它猜'
          : s.scene?.scene && !s.scene.scene.people?.length ? '画面里没找到人'
            : '指认模式：点画面里的人，选是谁。Esc 退出'
  } else if (s.markMode) message = '框选保护区域（文字会避开）。Esc 退出'
  else if (s.pageError) message = `载入失败：${s.pageError}`

  return h('section', { className: 'cw-center', 'aria-label': '画布' },
    bar,
    h('div', {
      ref: wrapRef, className: 'cw-stage-wrap',
      onPointerDown: () => { if (!s.editingId && !s.assignMode && !s.markMode) store.selectLine('') },
      ...(readOnly ? {} : dropHandlers(stageRef, size)),
    },
    message ? h('div', { className: 'cw-canvas-msg', role: 'status' }, message) : null,
    s.showOriginal ? h('span', { className: 'cw-badge cw-original-tag' }, '原图') : null,
    !shot && !s.pageError ? h('div', { className: 'cw-empty', style: { margin: 'auto' } }, s.pageLoading ? '载入中…' : '选一页开始') : null,
    shot ? h('div', { className: 'cw-stage-box', style: { width: size.width * scale, height: size.height * scale } },
      h('div', {
        ref: stageRef, className: 'cw-stage', 'aria-label': '主审校画布', 'data-workbench-canvas': true,
        style: { width: size.width, height: size.height, transform: `scale(${scale})` },
      },
      imageUrl ? h('img', {
        className: 'cw-base', src: imageUrl, alt: '原图', draggable: false,
        onLoad: e => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }),
      }) : null,
      s.showOriginal ? null : stickers.filter(st => st.z !== 'above').map(stickerBox),
      s.showOriginal ? null : layers.map(layerBox),
      s.showOriginal ? null : stickers.filter(st => st.z === 'above').map(stickerBox),
      s.assignMode ? h(AssignOverlay, { s, scale }) : null,
      s.markMode ? h(MarkOverlay, { s, size, stageRef }) : null)) : null))
}
