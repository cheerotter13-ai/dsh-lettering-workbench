

export const BASE = '/plugins/lettering-workbench'
export const API = `${BASE}/api`
const HEADERS = { 'content-type': 'application/json', 'x-dsh-lettering-workbench': '1' }

let transport = null

export function setTransport(fn) { transport = fn }

export async function call(action, params = {}, opts = {}) {
  if (transport) return transport(action, params, opts)
  const response = await fetch(API, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ action, ...params }),
    keepalive: !!opts.keepalive,
    signal: opts.signal,
  })
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload.data
}

export function beacon(action, params = {}) {
  try {
    const sent = call(action, params, { keepalive: true })
    sent.catch(() => {})
    return sent
  } catch { return null }
}

const q = value => encodeURIComponent(value ?? '')

export const urls = {
  asset: (shotId, version) => `${API}?action=asset&shot_id=${q(shotId)}&version=${q(version)}`,
  thumb: (shotId, version) => `${API}?action=thumb&shot_id=${q(shotId)}${version != null ? `&v=${q(version)}` : ''}`,
  sprite: sig => `${API}?action=sprite&sig=${q(sig)}`,
  output: shotId => `${API}?action=output&shot_id=${q(shotId)}`,
  sticker: (assetId, kind = 'full') => `${API}?action=sticker&id=${q(assetId)}&kind=${q(kind)}`,
  faces: () => `${BASE}/fonts/faces.css`,
  live: (workId, since) => `${BASE}/live?work_id=${q(workId)}&since=${q(since)}`,
}

export function live(workId, since, onEvent, { onMode = () => {}, pollMs = 3000 } = {}) {
  let closed = false, source = null, timer = null, cursor = Number(since) || 0
  const advance = row => { if (Number(row?.seq) > cursor) cursor = Number(row.seq) }

  async function poll() {
    if (closed) return
    try {
      const data = await call('changes', { work_id: workId, since: cursor })
      if (closed) return
      for (const row of data?.changes || []) { advance(row); onEvent({ type: 'change', data: row }) }
      if (Number(data?.seq) > cursor) cursor = Number(data.seq)
    } catch {                                                   }
    if (!closed) timer = setTimeout(poll, pollMs)
  }

  function startPolling() {
    if (closed || timer) return
    onMode('poll')
    timer = setTimeout(poll, 0)
  }

  const ES = typeof EventSource === 'function' ? EventSource : null
  if (ES && !transport) {
    try {
      source = new ES(urls.live(workId, cursor))
      const parse = (type, event) => {
        let data = null
        try { data = JSON.parse(event.data) } catch { return }
        if (type === 'change') advance(data)
        onEvent({ type, data })
      }
      source.addEventListener('change', e => parse('change', e))
      source.addEventListener('job', e => parse('job', e))
      source.addEventListener('open', () => onMode('live'))
      source.onerror = () => {
        if (closed) return
        source?.close(); source = null
        startPolling()
      }
    } catch { source = null; startPolling() }
  } else startPolling()

  return () => {
    closed = true
    source?.close()
    if (timer) clearTimeout(timer)
  }
}
