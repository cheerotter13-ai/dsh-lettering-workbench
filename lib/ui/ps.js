import { React, h } from './react.js'
import { call } from './api.js'
import * as store from './store.js'
import { Button } from './ui.js'

export function PsPanel({ s }) {
  const [view, setView] = React.useState(null), [busy, setBusy] = React.useState(false)
  const id = s.shotId
  React.useEffect(() => {
    let live = true
    const refresh = () => call('ps-state', { shot_id: id }).then(v => { if (live) setView(v) }).catch(() => {})
    setView(null); refresh()
    const timer = setInterval(refresh, 2000)
    return () => { live = false; clearInterval(timer) }
  }, [id])
  async function action(name, extra = {}) {
    setBusy(true)
    try { setView(await call(name, { shot_id: id, ...extra })); await store.reloadPage() }
    catch (error) { store.notify(error.message, 'error') }
    finally { setBusy(false) }
  }
  return h('section', { className: 'cw-add', 'aria-label': 'Photoshop 修图' },
    h('div', { className: 'cw-row' },
      h(Button, { small: true, disabled: busy || store.isReadOnly(s), onClick: () => action(view?.active ? 'ps-done' : 'ps-open') }, view?.active ? '停止监听' : 'PS 修图')),
    view?.active ? h('div', { className: 'cw-small' }, '保存 PNG 或同名兼容 PSD 后自动更新底图') : null,
    view?.error ? h('div', { className: 'cw-err-text', role: 'alert' }, view.error) : null,
    view?.needs_relayout ? h('div', { className: 'cw-warn-text' }, '底图尺寸已改变；位置未自动改动，请检查并手动重新排版。') : null,
    (view?.history ?? []).map((entry, index) => h(Button, { key: index, small: true, disabled: busy || store.isReadOnly(s), onClick: () => action('ps-restore', { index }) }, `底图 ${index + 1}`)))
}
