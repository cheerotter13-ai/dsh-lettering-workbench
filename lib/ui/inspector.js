

import { React, h } from './react.js'
import * as store from './store.js'
import { Button, Field, Select, cx, useDraft, pageMark } from './ui.js'
import { PsPanel } from './ps.js'
import { AssetsTab } from './stickers.js'

const KIND_OPTIONS = Object.entries(store.KINDS)

function speakerOptions(characters) {
  return [['', '待确认'], ...characters.map((c, i) => [c.id, `${i < 9 ? `${i + 1} · ` : ''}${c.name || c.id}`])]
}

function opsFor(s, id) { return s.ops.filter(o => o.shotId === s.shotId && o.dialogueId === id) }

function OpState({ ops }) {
  if (!ops.length) return null
  const failed = ops.find(o => o.status === 'error')
  if (!failed) return h('div', { className: 'cw-op cw-faint' }, '保存中…')
  return h('div', { className: 'cw-op cw-err-text', role: 'alert' },
    h('span', { className: 'cw-grow' }, `${failed.label}没保存：${failed.error}`),
    h(Button, { small: true, onClick: () => store.retryOp(failed.id) }, '重试'),
    h(Button, { small: true, kind: 'ghost', onClick: () => store.dismissOp(failed.id) }, '放弃'))
}

function StyleControls({ layer, dialogue, characters }) {
  const set = patch => store.patchLayer(layer.dialogue_id, patch, { label: '改样式' })

  const colorTimer = React.useRef(null)
  const pendingColor = React.useRef(null)
  const flushColor = () => {
    if (colorTimer.current) { clearTimeout(colorTimer.current); colorTimer.current = null }
    const color = pendingColor.current
    pendingColor.current = null
    if (color) store.patchLayer(layer.dialogue_id, { color, color_manual: true }, { label: '改样式' })
  }
  const flushRef = React.useRef(flushColor)
  flushRef.current = flushColor
  React.useEffect(() => () => flushRef.current(), [])
  const pickColor = color => {
    pendingColor.current = color
    if (colorTimer.current) clearTimeout(colorTimer.current)
    colorTimer.current = setTimeout(() => flushRef.current(), 400)
  }
  const number = (key, label, opts = {}) => h(Field, { label },
    h('input', {
      className: 'cw-input', type: 'number', key: `${key}:${layer[key]}`, defaultValue: layer[key] ?? opts.fallback ?? 0,
      step: opts.step || 1, 'aria-label': label,
      onBlur: e => {
        const raw = Number(e.target.value)

        const v = key === 'font_size' ? Math.round(raw) : raw
        if (String(e.target.value).trim() !== '' && Number.isFinite(v) && v !== (layer[key] ?? opts.fallback ?? 0)) set({ [key]: v })
      },
      onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur() },
    }))
  const speaker = characters.find(c => c.id === dialogue.speaker_id)
  return h('div', { className: 'cw-style-grid' },
    h(Field, { label: '字体' }, h(Select, {
      label: '字体', value: store.KIND_FONT[layer.font] ? '' : layer.font || '',
      onChange: v => set({ font: v || dialogue.kind }),
      options: [['', '跟随类型'], ...Object.entries(store.FONTS)],
    })),
    number('font_size', '字号'),
    h(Field, { label: layer.color_manual ? '颜色（手选）' : '颜色（跟随角色）' },
      h('div', { className: 'cw-row' },
        h('input', {
          className: 'cw-color', type: 'color', key: `color:${layer.color || ''}`,
          defaultValue: /^#[0-9a-f]{6}$/i.test(layer.color || '') ? layer.color : '#222222',
          'aria-label': '颜色', onChange: e => pickColor(e.target.value), onBlur: () => flushRef.current(),
        }),
        layer.color_manual && speaker
          ? h(Button, { small: true, kind: 'ghost', onClick: () => set({ color_manual: false }), title: '恢复跟随角色色' }, '跟随')
          : null)),
    h(Field, { label: '排版' }, h(Select, {
      label: '横竖排', value: layer.mode || 'horizontal', onChange: v => set({ mode: v }),
      options: [['horizontal', '横排'], ['vertical', '竖排']],
    })),
    number('rotation', '旋转'),
    number('letter_spacing', '字距'),
    number('max_width', '换行宽度'),
    h(Field, { label: '位置' }, h('label', { className: 'cw-check' },
      h('input', { type: 'checkbox', checked: !!layer.locked, onChange: e => set({ locked: e.target.checked }) }),
      layer.locked ? '已锁定' : '自动排版可移动')))
}

