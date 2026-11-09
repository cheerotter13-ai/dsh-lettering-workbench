

export const EDITOR_COOLDOWN_MS = 300

const EDITABLE_TAGS = new Set(['TEXTAREA', 'SELECT'])

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file', 'image'])

export function isEditable(target) {
  if (!target) return false
  const tag = String(target.tagName || '').toUpperCase()
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(target.type || 'text').toLowerCase())
  if (EDITABLE_TAGS.has(tag)) return true
  return !!target.isContentEditable
}

export function guard(event, env = {}) {
  if (event.defaultPrevented) return 'handled'
  if (event.repeat) return 'repeat'
  if (event.isComposing || event.keyCode === 229) return 'composing'
  if (isEditable(event.target)) return 'editable'
  const now = env.now ?? Date.now()
  if (env.editorClosedAt != null && now - env.editorClosedAt < EDITOR_COOLDOWN_MS) return 'cooldown'
  return null
}

export function commandFor(event, ctx = {}) {
  const key = event.key
  const mod = event.ctrlKey || event.metaKey
  if (mod && !event.altKey) {
    const lower = String(key).toLowerCase()
    if (lower === 'z') return { cmd: event.shiftKey ? 'redo' : 'undo' }
    if (lower === 'y') return { cmd: 'redo' }
    return null
  }
  if (event.altKey && !mod) {
    const m = /^Digit([0-9])$/.exec(event.code || '')
    if (m) return { cmd: 'speaker', arg: Number(m[1]) }
    return null
  }
  if (mod) return null
  switch (key) {
    case 'ArrowRight': return { cmd: 'next' }
    case 'ArrowLeft': return { cmd: 'prev' }
    case 'Tab': return { cmd: event.shiftKey ? 'prevLine' : 'nextLine' }
    case 'Enter': return event.shiftKey ? null : { cmd: 'edit' }
    case 'Delete': return { cmd: 'deleteLine' }
    case 'Escape': return { cmd: 'escape' }
    case '\\': return { cmd: 'originalOn' }
    default: break
  }
  if (event.shiftKey) return null
  switch (String(key).toLowerCase()) {
    case 'n': return { cmd: 'addLine' }
    case 'c': return { cmd: 'assign' }
    case 'p': return { cmd: 'cycle' }
    case 'r': return { cmd: 'relayout' }
    default: return null
  }
}

export function decide(event, env = {}) {
  if (guard(event, env)) return null
  const command = commandFor(event, env)
  if (!command) return null
  if (command.cmd === 'next' && env.finalizing) return null
  return command
}

export function keyupCommand(event) {
  return event.key === '\\' ? { cmd: 'originalOff' } : null
}

export const HINTS = [
  ['→', '下一页'], ['←', '上一页'], ['Tab', '换句'], ['Enter', '编辑'],
   ['Alt+数字', '选人'], ['N', '加句'], ['Del', '删句'],
  ['P', '换位置'], ['R', '重排'], ['C', '指认'], ['\\', '原图'], ['Ctrl+Z', '撤销'],
]
