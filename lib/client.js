window.__ModuleLoader__.load({

  id: 'dsh-lettering-workbench',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'lettering-workbench'
    const LABEL = '嵌字工作台'
    const UI = '/plugins/lettering-workbench/ui'

    let pending = null
    let host = null

    async function uiRevision() {
      try {
        const response = await fetch(`${UI}/rev`, { cache: 'no-store' })
        const body = await response.json()
        return body?.rev ?? body?.data?.rev ?? Date.now()
      } catch {
        return Date.now()
      }
    }

    function loadUi() {
      if (!pending) {
        pending = (async () => {
          const rev = await uiRevision()
          const mod = await import(`${UI}/app.js?rev=${encodeURIComponent(rev)}`)
          mod.setup({ React, ReactDOM: require('react-dom'), host })
          return mod
        })()
        pending.catch(() => { pending = null })
      }
      return pending
    }

    const boxStyle = {
      display: 'grid', placeItems: 'center', gap: 12, height: '100%', width: '100%',
      color: 'var(--dsw-alias-label-secondary, #5b606b)', background: 'var(--dsw-alias-bg-base, #fff)',
      fontSize: 13,
    }

    function Panel() {
      const [state, setState] = React.useState({ mod: null, error: '' })
      const [attempt, setAttempt] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        loadUi().then(
          mod => { if (alive) setState({ mod, error: '' }) },
          error => { if (alive) setState({ mod: null, error: error?.message || String(error) }) },
        )
        return () => { alive = false }
      }, [attempt])
      if (state.mod) return h(state.mod.App)
      if (state.error) {
        return h('div', { style: boxStyle, role: 'alert' },
          h('div', null, h('div', { style: { marginBottom: 8 } }, `工作台界面载入失败：${state.error}`),
            h('button', {
              type: 'button', onClick: () => { setState({ mod: null, error: '' }); setAttempt(n => n + 1) },
              style: {
                cursor: 'pointer', padding: '6px 12px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2, #ccc)',
                background: 'transparent', color: 'inherit', font: 'inherit',
              },
            }, '重新载入')))
      }
      return h('div', { style: boxStyle, role: 'status' }, '正在载入嵌字工作台…')
    }

    function PanelIcon({ size = 18 } = {}) {
      return h('span', {
        'aria-hidden': true,
        style: { display: 'inline-grid', placeItems: 'center', width: size, height: size, fontSize: Math.round(size * 0.9), lineHeight: 1 },
      }, '✎')
    }

    function Launcher({ wide = false } = {}) {
      return h('button', {
        type: 'button', title: LABEL, 'aria-label': LABEL,
        onClick: () => host.layout.selectPanel(PANEL_ID),
        style: {
          boxSizing: 'border-box', display: 'inline-flex', width: '100%', minWidth: 0, alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center', gap: 8, cursor: 'pointer', border: 0, borderRadius: 8,
          padding: '7px 9px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #5b606b)',
          font: 'inherit', fontSize: 13, lineHeight: '20px',
        },
      }, h('span', { 'aria-hidden': true }, '✎'), wide ? h('span', null, LABEL) : null)
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        host = ctx
        ctx.slots.inject('main', function* () {
          yield ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel)
        })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => LABEL,
        }, PanelIcon))
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: PANEL_ID, order: 21,
        }, Launcher))
      },
      logic: { PANEL_ID },
    }
  },
})