function LineRow({ s, dialogue, index, characters, readOnly, drag }) {
  const [open, setOpen] = React.useState(false)
  const id = dialogue.id
  const selected = s.selectedId === id
  const layer = store.displayLayer(id)
  const text = store.textOf(dialogue, s.language)
  const [draft, change, flush] = useDraft(text, value => store.setLineText(id, value), { register: store.registerDraft })
  const color = layer?.color || characters.find(c => c.id === dialogue.speaker_id)?.color || '#888888'
  const warnings = (s.page?.display?.warnings || []).filter(w => w.dialogue_id === id)
  const sprite = s.page?.sprites?.find(sp => sp.dialogue_id === id)
  const glyphNote = sprite?.error === 'missing_glyph' ? '字体缺字：会记为不完整，但不拦定稿' : sprite?.error
  const notes = [...warnings.map(w => w.message || w.code), glyphNote].filter(Boolean)
  const n = index + 1
  return h('div', {
    className: cx('cw-line', selected && 'cw-sel', drag.over === id && 'cw-drop'),
    onClick: () => store.selectLine(id), 'aria-label': `第${n}句`,
    onDragOver: e => { if (drag.id) { e.preventDefault(); drag.setOver(id) } },
    onDrop: e => { e.preventDefault(); drag.drop(id) },
  },
  h('div', { className: 'cw-line-head' },
    h('span', {
      className: 'cw-grip', draggable: !readOnly, title: '拖动调整顺序', 'aria-hidden': true,
      onDragStart: e => {
        drag.start(id)
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) } catch {                    }
      },
      onDragEnd: () => drag.end(),
    }, '⋮⋮'),
    h('span', { className: 'cw-num' }, n),
    h('span', { className: 'cw-swatch', style: { background: color } }),
    h(Select, {
      className: 'cw-speaker', label: `第${n}句人物`, value: dialogue.speaker_id || '', disabled: readOnly,
      title: 'Alt+数字 快速选人（Alt+0 待确认）',
      onChange: v => store.updateLine(id, { speaker_id: v || null }, { label: '换说话人' }),
      options: speakerOptions(characters),
    }),
    h(Select, {
      className: 'cw-kind', label: `第${n}句类型`, value: dialogue.kind || 'dialogue', disabled: readOnly,
      onChange: v => store.updateLine(id, { kind: v }, { label: '换类型' }), options: KIND_OPTIONS,
    }),
    h('span', { className: 'cw-grow' }),
    layer?.transient ? h('span', { className: 'cw-badge', title: '还没保存的临时排版，第一次修改或定稿时写入' }, '临时') : null,
    h(Button, {
      kind: open ? 'on' : 'ghost', small: true, label: `第${n}句样式`, title: '字体、字号、颜色…',
      onClick: e => { e.stopPropagation(); setOpen(!open) },
    }, '样式'),
    h(Button, {
      kind: 'ghost', small: true, className: 'cw-danger', label: `删除第${n}句`, title: '删除这句（Del）', disabled: readOnly,
      onClick: e => { e.stopPropagation(); store.deleteLine(id) },
    }, '⌫')),
  h('textarea', {
    className: 'cw-textarea cw-line-text', rows: Math.max(1, String(draft).split('\n').length), value: draft,
    'aria-label': `第${n}句正文`, readOnly, placeholder: s.language === 'zh' ? '台词' : '尚未翻译',
    onChange: e => change(e.target.value), onBlur: flush,
    onFocus: () => store.selectLine(id),
    onKeyDown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); flush() } },
  }),
  notes.length ? h('div', { className: 'cw-small cw-warn-text' }, notes.join('；')) : null,
  h(OpState, { ops: opsFor(s, id) }),
  open && layer ? h(StyleControls, { layer, dialogue, characters }) : null)
}

