import test from 'node:test'
import assert from 'node:assert/strict'
import * as state from '../lib/ui/store.js'
import { setup, App } from '../lib/ui/app.js'
import { createRoutes } from '../lib/index.js'
import { createPhotoshop } from '../lib/ps.js'
import { fixture, add } from './helpers.js'

function react() {
  return {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useReducer: (_, init, lazy) => [lazy ? lazy(init) : init, () => {}],
    useEffect() {}, useLayoutEffect() {},
    useRef: current => ({ current }), useMemo: fn => fn(), useCallback: fn => fn,
    useSyncExternalStore: (_, get) => get(),
  }
}
function render(node, out = []) {
  if (node == null || typeof node === 'boolean') return out
  if (Array.isArray(node)) { node.forEach(n => render(n, out)); return out }
  if (typeof node !== 'object') { out.push(String(node)); return out }
  if (typeof node.type === 'function') return render(node.type(node.props), out)
  out.push(node); return render(node.props.children, out)
}
test('complete UI imports, renders local tabs, saves and undoes using real API', async () => {
  const { wb, work, id } = await fixture()
  const ps = createPhotoshop({ wb, open() {} })
  const routes = createRoutes({}, wb, ps)
  state.resetStore()
  setup({ React: react(), ReactDOM: {}, host: { layout: {} } })
  state.setSender((action, args) => routes.action({ action, ...args }))
  try {
    await add(wb, id, 'Hello')
    await state.loadWorks(); await state.openWork(work.id)
    let nodes = render(App()), text = nodes.filter(n => typeof n === 'string').join('|')
    assert.match(text, /PS 修图/)
    assert.match(text, /人物检测/)
    assert.doesNotMatch(text, /配词|流程提案|选模型|剧情记忆/)
    const dialogue = wb.store.shot(id).dialogues[0].id
    await state.setLineText(dialogue, 'Edited')
    await state.whenIdle()
    assert.equal(wb.store.shot(id).dialogues[0].text, 'Edited')
    await state.undo(); await state.whenIdle()
    assert.equal(wb.store.shot(id).dialogues[0].text, 'Hello')
    await state.redo(); await state.whenIdle()
    assert.equal(wb.store.shot(id).dialogues[0].text, 'Edited')
    state.setState({ tab: 'assets' }); await state.loadAssets()
    assert.match(render(App()).filter(n => typeof n === 'string').join('|'), /导入 PNG 贴纸/)
    for (const drawer of ['more', 'settings']) {
      state.setState({ drawer })
      assert.ok(render(App()).length)
    }
  } finally {
    state.resetStore(); routes.closeStreams(); await ps.close(); await wb.close()
  }
})

test('HTTP routes reject cross-origin writes, unknown/removed actions and path traversal', async () => {
  const { wb } = await fixture()
  const ps = createPhotoshop({ wb, open() {} }), routes = createRoutes({}, wb, ps)
  function response() {
    return { statusCode: 0, headers: {}, setHeader(k,v) { this.headers[k]=v }, end(value) { this.body=value } }
  }
  try {
    await assert.rejects(routes.action({ action: 'cowrite-start' }), /未知/)
    await assert.rejects(routes.action({ action: 'workflow-confirm' }), /未知/)
    const res = response()
    await routes.routes[0].handler({ method: 'POST', url: '/plugins/lettering-workbench/api',
      headers: { 'x-dsh-lettering-workbench': '1', 'content-type': 'application/json', host: '127.0.0.1', origin: 'https://example.invalid' },
      async *[Symbol.asyncIterator]() { yield Buffer.from('{"action":"works"}') } }, res)
    assert.equal(res.statusCode, 400)
    assert.match(res.body, /跨源/)
    const traversal = response()
    routes.routes[1].handler({ url: '/plugins/lettering-workbench/ui/%2e%2e%2fpackage.json' }, traversal)
    assert.equal(traversal.statusCode, 404)
  } finally { routes.closeStreams(); await ps.close(); await wb.close() }
})
