

import { React, h } from './react.js'
import * as store from './store.js'
import { Button, Seg } from './ui.js'

function formatBytes(n) {
  const v = Number(n) || 0
  if (v >= 1 << 30) return `${(v / (1 << 30)).toFixed(2)} GB`
  if (v >= 1 << 20) return `${(v / (1 << 20)).toFixed(1)} MB`
  return `${Math.round(v / 1024)} KB`
}

export function MoreMenu({ s }) {
 const close = () => store.setState({ drawer: null })
 const act = fn => () => { close(); fn() }
 return h(React.Fragment, null, h('div', { className: 'cw-scrim', onClick: close }),
  h('div', { className: 'cw-menu', role: 'menu' },
   h(Button, { onClick: act(() => store.importImages()) }, '选择图片新建作品'),
   h(Button, { disabled: !s.work, onClick: act(() => store.exportOrdered()) }, '按当前语言和顺序导出成品'),
   h(Seg, { label: '语言', value: s.language, onChange: v => { close(); store.setLanguage(v) }, options: Object.entries(store.LANGUAGES) }),
   h(Button, { disabled: !s.page?.shot || store.isReadOnly(s), onClick: act(() => store.setState({ markMode: true, assignMode: false })) }, '框选保护区域'),
   h(Button, { disabled: !s.page?.shot, onClick: act(() => store.setState({ dialog: 'versions' })) }, '版本记录'),
   h(Button, { disabled: !s.page?.shot || store.isReadOnly(s), onClick: act(() => store.setHidden(s.shotId, true)) }, '隐藏本页'),
   h(Button, { disabled: !s.work, onClick: act(() => store.setState({ dialog: 'hidden' })) }, '恢复隐藏页'),
   h(Button, { onClick: act(() => { store.setState({ dialog: 'gc' }); store.gcDryRun() }) }, '清理预览缓存')))
}

function Dialog({ title, children, footer }) {
  const close = () => store.setState({ dialog: null })
  return h(React.Fragment, null,
    h('div', { className: 'cw-scrim', onClick: close }),
    h('div', { className: 'cw-dialog', role: 'dialog', 'aria-label': title },
      h('div', { className: 'cw-drawer-head' }, h('b', { className: 'cw-grow' }, title),
        h(Button, { kind: 'ghost', className: 'cw-icon', label: `关闭${title}`, onClick: close }, '✕')),
      h('div', { className: 'cw-dialog-body' }, children),
      footer ? h('div', { className: 'cw-drawer-head', style: { borderTop: '1px solid var(--cw-line2)', borderBottom: 0 } }, footer) : null))
}

const ORIGIN = { user: '手改', ai: '模型', auto: '自动排版', job: '审校任务', import: '导入' }

function VersionsDialog({ s }) {
  const versions = [...(s.page?.versions || [])].reverse()
  return h(Dialog, { title: '版本记录' },
    versions.length ? versions.map(v => h('div', { key: v.version, className: 'cw-card' },
      h('div', { className: 'cw-row' }, h('b', null, `版本 ${v.version}`),
        h('span', { className: 'cw-badge' }, ORIGIN[v.origin] || v.origin || '—'),
        h('span', { className: 'cw-faint cw-small cw-grow' }, v.time ? new Date(v.time).toLocaleString() : '')),
      (v.dialogues || []).length
        ? v.dialogues.map(d => h('div', { key: d.id, className: 'cw-small' }, d.text || '（空）'))
        : h('div', { className: 'cw-small cw-faint' }, '无字')))
      : h('div', { className: 'cw-empty' }, '没有版本记录'))
}

function HiddenDialog({ s }) {
  const rows = s.pages.filter(p => p.hidden)
  return h(Dialog, { title: '隐藏的页' },
    rows.length ? rows.map(p => h('div', { key: p.id, className: 'cw-row' },
      h('span', { className: 'cw-grow' }, `${(p.index ?? 0) + 1} · ${p.label || p.id}`),
      h(Button, { small: true, onClick: () => store.setHidden(p.id, false) }, '恢复')))
      : h('div', { className: 'cw-empty' }, '没有隐藏的页'))
}

const sampleName = x => typeof x === 'string' ? x : x?.path || JSON.stringify(x)

function GcDialog({ s }) {
  const report = s.gcReport
  return h(Dialog, {
    title: '清理预览缓存',
    footer: h(React.Fragment, null,
      h('span', { className: 'cw-grow cw-faint cw-small' },
        '只清理可重建的预览缓存；定稿、成品、原图都不动。先放进回收区，7 天后才删除。同意一次后，以后每次启动和每 6 小时会自动清理。'),
      h(Button, { kind: 'primary', disabled: !report?.files, onClick: () => store.gcRun() }, '同意并清理')),
  },
  !report ? h('div', { className: 'cw-muted' }, '正在统计…')
    : h(React.Fragment, null,
      h('div', null, `可以清理 ${report.files || 0} 个文件，共 ${formatBytes(report.bytes)}。`),
      (report.sample || []).length
        ? h('pre', { className: 'cw-stream' }, report.sample.slice(0, 20).map(sampleName).join('\n'))
        : null))
}

export function Dialogs({ s }) {
  switch (s.dialog) {
    case 'versions': return h(VersionsDialog, { s })
    case 'hidden': return h(HiddenDialog, { s })
    case 'gc': return h(GcDialog, { s })
    default: return null
  }
}
