

import { React, h } from './react.js'
import * as store from './store.js'
import { FILTERS } from './page-rail.js'
import { Button, Select } from './ui.js'

export function counts(pages) {
  let final = 0, warn = 0
  for (const p of pages) {
    if (p.hidden) continue
    if (p.status === 'final' && p.complete !== false && !p.finalize_error) final++
    else if (p.status === 'stale' || p.complete === false || p.finalize_error) warn++
  }
  return { final, warn }
}

function iconButton(text, label, title, onClick, on = false) {
  return h(Button, { kind: on ? 'on' : 'ghost', className: 'cw-icon', label, title, onClick }, text)
}

function toggleDrawer(name) {
  store.setState(s => ({ drawer: s.drawer === name ? null : name }))
}

export function Topbar({ s }) {
  const [jump, setJump] = React.useState('')
  const host = store.getHost()
  const list = store.visiblePages(s)
  const index = list.findIndex(p => p.id === s.shotId)
  const { final, warn } = counts(s.pages)
  const readOnly = store.isReadOnly(s)
  const works = s.works.filter(w => w.id !== 'neutral-acceptance' || w.id === s.workId)

  return h('header', { className: 'cw-top', role: 'toolbar', 'aria-label': '工作台顶栏' },
    h('span', { className: 'cw-title' }, '嵌字工作台'),
    h(Select, {
      className: 'cw-work', label: '选择作品', value: s.workId, onChange: id => store.openWork(id),
      options: [['', works.length ? '选择作品…' : '还没有作品'], ...works.map(w => [w.id, `${w.title || w.id}（${w.count ?? '?'}）`])],
    }),
    s.work ? h(React.Fragment, null,
      h('span', { className: 'cw-counter', 'aria-label': '页码' }, `${index + 1}/${list.length}`),
      h('span', { className: 'cw-badge cw-final', title: '当前版本已定稿' }, `✓${final}`),
      warn ? h('span', { className: 'cw-badge cw-warn', title: '定稿过期、缺字或定稿失败' }, `⚠${warn}`) : null,
      h(Select, { label: '筛选', value: s.filter, onChange: v => store.setState({ filter: v }), options: FILTERS }),
      h('input', {
        className: 'cw-input cw-jump', 'aria-label': '跳页', placeholder: '跳页', value: jump,
        title: '页码或文件名，回车跳过去（不定稿）',
        onChange: e => setJump(e.target.value),
        onKeyDown: e => {
          if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return
          e.preventDefault()
          if (store.jumpTo(jump)) { setJump(''); e.currentTarget.blur() }
        },
      }),
      h('label', { className: 'cw-check cw-small', title: '打开后不能修改或定稿；翻页始终只浏览，不定稿' },
        h('input', { type: 'checkbox', checked: readOnly, 'aria-label': '只读浏览', onChange: e => store.setReadOnly(e.target.checked) }),
        '只读浏览')) : null,
    h('span', { className: 'cw-grow' }),
    s.work ? h(React.Fragment, null,
      iconButton('⚙', '作品设置', '作品设置', () => toggleDrawer('settings'), s.drawer === 'settings')) : null,
    iconButton('⋯', '更多', '更多', () => toggleDrawer('more'), s.drawer === 'more'),
    s.work ? h(Button, {
      kind: 'primary', disabled: !s.page?.shot || readOnly || s.finalizing,
      title: readOnly ? '只读浏览中不定稿' : '把当前显示的版本写入嵌字成品（停在本页）',
      onClick: () => store.finalizeHere(),
    }, s.finalizing ? '定稿中…' : '通过并定稿') : null,
    h('span', { className: 'cw-sep' }),
    iconButton('⇤', '收起侧栏', '收起 / 展开 DSH 侧栏（Ctrl+Alt+B）', () => host?.layout?.toggleSidebar?.()),
    iconButton('✕', '关闭工作台', '回到聊天（保存完才退出）', () => store.exitPanel()))
}
