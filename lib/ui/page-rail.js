

import { React, h } from './react.js'
import { urls } from './api.js'
import * as store from './store.js'
import { Button, cx, pageMark } from './ui.js'

export const GROUP_H = 26
export const PAGE_H = 54
export const FILTERS = [['all', '全部'], ['todo', '未定稿'], ['draft', '有字未定稿'], ['empty', '无字']]

export function groupKey(label) {
  const text = String(label || '').trim().replace(/\.(png|jpe?g|webp)$/i, '')
  const base = text.replace(/[\s_\-#.]*\d+$/, '')
  return base && base !== text ? base : ''
}

export function filterPages(pages, filter = 'all') {
  const visible = pages.filter(p => !p.hidden)
  switch (filter) {
    case 'todo': return visible.filter(p => p.status !== 'final' || p.complete === false || p.finalize_error)
    case 'draft': return visible.filter(p => p.lines > 0 && p.status !== 'final')
    case 'empty': return visible.filter(p => !p.lines)
    default: return visible
  }
}

export function groupPages(pages, block = 50) {
  const groups = []
  for (const page of pages) {
    const key = groupKey(page.label)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.pages.push(page)
    else groups.push({ key, pages: [page] })
  }
  const useful = groups.length > 0 && groups.every(g => g.key) && pages.length / groups.length >= 3
  if (useful) return groups.map(g => ({ ...g, title: g.key }))
  const blocks = []
  for (let i = 0; i < pages.length; i += block) {
    const slice = pages.slice(i, i + block)
    const first = slice[0].index ?? i, last = slice[slice.length - 1].index ?? i + slice.length - 1
    blocks.push({ key: `#${i}`, title: `${first + 1}–${last + 1}`, pages: slice })
  }
  return blocks
}

export function buildRows(pages, { filter = 'all', collapsed = {} } = {}) {
  const rows = []
  let top = 0
  for (const group of groupPages(filterPages(pages, filter))) {
    const done = group.pages.filter(p => p.status === 'final').length
    const closed = !!collapsed[group.key]
    rows.push({ type: 'group', key: `g:${group.key}:${rows.length}`, group: group.key, title: group.title, count: group.pages.length, done, closed, top, height: GROUP_H })
    top += GROUP_H
    if (closed) continue
    for (const page of group.pages) {
      rows.push({ type: 'page', key: page.id, page, top, height: PAGE_H })
      top += PAGE_H
    }
  }
  return { rows, total: top }
}

function firstBelow(rows, y) {
  let lo = 0, hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].top + rows[mid].height <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function virtualWindow(rows, scrollTop, viewport, overscan = 300) {
  if (!rows.length) return { start: 0, end: 0 }
  const start = firstBelow(rows, Math.max(0, scrollTop - overscan))
  const end = Math.min(rows.length, firstBelow(rows, scrollTop + viewport + overscan) + 1)
  return { start, end }
}

export function scrollToRow(row, scrollTop, viewport) {
  if (!row) return null
  if (row.top < scrollTop) return Math.max(0, row.top - GROUP_H)
  if (row.top + row.height > scrollTop + viewport) return row.top + row.height - viewport + 8
  return null
}

export function PageRail({ s }) {
  const scroller = React.useRef(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewport, setViewport] = React.useState(600)
  const [collapsed, setCollapsed] = React.useState({})
  const { rows, total } = React.useMemo(
    () => buildRows(s.pages, { filter: s.filter, collapsed }),
    [s.pages, s.filter, collapsed])
  const range = new Set()

  const dragId = React.useRef('')
  const [drop, setDrop] = React.useState(null)
  const canDrag = !store.isReadOnly(s)

  React.useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => setViewport(el.clientHeight || 600))
    observer.observe(el)
    setViewport(el.clientHeight || 600)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const el = scroller.current
    if (!el) return
    const row = rows.find(r => r.type === 'page' && r.page.id === s.shotId)
    const target = scrollToRow(row, el.scrollTop, el.clientHeight || viewport)
    if (target != null) el.scrollTop = target
  }, [s.shotId, rows.length])

  const { start, end } = virtualWindow(rows, scrollTop, viewport)
  const list = store.visiblePages(s)
  const indexOf = new Map(list.map((p, i) => [p.id, i]))

  function onClickPage(event, page) {
    if (event.shiftKey) {
      event.preventDefault()
      store.shiftSelect(page.id)
      return
    }
    store.openPage(page.id)
  }
  function dropSide(event, page) {
    const box = event.currentTarget.getBoundingClientRect()
    return { id: page.id, after: event.clientY > box.top + box.height / 2 }
  }
  function onDrop(event, page) {
    event.preventDefault()
    const id = dragId.current, side = dropSide(event, page)
    dragId.current = ''
    setDrop(null)
    if (!id || id === page.id) return
    const at = list.findIndex(p => p.id === page.id)
    store.movePage(id, side.after ? page.id : (list[at - 1]?.id ?? null))
  }

  const body = rows.slice(start, end).map(row => {
    if (row.type === 'group') {
      return h('div', {
        key: row.key, className: 'cw-rail-group', style: { top: row.top, height: row.height },
        onClick: () => setCollapsed(c => ({ ...c, [row.group]: !c[row.group] })),
        role: 'button', 'aria-expanded': !row.closed,
      }, h('span', null, row.closed ? '▸' : '▾'), h('span', { className: 'cw-grow' }, row.title || '未分组'),
      h('span', { className: 'cw-faint' }, `${row.done}/${row.count}`))
    }
    const page = row.page, mark = pageMark(page)
    const n = (indexOf.get(page.id) ?? 0) + 1
    return h('div', {
      key: row.key, role: 'option', 'aria-selected': page.id === s.shotId, title: page.label,
      className: cx('cw-rail-page', page.id === s.shotId && 'cw-current', range.has(page.id) && 'cw-inrange',
        drop?.id === page.id && (drop.after ? 'cw-drop-after' : 'cw-drop-before')),
      style: { top: row.top, height: row.height },
      onClick: event => onClickPage(event, page),
      draggable: canDrag,
      onDragStart: event => { dragId.current = page.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', page.id) },
      onDragOver: event => {
        if (!dragId.current) return
        event.preventDefault()
        const side = dropSide(event, page)
        if (drop?.id !== side.id || drop?.after !== side.after) setDrop(side)
      },
      onDrop: event => onDrop(event, page),
      onDragEnd: () => { dragId.current = ''; setDrop(null) },
    },
    h('div', { className: 'cw-thumb' }, page.has_image === false
      ? '无图'
      : h('img', { src: urls.thumb(page.id, page.version), alt: '', loading: 'lazy', decoding: 'async', draggable: false })),
    h('div', { className: 'cw-rail-text' },
      h('div', { className: 'cw-rail-label' }, h('b', null, n), h('span', { className: 'cw-muted' }, page.label || '')),
      h('div', { className: 'cw-rail-preview' }, page.text_preview || (page.lines ? '' : '无字'))),
    h('span', { className: cx('cw-st', `cw-st-${mark.cls}`), title: mark.title, 'aria-label': mark.title }, mark.mark))
  })

  return h('nav', { className: 'cw-rail', 'aria-label': '页列表' },
    h('div', { className: 'cw-rail-head' },
      h('span', { className: 'cw-section-title cw-grow' }, `${list.length} 页`),
      s.work?.source?.kind === 'images' && canDrag
        ? h(Button, { small: true, onClick: () => store.insertImages(), title: '选图插到当前页后面；拖动左侧的页可以换顺序' }, '＋插图') : null,
      range.size ? h('span', { className: 'cw-badge', title: 'Shift 点选的配词范围' }, `已框选 ${range.size}`) : null),
    h('div', {
      ref: scroller, className: 'cw-rail-scroll', role: 'listbox', 'aria-label': '页面',
      onScroll: e => setScrollTop(e.currentTarget.scrollTop),
    }, h('div', { style: { height: total, position: 'relative' } }, body),
    !rows.length ? h('div', { className: 'cw-empty' }, s.booting ? '载入中…' : '没有符合筛选的页') : null))
}
