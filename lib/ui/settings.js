

import { React, h } from './react.js'
import * as store from './store.js'
import { Button, Select } from './ui.js'

export const DEFAULT_STYLES = {
  dialogue: { font: 'wenkai', size_ratio: 0.042 },
  thought: { font: 'wenkai', size_ratio: 0.036 },
  narration: { font: 'wenkai', size_ratio: 0.034 },
  sfx: { font: 'wenkai', size_ratio: 0.06 },
}

const HEX = /^#[0-9a-f]{6}$/i
const GENDERS = [['', '未定'], ['female', '女'], ['male', '男']]
const newId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export function normalizeCharacters(rows) {
  return rows.filter(c => String(c.name || '').trim()).map(c => {
    const out = { ...c, name: String(c.name).trim().slice(0, 40) }
    out.aliases = (Array.isArray(c.aliases) ? c.aliases : String(c.aliases || '').split(/[,，、]/))
      .map(a => a.trim()).filter(Boolean)
    if (!HEX.test(out.color || '')) delete out.color
    if (!out.gender) out.gender = null
    return out
  })
}

function Characters({ s }) {
  const [rows, setRows] = React.useState(() => (s.work?.characters || []).map(c => ({ ...c, aliases: (c.aliases || []).join(', ') })))
  const set = (i, patch) => setRows(list => list.map((row, j) => j === i ? { ...row, ...patch } : row))
  return h('section', { className: 'cw-add', 'aria-label': '角色' },
    h('div', { className: 'cw-row' }, h('span', { className: 'cw-section-title cw-grow' }, '角色'),
      h('span', { className: 'cw-faint cw-small' }, '名字 · 颜色 · 性别 · 别名')),
    rows.map((c, i) => h('div', { key: c.id, className: 'cw-char-row' },
      h('input', {
        className: 'cw-input', value: c.name || '', 'aria-label': '角色名字', placeholder: '名字',
        onChange: e => set(i, { name: e.target.value }),
      }),
      h('input', {
        className: 'cw-color', type: 'color', value: HEX.test(c.color || '') ? c.color : c.faceless ? '#000000' : '#888888', 'aria-label': `${c.name || '角色'}的颜色`,
        title: c.color ? '手选颜色（不会被改）' : '自动配色；改一下就固定', onChange: e => set(i, { color: e.target.value }),
      }),
      h(Select, { label: '性别', value: c.gender || '', onChange: v => set(i, { gender: v || null }), options: GENDERS }),
      h('input', {
        className: 'cw-input', value: c.aliases, 'aria-label': '别名', placeholder: '别名，逗号分隔',
        onChange: e => set(i, { aliases: e.target.value }),
      }),
      h('label', { className: 'cw-check cw-small', title: '无脸男等不露脸的角色' },
        h('input', { type: 'checkbox', checked: !!c.faceless, onChange: e => set(i, { faceless: e.target.checked }) }), '无脸'),
      c.color ? h(Button, { small: true, kind: 'ghost', title: '恢复自动配色', onClick: () => set(i, { color: '' }) }, '自动') : h('span'),
      null)),
    h('div', { className: 'cw-row' },
      h(Button, { small: true, onClick: () => setRows(list => [...list, { id: newId(), name: '', aliases: '', gender: null }]) }, '+ 角色'),
      h('span', { className: 'cw-grow' }),
      h(Button, { kind: 'primary', small: true, onClick: () => store.saveCharacters(normalizeCharacters(rows)) }, '保存角色')),
    h('div', { className: 'cw-faint cw-small' },
      '改颜色不会改动任何页；已定稿的页会提示需要重新定稿。已有台词的角色不能删除。'),
    null)
}


export function cleanStyles(styles) {
  return Object.fromEntries(Object.entries(styles).map(([kind, style]) => {
    const ratio = Number(style?.size_ratio)
    const ok = Number.isFinite(ratio) && ratio >= 0.01 && ratio <= 0.2
    return [kind, { ...style, size_ratio: ok ? ratio : DEFAULT_STYLES[kind]?.size_ratio ?? 0.042 }]
  }))
}

function Styles({ s }) {
  const current = { ...DEFAULT_STYLES, ...(s.work?.settings?.styles || {}) }
  const [styles, setStyles] = React.useState(current)
  const set = (kind, patch) => setStyles(all => ({ ...all, [kind]: { ...all[kind], ...patch } }))
  return h('section', { className: 'cw-add', 'aria-label': '各类型样式' },
    h('span', { className: 'cw-section-title' }, '各类型默认样式'),
    Object.entries(store.KINDS).map(([kind, name]) => h('div', { key: kind, className: 'cw-row' },
      h('span', { style: { width: 40 } }, name),
      h(Select, {
        className: 'cw-grow', label: `${name}字体`, value: styles[kind]?.font,
        onChange: v => set(kind, { font: v }), options: Object.entries(store.FONTS),
      }),
      h('input', {
        className: 'cw-input', style: { width: 86 }, type: 'number', step: 0.001, min: 0.01, max: 0.2,
        'aria-label': `${name}字号比例`, title: '字号 = 图片长边 × 比例', value: styles[kind]?.size_ratio ?? '',
        onChange: e => set(kind, { size_ratio: Number(e.target.value) }),
      }),
      h('span', { className: 'cw-faint cw-small', style: { width: 64 } },
        s.page?.image?.width ? `≈${Math.round(Math.max(s.page.image.width, s.page.image.height || 0) * (styles[kind]?.size_ratio || 0))}px` : ''))),
    h('div', { className: 'cw-row' }, h('span', { className: 'cw-grow cw-faint cw-small' }, '只影响之后新排的句子'),
      h(Button, { kind: 'primary', small: true, onClick: () => store.saveSettings({ styles: cleanStyles(styles) }) }, '保存样式')))
}


export function SettingsDrawer({ s }) {
  if (!s.work) return null
  const close = () => store.setState({ drawer: null })
  return h(React.Fragment, null,
    h('div', { className: 'cw-scrim', onClick: close }),
    h('aside', { className: 'cw-drawer', role: 'dialog', 'aria-label': '作品设置' },
      h('div', { className: 'cw-drawer-head' }, h('b', { className: 'cw-grow' }, `作品设置 · ${s.work.title || ''}`),
        h(Button, { kind: 'ghost', className: 'cw-icon', label: '关闭作品设置', onClick: close }, '✕')),
      h('div', { className: 'cw-drawer-body', key: s.workId },
        h(Characters, { s }), h(Styles, { s }))))
}
