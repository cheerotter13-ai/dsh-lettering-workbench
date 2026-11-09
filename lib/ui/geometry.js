

export function dragPosition(start, event, rect, source) {
  const maxX = Math.max(0, source.width - (start.width || 0))
  const maxY = Math.max(0, source.height - (start.height || 0))
  const x = Math.round(start.x + (event.clientX - start.clientX) * source.width / rect.width)
  const y = Math.round(start.y + (event.clientY - start.clientY) * source.height / rect.height)
  return { x: Math.max(0, Math.min(maxX, x)), y: Math.max(0, Math.min(maxY, y)), locked: true }
}

export function resizeWidth(start, event, rect, source) {
  const base = start.max_width || start.width || 48
  const width = Math.round(base + (event.clientX - start.clientX) * source.width / rect.width)
  return { max_width: Math.max(48, width), locked: true }
}

export function scaleText(start, event, rect, source) {
  const w = start.max_width || start.width, h = start.height
  const dx = (event.clientX - start.clientX) * source.width / rect.width
  const dy = (event.clientY - start.clientY) * source.height / rect.height
  const ratio = Math.max(.1, 1 + (dx * w + dy * h) / (w * w + h * h))
  const font_size = Math.max(8, Math.min(256, Math.round(start.font_size * ratio)))
  return { font_size, max_width: Math.max(48, Math.round(w * font_size / start.font_size)), locked: true }
}

export function retainNewerShot(data, current) {
  const fresh = data?.shot, held = current?.shot
  if (fresh && held && fresh.id === held.id && fresh.version < held.version) data.shot = held
  return data
}

export function mutationQueue() {
  let tail = Promise.resolve()
  return task => {
    const next = tail.then(task)
    tail = next.catch(() => {})
    return next
  }
}

export function clampBox(box, size) {
  const width = box.width || 0, height = box.height || 0
  const x = Math.max(0, Math.min(Math.max(0, size.width - width), Math.round(box.x)))
  const y = Math.max(0, Math.min(Math.max(0, size.height - height), Math.round(box.y)))
  return { ...box, x, y }
}

export function toSource(rect, size, clientX, clientY) {
  const x = (clientX - rect.left) * size.width / rect.width
  const y = (clientY - rect.top) * size.height / rect.height
  return {
    x: Math.round(Math.max(0, Math.min(size.width, x))),
    y: Math.round(Math.max(0, Math.min(size.height, y))),
  }
}

export function fitScale(avail, size, pad = 16) {
  if (!avail?.width || !avail?.height || !size?.width || !size?.height) return 1
  const s = Math.min((avail.width - pad * 2) / size.width, (avail.height - pad * 2) / size.height)
  return Math.max(0.05, Math.min(4, s))
}

export function zoomStep(scale, deltaY) {
  const next = scale * (deltaY < 0 ? 1.1 : 1 / 1.1)
  return Math.max(0.1, Math.min(4, Math.round(next * 1000) / 1000))
}

export function gesturePatch(start, event, rect, source) {
  if (start.mode === 'resize') return resizeWidth(start, event, rect, source)
  if (start.mode === 'scale') return scaleText(start, event, rect, source)
  return dragPosition(start, event, rect, source)
}

export function gestureChanged(start, patch) {
  if (start.mode === 'scale') return patch.font_size !== start.font_size
  if (start.mode === 'resize') return patch.max_width !== start.max_width
  return patch.x !== start.x || patch.y !== start.y
}

export function gestureTransform(start, patch) {
  const dx = (patch.x ?? start.x) - start.x
  const dy = (patch.y ?? start.y) - start.y
  const scale = patch.font_size ? patch.font_size / start.font_size : 1
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}
