

import { React, h, setReact } from './react.js'
import * as store from './store.js'
import { live, urls } from './api.js'
import { decide, keyupCommand, HINTS } from './keys.js'
import { CSS } from './theme.js'
import { Topbar } from './topbar.js'
import { PageRail } from './page-rail.js'
import { CanvasView } from './canvas.js'
import { Inspector } from './inspector.js'
import { SettingsDrawer } from './settings.js'
import { MoreMenu, Dialogs } from './more-menu.js'
import { Button, Kbd } from './ui.js'

let pageListeners = false
export function setup({ React: react, ReactDOM, host }) {
  setReact(react, ReactDOM)
  store.setHost(host)

  if (!pageListeners && typeof window !== 'undefined' && typeof document !== 'undefined') {
    pageListeners = true
    window.addEventListener('pagehide', () => store.flushNow())
    document.addEventListener('visibilitychange', () => store.setBackground(document.visibilityState === 'hidden'))
  }
}

export function handleKeyDown(event, now = Date.now()) {
  const s = store.getState()
  const command = decide(event, {
    now, editorClosedAt: store.editorClosedTime(), finalizing: s.finalizing, boardActive: s.tab === 'board',
  })
  if (!command) return null
  if (s.drawer || s.dialog) {
    if (command.cmd !== 'escape') return null
    event.preventDefault?.()
    store.setState({ drawer: null, dialog: null })
    return command
  }
  if (!s.work && command.cmd !== 'escape') return null
  event.preventDefault?.()
  const id = s.selectedId
  switch (command.cmd) {
    case 'next': store.finalizeAndNext(); break
    case 'prev': store.goPrev(); break
    case 'nextLine': store.stepLine(1); break
    case 'prevLine': store.stepLine(-1); break
    case 'edit': if (id) store.openEditor(id); break
    case 'speaker': store.setSpeakerByIndex(command.arg); break
    case 'addLine': store.setState({ tab: 'page', addFocus: Date.now() }); break
    case 'deleteLine': if (s.stickerId) store.deleteSticker(s.stickerId); else if (id) store.deleteLine(id); break
    case 'assign': store.toggleAssign(); break
    case 'cycle': store.cyclePosition(id); break
    case 'relayout': store.relayout(); break
    case 'originalOn': store.setState({ showOriginal: true }); break
    case 'undo': store.undo(); break
    case 'redo': store.redo(); break
    case 'escape':
      if (s.assignMode || s.markMode) store.setState({ assignMode: false, markMode: false })
      else store.exitPanel()
      break
    default: return null
  }
  return command
}

function StatusBar({ s }) {
  const ops = s.ops
  const failed = ops.filter(o => o.status === 'error')
  const pending = ops.length - failed.length
  let saved
  if (failed.length) {
    saved = h('span', { className: 'cw-row cw-err-text' }, `${failed.length} 项没保存`,
      h(Button, { small: true, kind: 'ghost', onClick: () => failed.forEach(o => store.retryOp(o.id)) }, '全部重试'))
  } else if (pending) saved = h('span', { className: 'cw-muted' }, `保存中 ${pending}…`)
  else saved = h('span', { className: 'cw-ok-text' }, '已保存')
  return h('footer', { className: 'cw-status', role: 'status' },
    saved,
    s.finalizing ? h('span', null, '定稿中…') : null,
    h('div', { className: 'cw-hints' }, HINTS.map(([key, text]) =>
      h('span', { key }, h(Kbd, null, key), text))),
    s.liveMode === 'poll' ? h('span', { className: 'cw-faint', title: '实时连接不可用，每 3 秒同步一次' }, '轮询同步') : null,
    s.work ? h(Button, { small: true, kind: 'ghost', onClick: () => store.goPrev(), disabled: !store.neighbor(-1) }, '上一页') : null,
    s.work ? h(Button, {
      small: true, disabled: s.finalizing || !s.page?.shot,
      title: '下一页',
      onClick: () => store.finalizeAndNext(),
    }, '下一页') : null)
}

function Welcome({ s }) {
  const works = s.works.filter(w => w.id !== 'neutral-acceptance')
  return h('div', { className: 'cw-welcome' },
    h('div', { className: 'cw-welcome-card' },
      h('h2', { style: { margin: 0, fontSize: 18 } }, s.booting ? '正在打开作品…' : '选一部作品开始'),
      s.bootError ? h('div', { className: 'cw-err-text', role: 'alert' }, s.bootError) : null,
      s.worksError ? h('div', { className: 'cw-err-text', role: 'alert' }, `作品列表读不出来：${s.worksError}`) : null,
      works.map(w => h('button', { key: w.id, type: 'button', className: 'cw-work-item', onClick: () => store.openWork(w.id) },
        h('b', { className: 'cw-grow' }, w.title || w.id), h('span', { className: 'cw-faint' }, `${w.count ?? '?'} 页`))),
      h('div', { className: 'cw-row' },
        h(Button, { kind: 'primary', onClick: () => store.importImages() }, '选择图片新建作品')),
      h('div', { className: 'cw-faint cw-small' }, '导入只读取图片，不改原图；定稿和导出写入插件独立数据目录。')))
}

function Toast({ notice }) {
  React.useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => {
      if (store.getState().notice === notice) store.setState({ notice: null })
    }, notice.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [notice])
  if (!notice) return null
  const kind = notice.kind === 'info' ? '' : `cw-${notice.kind}`
  return h('div', { className: `cw-toast ${kind}`, role: notice.kind === 'error' ? 'alert' : 'status' }, notice.text)
}

function useLifecycle() {
  React.useEffect(() => {
    let disposed = false
    store.loadWorks().then(() => {
      if (disposed || store.getState().workId) return
      const last = store.lastWorkId()
      const works = store.getState().works
      if (last && works.some(w => w.id === last)) store.openWork(last)
    })
    const onKey = event => handleKeyDown(event)
    const onKeyUp = event => { if (keyupCommand(event)) store.setState({ showOriginal: false }) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onKeyUp)
    return () => {
      disposed = true
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onKeyUp)

      store.commitDrafts()
    }
  }, [])
}

function useLive(s) {
  const workId = s.work?.id || ''
  React.useEffect(() => { if (workId) return live(workId, store.getState().seq, store.onLiveEvent, { onMode: mode => store.setState({ liveMode: mode }) }) }, [workId])
}

export function App() {
  const s = store.useAppState()
  useLifecycle()
  useLive(s)
  return h('div', { className: 'cw-root', role: 'application', 'aria-label': '嵌字工作台', 'data-lettering-workbench': true },
    h('style', null, CSS),
    h('link', { rel: 'stylesheet', href: urls.faces() }),
    h(Topbar, { s }),
    s.work
      ? h('div', { className: 'cw-body' }, h(PageRail, { s }), h(CanvasView, { s }), h(Inspector, { s }))
      : h('div', { className: 'cw-body' }, h(Welcome, { s })),
    h(StatusBar, { s }),
    s.drawer === 'settings' ? h(SettingsDrawer, { s }) : null,
    s.drawer === 'more' ? h(MoreMenu, { s }) : null,
    h(Dialogs, { s }),
    h(Toast, { notice: s.notice }))
}
