

import { React, h } from './react.js'
import * as store from './store.js'
import { urls } from './api.js'
import { Button, Field, Select, cx } from './ui.js'

const DRAG_TYPE = 'application/x-cw-asset'
const SOURCE_LABEL = { folder: '按文件夹', preset: '已整理', ai: '智能分类', user: '手改' }

function round(value) { return Math.round(value * 10) / 10 }

function sourcePoint(stage, size, event) {
  const rect = stage.getBoundingClientRect()
  return { x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height }
}

function boxStyle(st) {
  const height = st.width * st.aspect
  return { left: st.x - st.width / 2, top: st.y - height / 2, width: st.width, height,
    transform: st.rotation ? `rotate(${st.rotation}deg)` : undefined, opacity: st.opacity }
}

export function StickerBox({ sticker, selected, readOnly, scale, size, stageRef }) {
  const ref = React.useRef(null)
  const gesture = React.useRef(null)
  const frame = React.useRef(0)

  function begin(event, mode) {
    if (event.button !== 0) return
    event.stopPropagation()
    store.selectSticker(sticker.id)
    if (readOnly || (sticker.locked && mode === 'move')) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const p = sourcePoint(stageRef.current, size, event)
    gesture.current = { mode, start: p, base: sticker, patch: null,
      angle: Math.atan2(p.y - sticker.y, p.x - sticker.x), dist: Math.max(1, Math.hypot(p.x - sticker.x, p.y - sticker.y)) }
  }
  function patchFor(event) {
    const g = gesture.current
    const p = sourcePoint(stageRef.current, size, event)
    const b = g.base
    if (g.mode === 'move') return { x: Math.round(b.x + p.x - g.start.x), y: Math.round(b.y + p.y - g.start.y) }
    if (g.mode === 'scale') {
      const ratio = Math.hypot(p.x - b.x, p.y - b.y) / g.dist
      return { width: Math.max(8, Math.min(16384, Math.round(b.width * ratio))) }
    }
    let rotation = b.rotation + (Math.atan2(p.y - b.y, p.x - b.x) - g.angle) * 180 / Math.PI
    rotation = ((rotation + 180) % 360 + 360) % 360 - 180
    rotation = event.shiftKey ? Math.round(rotation / 15) * 15 : Math.round(rotation)
    return { rotation }
  }
  function apply(st) {
    if (!ref.current) return
    Object.assign(ref.current.style, Object.fromEntries(Object.entries(boxStyle(st))
      .map(([key, value]) => [key, typeof value === 'number' && key !== 'opacity' ? `${value}px` : value ?? ''])))
  }
  function paint() {
    frame.current = 0
    const g = gesture.current
    if (g?.patch) apply({ ...g.base, ...g.patch })
  }
  function move(event) {
    if (!gesture.current) return
    gesture.current.patch = patchFor(event)
    if (!frame.current) frame.current = requestAnimationFrame(paint)
  }
  function end(event) {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0 }
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    gesture.current = g
    const patch = patchFor(event)
    gesture.current = null
    const changed = Object.keys(patch).some(key => patch[key] !== g.base[key])
    if (!changed) apply(g.base)
    else store.patchSticker(sticker.id, patch, { label: { move: '移动贴图', scale: '缩放贴图', rotate: '旋转贴图' }[g.mode] })
  }
  React.useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  const handle = 10 / scale
  return h('div', {
    ref, 'data-cw-sticker': sticker.id,
    className: cx('cw-sticker', selected && 'cw-sel', sticker.locked && 'cw-locked'),
    style: { ...boxStyle(sticker), outlineWidth: selected ? 2 / scale : undefined },
    title: sticker.locked ? '贴图（已锁定位置）' : '贴图 · 拖动移动',
    'aria-label': '贴图',
    onPointerDown: e => begin(e, 'move'), onPointerMove: move, onPointerUp: end,
    onPointerCancel: () => { gesture.current = null },
  },
  h('img', { src: urls.sticker(sticker.asset_id), alt: '', draggable: false,
    style: { transform: sticker.flip ? 'scaleX(-1)' : undefined } }),
  selected && !readOnly ? h('div', {
    className: 'cw-handle cw-scale', 'aria-label': '缩放贴图', title: '拖动缩放',
    style: { right: -handle / 2, bottom: -handle / 2, width: handle * 1.2, height: handle * 1.2 },
    onPointerDown: e => begin(e, 'scale'), onPointerMove: move, onPointerUp: end,
  }) : null,
  selected && !readOnly ? h('div', {
    className: 'cw-handle cw-rotate', 'aria-label': '旋转贴图', title: '拖动旋转（按住 Shift 每次 15°）',
    style: { left: `calc(50% - ${handle * 0.6}px)`, top: -handle * 3, width: handle * 1.2, height: handle * 1.2 },
    onPointerDown: e => begin(e, 'rotate'), onPointerMove: move, onPointerUp: end,
  }) : null)
}

