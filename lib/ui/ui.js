

import { React, h } from './react.js'

export const cx = (...names) => names.filter(Boolean).join(' ')

export function Button({ children, onClick, disabled, kind, title, label, className, small, type = 'button', ...rest }) {
  const classes = cx('cw-btn', kind && `cw-${kind}`, small && 'cw-sm', className)
  return h('button', { type, className: classes, onClick, disabled, title, 'aria-label': label, ...rest }, children)
}

export function Select({ value, onChange, options, label, className, disabled, title }) {
  return h('select', {
    className: cx('cw-select', className), value: value ?? '', disabled, title, 'aria-label': label,
    onChange: e => onChange(e.target.value),
  }, options.map(([v, text]) => h('option', { key: String(v), value: v }, text)))
}

export function Field({ label, children }) {
  return h('label', { className: 'cw-field' }, h('span', null, label), children)
}

export function Seg({ value, options, onChange, label }) {
  return h('div', { className: 'cw-seg', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', {
      key: v, type: 'button', className: v === value ? 'cw-on' : '', 'aria-pressed': v === value,
      onClick: () => onChange(v),
    }, text)))
}

export function Kbd({ children }) { return h('span', { className: 'cw-kbd' }, children) }

const MARK = { final: '✓', stale: '⚠', draft: '●', empty: '○' }
const NAME = { final: '已定稿', stale: '定稿已过期', draft: '有字未定稿', empty: '无字' }

export function pageMark(row) {
  if (row.finalize_error) return { mark: '⚠', cls: 'error', title: `定稿失败：${row.finalize_error}` }
  if (row.status === 'final' && row.complete === false) {
    const n = row.missing?.length || 0
    return { mark: '⚠', cls: 'warn', title: n ? `已定稿，但 ${n} 句缺字` : '已定稿，但有句子缺字' }
  }
  const status = row.status || 'empty'
  return { mark: MARK[status] || '○', cls: status, title: NAME[status] || '' }
}

export function useDraft(value, commit, { delay = 1000, register } = {}) {
  const [draft, setDraft] = React.useState(value)
  const dirty = React.useRef(false)
  const timer = React.useRef(null)
  const latest = React.useRef({ draft: value, commit })
  latest.current = { draft, commit }
  React.useEffect(() => { if (!dirty.current) setDraft(value) }, [value])
  const flush = React.useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!dirty.current) return
    dirty.current = false
    latest.current.commit(latest.current.draft)
  }, [])
  React.useEffect(() => {
    const off = register?.(flush)
    return () => { flush(); off?.() }
  }, [])
  const change = React.useCallback(next => {
    setDraft(next)
    dirty.current = true
    latest.current = { ...latest.current, draft: next }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, delay)
  }, [delay])
  return [draft, change, flush]
}

export function confirmBox(text) {
  try { return globalThis.confirm ? globalThis.confirm(text) : true } catch { return true }
}