function AddLine({ s, characters, readOnly }) {
  const [speaker, setSpeaker] = React.useState('pending')
  const [kind, setKind] = React.useState('dialogue')
  const [name, setName] = React.useState('')
  const [text, setText] = React.useState('')
  const first = React.useRef(null)
  React.useEffect(() => { if (s.addFocus) first.current?.focus() }, [s.addFocus])
  const kinds = speaker === 'none' ? KIND_OPTIONS.filter(([k]) => k === 'narration' || k === 'sfx') : KIND_OPTIONS
  function chooseSpeaker(value) {
    setSpeaker(value)
    if (value === 'none' && !['narration', 'sfx'].includes(kind)) setKind('narration')
  }
  function add() {
    if (!text.trim() || readOnly) return
    if (speaker === 'new' && !name.trim()) { store.notify('写上新人物的名字', 'warn'); return }
    const list = store.sortedDialogues(s.page?.shot)
    const after = list.find(d => d.id === s.selectedId)?.id || list[list.length - 1]?.id
    store.addLine({ speaker, kind, text, name: speaker === 'new' ? name.trim() : undefined, after })
    setText('')
    setName('')
  }
  return h('div', { className: 'cw-card cw-add', 'aria-label': '加一句' },
    h('div', { className: 'cw-row' }, h('span', { className: 'cw-section-title cw-grow' }, '+ 加一句'),
      h('span', { className: 'cw-faint cw-small' }, '人物 → 类型 → 正文')),
    h('div', { className: 'cw-add-row' },
      h('select', {
        ref: first, className: 'cw-select', 'aria-label': '新句人物', value: speaker, disabled: readOnly,
        onChange: e => chooseSpeaker(e.target.value),
      },
      h('option', { value: 'pending' }, '待确认'),
      h('option', { value: 'none' }, '旁白 / 不绑人'),
      characters.map(c => h('option', { key: c.id, value: c.id }, c.name || c.id)),
      h('option', { value: 'new' }, '＋ 新人物…')),
      h(Select, { label: '新句类型', value: kind, onChange: setKind, options: kinds, disabled: readOnly })),
    speaker === 'new' ? h('input', {
      className: 'cw-input', 'aria-label': '新人物名字', placeholder: '新人物名字（只加到这部作品）', value: name,
      maxLength: 40, onChange: e => setName(e.target.value),
    }) : null,
    h('div', { className: 'cw-row' },
      h('input', {
        className: 'cw-input cw-grow', 'aria-label': '新句正文', placeholder: '正文，回车加入', value: text, disabled: readOnly,
        onChange: e => setText(e.target.value),
        onKeyDown: e => {
          if (e.key !== 'Enter' || e.nativeEvent?.isComposing || e.keyCode === 229) return
          e.preventDefault()
          add()
        },
      }),
      h(Button, { kind: 'primary', small: true, disabled: readOnly || !text.trim(), onClick: add }, '加入')))
}

function PageTab({ s }) {
  const [dragId, setDragId] = React.useState('')
  const [over, setOver] = React.useState('')
  const page = s.page, shot = page?.shot
  const characters = s.work?.characters || []
  const readOnly = store.isReadOnly(s)
  const dialogues = store.sortedDialogues(shot)
  const row = s.pages.find(p => p.id === s.shotId)
  const mark = row ? pageMark(row) : null
  const drag = {
    id: dragId, over, setOver,
    start: id => setDragId(id),
    end: () => { setDragId(''); setOver('') },
    drop: target => {
      const ids = dialogues.map(d => d.id)
      const order = ids.filter(id => id !== dragId)
      const at = order.indexOf(target)
      if (dragId && at >= 0) {

        order.splice(ids.indexOf(dragId) < ids.indexOf(target) ? at + 1 : at, 0, dragId)
        store.reorderLines(order)
      }
      setDragId('')
      setOver('')
    },
  }
  if (!shot) return h('div', { className: 'cw-empty' }, s.pageLoading ? '载入中…' : '没有选中的页')
  const pageOps = s.ops.filter(o => o.shotId === s.shotId && !o.dialogueId)
  return h(React.Fragment, null,
    h('div', { className: 'cw-page-head' },
      h('b', null, shot.label || '本页'),
      mark ? h('span', { className: `cw-badge cw-${mark.cls}`, title: mark.title }, `${mark.mark} ${mark.title}`) : null,
      page.protected_reason ? h('span', { className: 'cw-badge cw-warn' }, page.protected_reason) : null,
      readOnly ? h('span', { className: 'cw-badge' }, '只读浏览') : null),
    s.finalizeError ? h('div', { className: 'cw-small cw-err-text', role: 'alert' }, `定稿失败：${s.finalizeError}`) : null,
    h(OpState, { ops: pageOps }),
    h(PsPanel, { s }),
    h('div', { className: 'cw-small cw-faint' }, `人物检测：${({disabled: '未启用（基础排版可用）', unavailable: '模型未就绪', error: '检测失败', ready: '已完成', pending: '进行中', none: '尚未检测'})[page.scene_status] ?? page.scene_status}`),
    h('div', { className: 'cw-add', role: 'list', 'aria-label': '本页台词' },
      dialogues.length
        ? dialogues.map((d, i) => h(LineRow, { key: d.id, s, dialogue: d, index: i, characters, readOnly, drag }))
        : h('div', { className: 'cw-empty' }, '这一页没有字。按 N 加一句；无字页也需要点击「通过并定稿」保存成品。')),
    h(AddLine, { s, characters, readOnly }))
}

const TABS = [['page', '本页'], ['assets', '素材']]

export function Inspector({ s }) {
  return h('aside', { className: 'cw-insp', 'aria-label': '嵌字与素材' },
    h('div', { className: 'cw-tabs', role: 'tablist' }, TABS.map(([key,label]) => h('button', {
      key, type: 'button', role: 'tab', 'aria-selected': s.tab === key, className: cx('cw-tab', s.tab === key && 'cw-on'),
      onClick: () => store.setState({ tab: key }),
    }, label))), h('div', { className: 'cw-tab-body', role: 'tabpanel' }, s.tab === 'assets' ? h(AssetsTab, { s }) : h(PageTab, { s })))
}