export function dropHandlers(stageRef, size) {
  return {
    onDragOver: event => {
      if ([...(event.dataTransfer?.types || [])].includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
    },
    onDrop: event => {
      const id = event.dataTransfer?.getData(DRAG_TYPE)
      if (!id || !stageRef.current) return
      event.preventDefault()
      const p = sourcePoint(stageRef.current, size, event)
      store.addSticker(id, { x: Math.round(p.x), y: Math.round(p.y) })
    },
  }
}

function SelectedSticker({ s, sticker, readOnly }) {
  const set = (patch, label) => store.patchSticker(sticker.id, patch, { label })
  const order = (s.page?.shot?.stickers || []).map(st => st.id)
  const at = order.indexOf(sticker.id)
  const number = (key, label, opts) => h(Field, { label },
    h('input', {
      className: 'cw-input', type: 'number', key: `${key}:${sticker[key]}`, defaultValue: round(sticker[key]), step: opts.step,
      min: opts.min, max: opts.max, 'aria-label': label, disabled: readOnly,
      onBlur: e => {
        const value = Number(e.target.value)
        if (String(e.target.value).trim() === '' || !Number.isFinite(value)) return
        const clamped = Math.max(opts.min, Math.min(opts.max, opts.int ? Math.round(value) : value))
        if (clamped !== sticker[key]) set({ [key]: clamped }, opts.label)
      },
      onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur() },
    }))
  return h('section', { className: 'cw-card', 'aria-label': '选中的贴图' },
    h('div', { className: 'cw-row' },
      h('img', { className: 'cw-sticker-mini', src: urls.sticker(sticker.asset_id, 'thumb'), alt: '' }),
      h('span', { className: 'cw-section-title cw-grow' }, '选中的贴图'),
      h(Button, { small: true, kind: 'ghost', onClick: () => store.selectSticker('') }, '取消选中')),
    h('div', { className: 'cw-style-grid' },
      number('width', '宽度', { min: 8, max: 16384, step: 1, int: true, label: '缩放贴图' }),
      number('rotation', '旋转', { min: -360, max: 360, step: 1, label: '旋转贴图' }),
      h(Field, { label: `透明度 ${Math.round(sticker.opacity * 100)}%` },
        h('input', {
          type: 'range', min: 10, max: 100, step: 5, key: `op:${sticker.opacity}`, defaultValue: Math.round(sticker.opacity * 100),
          'aria-label': '透明度', disabled: readOnly,
          onPointerUp: e => set({ opacity: Number(e.currentTarget.value) / 100 }, '改透明度'),
          onKeyUp: e => set({ opacity: Number(e.currentTarget.value) / 100 }, '改透明度'),
        })),
      h(Field, { label: '和文字的关系' }, h(Select, {
        label: '层次', value: sticker.z, disabled: readOnly,
        onChange: v => set({ z: v }, '换贴图层次'),
        options: [['below', '在文字下面（气泡）'], ['above', '盖在文字上面']],
      }))),
    h('div', { className: 'cw-row cw-wrap' },
      h(Button, { small: true, disabled: readOnly, onClick: () => set({ flip: !sticker.flip }, '翻转贴图') }, '左右翻转'),
      h(Button, { small: true, disabled: readOnly || at === order.length - 1, onClick: () => store.orderSticker(sticker.id, 'front') }, '移到最前'),
      h(Button, { small: true, disabled: readOnly || at === 0, onClick: () => store.orderSticker(sticker.id, 'back') }, '移到最后'),
      h('label', { className: 'cw-check' },
        h('input', { type: 'checkbox', checked: !!sticker.locked, disabled: readOnly, onChange: e => set({ locked: e.target.checked }, '锁定贴图') }),
        '锁定位置'),
      h('span', { className: 'cw-grow' }),
      h(Button, { small: true, kind: 'ghost', className: 'cw-danger', disabled: readOnly, title: '删除贴图（Del）',
        onClick: () => store.deleteSticker(sticker.id) }, '删除')))
}

function PageStickers({ s, readOnly }) {
  const list = s.page?.shot?.stickers || []
  if (!list.length) return null
  return h('section', { className: 'cw-card', 'aria-label': '本页贴图' },
    h('span', { className: 'cw-section-title' }, `本页贴图 · ${list.length} 张`),
    h('div', { className: 'cw-page-stickers' }, list.map((st, i) => h('div', {
      key: st.id, className: cx('cw-asset', s.stickerId === st.id && 'cw-on'),
    },
    h('button', { type: 'button', className: 'cw-asset-pick', title: '选中这张贴图', 'aria-label': `选中第 ${i + 1} 张贴图`,
      onClick: () => store.selectSticker(st.id) },
    h('img', { src: urls.sticker(st.asset_id, 'thumb'), alt: '', draggable: false })),
    h('button', { type: 'button', className: 'cw-asset-more cw-asset-del', disabled: readOnly, title: '删除这张贴图（可 Ctrl+Z 撤销）',
      'aria-label': `删除第 ${i + 1} 张贴图`, onClick: () => store.deleteSticker(st.id) }, '×')))),
    h('div', { className: 'cw-small cw-faint' }, '画面上被文字盖住、点不到的贴图，在这里选中或删除。'))
}

function AssetEditor({ item, categories, onClose }) {
  const [text, setText] = React.useState(item.text || '')
  const [mood, setMood] = React.useState(item.mood || '')
  const save = patch => store.updateAsset(item.id, patch)
  return h('div', { className: 'cw-card cw-asset-edit', 'aria-label': '素材信息' },
    h('div', { className: 'cw-row' },
      h('img', { className: 'cw-sticker-mini', src: urls.sticker(item.id, 'thumb'), alt: '' }),
      h('div', { className: 'cw-grow cw-small cw-faint', title: item.rel }, item.rel, item.copies > 1 ? `（${item.copies} 份相同）` : ''),
      h(Button, { small: true, kind: 'ghost', onClick: onClose }, '收起')),
    h('div', { className: 'cw-style-grid' },
      h(Field, { label: `类别 · ${SOURCE_LABEL[item.category_source] || ''}` }, h(Select, {
        label: '类别', value: item.category, onChange: v => save({ category: v }), options: categories.map(c => [c, c]),
      })),
      h(Field, { label: '上面的字' }, h('input', {
        className: 'cw-input', value: text, maxLength: 40, 'aria-label': '贴纸上的字',
        onChange: e => setText(e.target.value), onBlur: () => text !== item.text && save({ text }),
      })),
      h(Field, { label: '语气' }, h('input', {
        className: 'cw-input', value: mood, maxLength: 20, 'aria-label': '语气',
        onChange: e => setMood(e.target.value), onBlur: () => mood !== item.mood && save({ mood }),
      }))),
    h('div', { className: 'cw-row cw-wrap' },
      item.can_clean ? h('label', { className: 'cw-check', title: '海量素材是从大图切出来的，默认用自动清理过边框和杂点的版本' },
        h('input', { type: 'checkbox', checked: !item.use_original, onChange: e => save({ use_original: !e.target.checked }) }),
        '用清理过的版本') : null,
      h('span', { className: 'cw-grow' }),
      h(Button, { small: true, kind: 'ghost', onClick: () => save({ hidden: !item.hidden }) }, item.hidden ? '取消隐藏' : '隐藏（抠得不好）')))
}

export function AssetsTab({ s }) {
  const [editing, setEditing] = React.useState('')
  const [q, setQ] = React.useState(s.assetFilter.q || '')
  const view = s.assets
  const filter = s.assetFilter
  const readOnly = store.isReadOnly(s)
  React.useEffect(() => { if (!view && !s.assetsLoading) store.loadAssets() }, [])
  const preparing = view?.summary?.status?.preparing
  React.useEffect(() => {
    if (!preparing) return undefined
    const timer = setInterval(() => store.loadAssets(), 3000)
    return () => clearInterval(timer)
  }, [preparing])
  React.useEffect(() => {
    const timer = setTimeout(() => { if (q !== filter.q) store.loadAssets({ q }) }, 300)
    return () => clearTimeout(timer)
  }, [q])

  const selected = store.pageStickers(s).find(st => st.id === s.stickerId)
  const head = h(React.Fragment, null, selected ? h(SelectedSticker, { s, sticker: selected, readOnly }) : null, h(PageStickers, { s, readOnly }))
  if (!view) {
    return h(React.Fragment, null, head,
      h('div', { className: 'cw-empty' }, s.assetsError ? `素材库读不出来：${s.assetsError}` : '正在读素材库…（第一次会扫描文件夹）'))
  }
  if (!view.available) {
    return h(React.Fragment, null, head,
      h('div', { className: 'cw-empty' }, '素材库尚未就绪。'))
  }
  const summary = view.summary
  const counts = summary.counts || {}
  const chips = [['', `全部 ${summary.total - summary.hidden}`], ...view.categories.map(c => [c, `${c} ${counts[c] ?? 0}`])]
  const item = view.items.find(i => i.id === editing)
  return h(React.Fragment, null,
    head,
    h('div', { className: 'cw-row cw-wrap cw-asset-filters' },
      chips.map(([key, label]) => h('button', {
        key: key || 'all', type: 'button', className: cx('cw-chip', filter.category === key && 'cw-on'),
        onClick: () => store.loadAssets({ category: key }),
      }, label))),
    h('div', { className: 'cw-row' },
      h('input', { className: 'cw-input cw-grow', placeholder: '搜上面的字、语气或文件名', value: q, 'aria-label': '搜索素材',
        onChange: e => setQ(e.target.value) }),
      h('label', { className: 'cw-check cw-small' },
        h('input', { type: 'checkbox', checked: !!filter.hidden, onChange: e => store.loadAssets({ hidden: e.target.checked }) }), '含已隐藏')),
    h('div', { className: 'cw-small cw-faint' },
      readOnly ? '只读浏览中，不能往页面上加贴图。' : '点一下放到画面中间，或拖到画面上。气泡默认在文字下面。',
      preparing ? ` 正在生成缩略图 ${summary.status.prepared}/${summary.status.pending}…` : ''),
    item ? h(AssetEditor, { key: item.id, item, categories: view.categories, onClose: () => setEditing('') }) : null,
    h('div', { className: 'cw-asset-grid', role: 'list', 'aria-label': '素材' },
      view.items.length ? view.items.map(asset => h('div', {
        key: asset.id, role: 'listitem', className: cx('cw-asset', asset.hidden && 'cw-hidden-asset', editing === asset.id && 'cw-on'),
        title: [asset.text, asset.mood, asset.category].filter(Boolean).join(' · ') || asset.rel,
      },
      h('button', {
        type: 'button', className: 'cw-asset-pick', draggable: !readOnly, disabled: readOnly || !s.page?.shot,
        'aria-label': `放上 ${asset.text || asset.category}`,
        onClick: () => store.addSticker(asset.id),
        onDragStart: e => { try { e.dataTransfer.setData(DRAG_TYPE, asset.id); e.dataTransfer.effectAllowed = 'copy' } catch {              } },
      }, h('img', { src: urls.sticker(asset.id, 'thumb'), alt: '', loading: 'lazy', draggable: false })),
      asset.text ? h('span', { className: 'cw-asset-text' }, asset.text) : null,
      h('button', { type: 'button', className: 'cw-asset-more', 'aria-label': '素材信息', title: '改类别、文字、隐藏',
        onClick: () => setEditing(editing === asset.id ? '' : asset.id) }, '⋯')))
        : h('div', { className: 'cw-empty' }, s.assetsLoading ? '载入中…' : '没有符合的素材')),
    h('div', { className: 'cw-row cw-small cw-faint' },
      h('span', { className: 'cw-grow', title: summary.root }, `素材文件夹（只读）：${summary.root}`),
      h(Button, { small: true, kind: 'ghost', onClick: () => store.scanAssets() }, '导入 PNG 贴纸')))
}
