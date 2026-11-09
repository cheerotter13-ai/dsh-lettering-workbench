

const LIGHT = `
  --cw-bg: var(--dsw-alias-bg-base, #ffffff);
  --cw-bg1: var(--dsw-alias-bg-layer-1, #f7f7f8);
  --cw-bg2: var(--dsw-alias-bg-layer-2, #f0f1f3);
  --cw-bg3: var(--dsw-alias-bg-layer-3, #e7e8eb);
  --cw-fg: var(--dsw-alias-label-primary, #1b1d22);
  --cw-fg2: var(--dsw-alias-label-secondary, #5b606b);
  --cw-fg3: var(--dsw-alias-label-tertiary, #8a8f99);
  --cw-line1: var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  --cw-line2: var(--dsw-alias-border-l2, rgba(0, 0, 0, .10));
  --cw-line3: var(--dsw-alias-border-l3, rgba(0, 0, 0, .16));
  --cw-line4: var(--dsw-alias-border-l4, rgba(0, 0, 0, .24));
  --cw-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05));
  --cw-active: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, .09));
  --cw-primary: var(--dsw-alias-button-primary-fill, #1b1d22);
  --cw-primary-hover: var(--dsw-alias-button-primary-fill-hover, #34373f);
  --cw-on-primary: var(--dsw-alias-bg-base, #ffffff);
  --cw-accent: var(--dsw-alias-brand-primary, #1b1d22);
  --cw-ok: var(--dsw-alias-state-success-primary, #1f9d55);
  --cw-warn: var(--dsw-alias-state-warn-primary, #c27c0e);
  --cw-err: var(--dsw-alias-state-error-primary, #d92d20);
  --cw-canvas: var(--dsw-alias-bg-layer-3, #e9eaed);
`

const DARK = `
  --cw-bg: var(--dsw-alias-bg-base, #16171a);
  --cw-bg1: var(--dsw-alias-bg-layer-1, #1d1f23);
  --cw-bg2: var(--dsw-alias-bg-layer-2, #24262b);
  --cw-bg3: var(--dsw-alias-bg-layer-3, #2c2f35);
  --cw-fg: var(--dsw-alias-label-primary, #eceef2);
  --cw-fg2: var(--dsw-alias-label-secondary, #a9aeb8);
  --cw-fg3: var(--dsw-alias-label-tertiary, #7c818c);
  --cw-line1: var(--dsw-alias-border-l1, rgba(255, 255, 255, .06));
  --cw-line2: var(--dsw-alias-border-l2, rgba(255, 255, 255, .12));
  --cw-line3: var(--dsw-alias-border-l3, rgba(255, 255, 255, .18));
  --cw-line4: var(--dsw-alias-border-l4, rgba(255, 255, 255, .26));
  --cw-hover: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, .06));
  --cw-active: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, .11));
  --cw-primary: var(--dsw-alias-button-primary-fill, #eceef2);
  --cw-primary-hover: var(--dsw-alias-button-primary-fill-hover, #ffffff);
  --cw-on-primary: var(--dsw-alias-bg-base, #16171a);
  --cw-accent: var(--dsw-alias-brand-primary, #eceef2);
  --cw-ok: var(--dsw-alias-state-success-primary, #3ccf7c);
  --cw-warn: var(--dsw-alias-state-warn-primary, #f0b445);
  --cw-err: var(--dsw-alias-state-error-primary, #ff6b5e);
  --cw-canvas: var(--dsw-alias-bg-layer-3, #0e0f11);
`

export const CSS = `
.cw-root {
  ${LIGHT}
  --cw-sel: #3b82f6;
  --cw-range: #f5b301;
  --cw-rail-w: 216px;
  --cw-insp-w: 392px;
  position: relative; box-sizing: border-box;
  display: grid; grid-template-rows: 44px minmax(0, 1fr) 26px;
  width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden;
  background: var(--cw-bg); color: var(--cw-fg);
  font-family: var(--dsw-font-family, system-ui, "Microsoft YaHei", sans-serif);
  font-size: 13px; line-height: 1.45;
  container-type: inline-size;
}
body[data-ds-dark-theme] .cw-root { ${DARK} }
.cw-root *, .cw-root *::before, .cw-root *::after { box-sizing: border-box; }
.cw-root :focus-visible { outline: 2px solid var(--cw-sel); outline-offset: 1px; }
.cw-root button, .cw-root input, .cw-root select, .cw-root textarea { font: inherit; color: inherit; }
.cw-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.cw-root ::-webkit-scrollbar-thumb { background: var(--cw-line3); border-radius: 4px; }

/* container queries cannot style the container itself, so they target children */
@container (max-width: 1240px) {
  .cw-body { --cw-rail-w: 184px; --cw-insp-w: 344px; }
  .cw-top .cw-title { display: none; }
}
@container (max-width: 1060px) {
  .cw-body { --cw-rail-w: 156px; --cw-insp-w: 316px; }
  .cw-rail-page .cw-thumb { width: 28px; height: 36px; }
  .cw-top .cw-model { max-width: 120px; }
  .cw-hide-narrow { display: none !important; }
}

/* controls */
.cw-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; padding: 0 10px; border-radius: 7px; white-space: nowrap;
  border: 1px solid var(--cw-line2); background: var(--cw-bg); cursor: pointer;
}
.cw-btn:hover:not(:disabled) { background: var(--cw-hover); }
.cw-btn:disabled { opacity: .45; cursor: default; }
.cw-btn.cw-ghost { border-color: transparent; background: transparent; }
.cw-btn.cw-ghost:hover:not(:disabled) { background: var(--cw-hover); }
.cw-btn.cw-icon { width: 28px; padding: 0; }
.cw-btn.cw-primary { background: var(--cw-primary); color: var(--cw-on-primary); border-color: transparent; font-weight: 600; }
.cw-btn.cw-primary:hover:not(:disabled) { background: var(--cw-primary-hover); }
.cw-btn.cw-on { background: var(--cw-active); border-color: var(--cw-line3); }
.cw-btn.cw-danger { color: var(--cw-err); }
.cw-btn.cw-sm { height: 24px; padding: 0 7px; font-size: 12px; border-radius: 6px; }
.cw-input, .cw-select, .cw-textarea {
  height: 28px; padding: 0 8px; border-radius: 7px; min-width: 0;
  border: 1px solid var(--cw-line2); background: var(--cw-bg);
}
.cw-select { padding-right: 4px; }
.cw-textarea { height: auto; padding: 6px 8px; resize: vertical; line-height: 1.5; width: 100%; }
.cw-input:focus, .cw-select:focus, .cw-textarea:focus { outline: none; border-color: var(--cw-line4); box-shadow: 0 0 0 2px var(--cw-active); }
.cw-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; white-space: nowrap; }
.cw-muted { color: var(--cw-fg2); }
.cw-faint { color: var(--cw-fg3); }
.cw-small { font-size: 12px; }
.cw-err-text { color: var(--cw-err); }
.cw-warn-text { color: var(--cw-warn); }
.cw-ok-text { color: var(--cw-ok); }
.cw-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cw-wrap { flex-wrap: wrap; }
.cw-grow { flex: 1 1 auto; min-width: 0; }
.cw-sep { width: 1px; height: 18px; background: var(--cw-line2); flex: none; margin: 0 2px; }
.cw-kbd {
  display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 4px; text-align: center;
  border: 1px solid var(--cw-line2); background: var(--cw-bg1); font-size: 11px; line-height: 16px;
}
.cw-badge {
  display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 9px;
  font-size: 11px; white-space: nowrap; background: var(--cw-bg2); color: var(--cw-fg2);
}
.cw-badge.cw-final { color: var(--cw-ok); }
.cw-badge.cw-stale, .cw-badge.cw-warn { color: var(--cw-warn); }
.cw-badge.cw-error { color: var(--cw-err); }
.cw-section-title { font-size: 12px; font-weight: 600; color: var(--cw-fg2); letter-spacing: .02em; white-space: nowrap; }
.cw-empty { padding: 24px 12px; text-align: center; color: var(--cw-fg3); }

/* top bar */
.cw-top {
  display: flex; align-items: center; gap: 6px; padding: 0 8px; min-width: 0;
  border-bottom: 1px solid var(--cw-line2); background: var(--cw-bg); overflow: hidden;
}
.cw-top .cw-title { font-weight: 600; white-space: nowrap; margin-right: 4px; }
.cw-top .cw-work { max-width: 200px; }
.cw-top .cw-jump { width: 72px; }
.cw-top .cw-model { max-width: 170px; }
.cw-counter { font-variant-numeric: tabular-nums; white-space: nowrap; }

/* body columns */
.cw-body {
  display: grid; min-height: 0; min-width: 0;
  grid-template-columns: var(--cw-rail-w) minmax(0, 1fr) var(--cw-insp-w);
}
.cw-body.cw-no-rail { grid-template-columns: 0 minmax(0, 1fr) var(--cw-insp-w); }

/* page rail */
.cw-rail { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--cw-line2); background: var(--cw-bg1); }
.cw-rail-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--cw-line1); }
.cw-rail-scroll { position: relative; flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; outline: none; }
.cw-rail-group {
  position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 6px;
  padding: 0 8px; font-size: 11px; font-weight: 600; color: var(--cw-fg2); cursor: pointer;
  background: var(--cw-bg1); border-bottom: 1px solid var(--cw-line1);
}
.cw-rail-page {
  position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 8px;
  padding: 0 8px 0 6px; cursor: pointer; border-left: 3px solid transparent; user-select: none;
}
.cw-rail-page:hover { background: var(--cw-hover); }
.cw-rail-page.cw-current { background: var(--cw-active); border-left-color: var(--cw-fg); }
.cw-rail-page.cw-inrange { box-shadow: inset 0 0 0 1px var(--cw-range); background: color-mix(in srgb, var(--cw-range) 12%, transparent); }
.cw-rail-page.cw-drop-before { box-shadow: inset 0 3px 0 var(--cw-fg); }
.cw-rail-page.cw-drop-after { box-shadow: inset 0 -3px 0 var(--cw-fg); }
.cw-rail-page.cw-current.cw-inrange { background: color-mix(in srgb, var(--cw-range) 20%, var(--cw-active)); }
.cw-thumb {
  flex: none; width: 34px; height: 44px; border-radius: 4px; overflow: hidden;
  background: var(--cw-bg3); display: grid; place-items: center; color: var(--cw-fg3); font-size: 10px;
}
.cw-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cw-rail-text { min-width: 0; flex: 1 1 auto; }
.cw-rail-label { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; overflow: hidden; }
.cw-rail-label b { font-weight: 600; font-variant-numeric: tabular-nums; }
.cw-rail-preview { font-size: 11px; color: var(--cw-fg3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cw-st { flex: none; width: 16px; text-align: center; font-size: 12px; }
.cw-st-final { color: var(--cw-ok); }
.cw-st-stale, .cw-st-warn { color: var(--cw-warn); }
.cw-st-error { color: var(--cw-err); }
.cw-st-draft { color: var(--cw-fg2); }
.cw-st-empty { color: var(--cw-fg3); }

/* canvas */
.cw-center { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--cw-canvas); }
.cw-canvas-bar {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px; flex: none;
  background: var(--cw-bg); border-bottom: 1px solid var(--cw-line1); overflow: hidden;
}
.cw-canvas-info { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; }
.cw-canvas-tools { display: flex; align-items: center; gap: 2px; flex: none; }
.cw-stage-wrap { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; }
.cw-stage-box { position: relative; margin: auto; flex: none; }
.cw-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-shadow: 0 1px 12px rgba(0, 0, 0, .18); background: #fff; }
.cw-stage img.cw-base { display: block; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; }
.cw-layer { position: absolute; transform-origin: 0 0; cursor: move; touch-action: none; }
.cw-layer img { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; user-select: none; }
.cw-layer.cw-sel { outline: 2px dashed var(--cw-sel); outline-offset: 2px; }
.cw-layer.cw-transient { outline: 1px dotted rgba(59, 130, 246, .55); }
.cw-layer.cw-pending { opacity: .75; }
.cw-layer.cw-failed { outline: 2px solid var(--cw-err); }
.cw-layer-fallback { white-space: pre-wrap; pointer-events: none; opacity: .85; }
.cw-handle { position: absolute; background: #fff; border: 1px solid var(--cw-sel); border-radius: 2px; touch-action: none; }
.cw-handle.cw-resize { cursor: ew-resize; }
.cw-handle.cw-scale { cursor: nwse-resize; background: var(--cw-sel); }
.cw-editor {
  position: absolute; z-index: 5; resize: none; border: 2px solid var(--cw-sel); border-radius: 3px;
  background: rgba(255, 255, 255, .88); padding: 0; margin: 0; outline: none; overflow: hidden;
  white-space: pre-wrap; line-height: 1.22;
}
.cw-person { position: absolute; border: 2px solid #22c55e; background: rgba(34, 197, 94, .10); cursor: pointer; }
.cw-person.cw-assigned { border-color: #f59e0b; background: rgba(245, 158, 11, .12); }
.cw-person-tag {
  position: absolute; left: 0; top: 0; transform-origin: 0 0; padding: 2px 6px; white-space: nowrap;
  background: rgba(17, 24, 39, .82); color: #fff; font-size: 12px; border-radius: 0 0 6px 0;
}
.cw-picker {
  position: absolute; z-index: 6; transform-origin: 0 0; min-width: 150px; padding: 4px;
  background: var(--cw-bg); color: var(--cw-fg); border: 1px solid var(--cw-line3); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .22); display: grid; gap: 2px;
}
.cw-picker button { text-align: left; border: 0; background: transparent; padding: 4px 8px; border-radius: 5px; cursor: pointer; }
.cw-picker button:hover { background: var(--cw-hover); }
.cw-mark-layer { position: absolute; inset: 0; cursor: crosshair; touch-action: none; }
.cw-region { position: absolute; border: 2px dashed #f59e0b; background: rgba(245, 158, 11, .12); pointer-events: none; }
.cw-canvas-msg {
  position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 4; max-width: 80%;
  padding: 5px 12px; border-radius: 8px; background: var(--cw-bg); border: 1px solid var(--cw-line2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .12); font-size: 12px;
}
.cw-original-tag { position: absolute; right: 12px; top: 12px; z-index: 4; }

/* inspector */
.cw-insp { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 1px solid var(--cw-line2); background: var(--cw-bg); }
.cw-tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--cw-line2); flex: none; }
.cw-tab {
  height: 30px; padding: 0 12px; border: 0; background: transparent; cursor: pointer; color: var(--cw-fg2);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.cw-tab.cw-on { color: var(--cw-fg); border-bottom-color: var(--cw-fg); font-weight: 600; }
.cw-tab-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px; display: grid; align-content: start; gap: 12px; }
.cw-card { border: 1px solid var(--cw-line2); border-radius: 10px; padding: 8px; display: grid; gap: 6px; background: var(--cw-bg); }
.cw-page-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cw-line {
  border: 1px solid var(--cw-line2); border-radius: 9px; padding: 6px; display: grid; gap: 5px; background: var(--cw-bg);
}
.cw-line.cw-sel { border-color: var(--cw-line4); box-shadow: 0 0 0 1px var(--cw-line4); background: var(--cw-bg1); }
.cw-line.cw-drop { border-top: 2px solid var(--cw-sel); }
.cw-line-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cw-grip { cursor: grab; color: var(--cw-fg3); padding: 0 2px; user-select: none; }
.cw-num { width: 18px; text-align: center; color: var(--cw-fg3); font-variant-numeric: tabular-nums; flex: none; }
.cw-swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; border: 1px solid var(--cw-line3); }
.cw-line .cw-speaker { flex: 1 1 96px; max-width: 150px; }
.cw-line .cw-kind { flex: 0 0 64px; }
.cw-line-text { min-height: 34px; font-size: 14px; }
.cw-cands { display: flex; gap: 4px; flex-wrap: wrap; }
.cw-cand {
  max-width: 100%; display: inline-flex; gap: 4px; align-items: baseline; padding: 2px 7px; border-radius: 6px;
  border: 1px solid var(--cw-line2); background: var(--cw-bg1); cursor: pointer; text-align: left; font-size: 12px;
}
.cw-cand:hover { background: var(--cw-hover); }
.cw-cand.cw-on { border-color: var(--cw-fg); background: var(--cw-active); }
.cw-cand span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
.cw-style-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.cw-field { display: grid; gap: 3px; font-size: 11px; color: var(--cw-fg2); min-width: 0; }
.cw-op { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.cw-add { display: grid; gap: 6px; }
.cw-add-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 88px); gap: 6px; }
.cw-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.cw-chip {
  border: 1px solid var(--cw-line2); background: var(--cw-bg1); border-radius: 14px; padding: 2px 10px;
  cursor: pointer; font-size: 12px; max-width: 100%; text-align: left;
}
.cw-chip:hover { background: var(--cw-hover); }
.cw-seg { display: inline-flex; border: 1px solid var(--cw-line2); border-radius: 7px; overflow: hidden; }
.cw-seg button { border: 0; background: transparent; height: 26px; padding: 0 9px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.cw-seg button + button { border-left: 1px solid var(--cw-line2); }
.cw-seg button.cw-on { background: var(--cw-active); font-weight: 600; }
.cw-job { display: grid; gap: 4px; border-left: 3px solid var(--cw-line3); padding: 2px 0 2px 8px; }
.cw-job.cw-failed { border-left-color: var(--cw-err); }
.cw-job.cw-done { border-left-color: var(--cw-ok); }
.cw-tkm-cands { display: flex; flex-wrap: wrap; gap: 6px; }
.cw-tkm-cand { display: grid; gap: 2px; justify-items: center; border: 2px solid var(--cw-line2); border-radius: 7px; padding: 2px; background: var(--cw-bg1); cursor: pointer; font-size: 11px; }
.cw-tkm-cand.cw-on { border-color: var(--cw-fg); background: var(--cw-active); cursor: default; }
.cw-tkm-cand img, .cw-tkm-item img { width: 64px; height: 64px; object-fit: contain; display: block; }
.cw-tkm-item { display: flex; gap: 8px; align-items: flex-start; }
.cw-stream {
  max-height: 160px; overflow: auto; white-space: pre-wrap; font-size: 12px; margin: 0;
  background: var(--cw-bg1); border-radius: 6px; padding: 6px; color: var(--cw-fg2);
}

/* board */
.cw-board-row { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 8px; padding: 8px; border: 1px solid var(--cw-line2); border-radius: 9px; }
.cw-board-row.cw-current { border-color: var(--cw-line4); }
.cw-board-thumb { width: 54px; height: 72px; border-radius: 5px; overflow: hidden; background: var(--cw-bg3); cursor: zoom-in; border: 0; padding: 0; }
.cw-board-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cw-board-line { display: grid; gap: 3px; padding: 4px 6px; border-radius: 6px; }
.cw-board-line.cw-cursor { background: var(--cw-active); box-shadow: inset 2px 0 0 var(--cw-fg); }

/* chat */
.cw-chat { display: grid; gap: 8px; }
.cw-msg { padding: 6px 9px; border-radius: 9px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--cw-bg1); }
.cw-msg.cw-user { background: var(--cw-bg2); justify-self: end; max-width: 92%; }

/* status bar */
.cw-status {
  display: flex; align-items: center; gap: 10px; padding: 0 10px; font-size: 11.5px; color: var(--cw-fg2);
  border-top: 1px solid var(--cw-line2); background: var(--cw-bg1); overflow: hidden; white-space: nowrap;
}
.cw-hints { display: flex; gap: 10px; overflow: hidden; flex: 1 1 auto; min-width: 0; }
.cw-hints span { display: inline-flex; gap: 4px; align-items: center; flex: none; }
.cw-status > .cw-btn, .cw-status > span { flex: none; }

/* drawers, menus, dialogs (inside the panel root, never body portals) */
.cw-scrim { position: absolute; inset: 0; z-index: 30; background: rgba(0, 0, 0, .18); }
.cw-drawer {
  position: absolute; top: 44px; right: 0; bottom: 26px; z-index: 31; width: min(560px, 92%);
  background: var(--cw-bg); border-left: 1px solid var(--cw-line3); box-shadow: -8px 0 28px rgba(0, 0, 0, .18);
  display: flex; flex-direction: column; min-height: 0;
}
.cw-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--cw-line2); }
.cw-drawer-body { flex: 1 1 auto; overflow-y: auto; padding: 12px; display: grid; gap: 16px; align-content: start; }
.cw-menu {
  position: absolute; top: 40px; right: 8px; z-index: 31; width: 280px; padding: 6px;
  background: var(--cw-bg); border: 1px solid var(--cw-line3); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .2); display: grid; gap: 1px; max-height: calc(100% - 60px); overflow-y: auto;
}
.cw-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 8px;
  border: 0; border-radius: 6px; background: transparent; cursor: pointer;
}
.cw-menu-item:hover:not(:disabled) { background: var(--cw-hover); }
.cw-menu-item:disabled { opacity: .45; cursor: default; }
.cw-menu-label { padding: 6px 8px 2px; font-size: 11px; color: var(--cw-fg3); }
.cw-menu hr { border: 0; border-top: 1px solid var(--cw-line1); margin: 4px 0; }
.cw-dialog {
  position: absolute; left: 50%; top: 72px; transform: translateX(-50%); z-index: 32;
  width: min(620px, 92%); max-height: calc(100% - 120px); display: flex; flex-direction: column;
  background: var(--cw-bg); border: 1px solid var(--cw-line3); border-radius: 12px; box-shadow: 0 16px 48px rgba(0, 0, 0, .28);
}
.cw-dialog-body { overflow-y: auto; padding: 12px; display: grid; gap: 10px; }
.cw-char-row { display: grid; grid-template-columns: minmax(0, 1.1fr) 34px 78px minmax(0, 1.4fr) auto auto; gap: 6px; align-items: center; }
.cw-char-persona { grid-column: 1 / -1; margin-bottom: 4px; }
.cw-color { width: 34px; height: 28px; padding: 2px; border: 1px solid var(--cw-line2); border-radius: 7px; background: var(--cw-bg); }
.cw-toast {
  position: absolute; right: 12px; bottom: 36px; z-index: 40; max-width: 420px; padding: 8px 12px;
  border-radius: 9px; background: var(--cw-fg); color: var(--cw-bg); box-shadow: 0 6px 20px rgba(0, 0, 0, .25);
}
.cw-toast.cw-warn { background: var(--cw-warn); color: #111; }
.cw-toast.cw-error { background: var(--cw-err); color: #fff; }
.cw-welcome { grid-column: 1 / -1; display: grid; place-items: center; overflow: auto; }
.cw-welcome-card { width: min(560px, 92%); display: grid; gap: 12px; padding: 24px; }
.cw-work-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--cw-line2); background: var(--cw-bg); text-align: left; width: 100%;
}
.cw-work-item:hover { background: var(--cw-hover); }
.cw-sticker { position: absolute; transform-origin: 50% 50%; cursor: move; touch-action: none; }
.cw-sticker img { width: 100%; height: 100%; display: block; pointer-events: none; user-select: none; }
.cw-sticker.cw-sel { outline: 2px dashed #f59e0b; outline-offset: 1px; }
.cw-sticker.cw-locked { cursor: default; }
.cw-handle.cw-rotate { cursor: grab; border-radius: 50%; background: #f59e0b; border-color: #f59e0b; }
.cw-chip.cw-on { border-color: var(--cw-fg); background: var(--cw-active); }
.cw-asset-filters { gap: 4px; }
.cw-asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
.cw-asset { position: relative; border: 1px solid var(--cw-line2); border-radius: 8px; overflow: hidden;
  background: repeating-conic-gradient(var(--cw-bg2) 0 25%, var(--cw-bg) 0 50%) 0 0 / 12px 12px; }
.cw-asset.cw-on { border-color: var(--cw-fg); }
.cw-asset.cw-hidden-asset { opacity: .45; }
.cw-asset-pick { display: block; width: 100%; aspect-ratio: 1; padding: 4px; border: 0; background: transparent; cursor: pointer; }
.cw-asset-pick:disabled { cursor: default; }
.cw-asset-pick:hover:not(:disabled) { background: var(--cw-hover); }
.cw-asset-pick img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.cw-asset-text { position: absolute; left: 0; right: 0; bottom: 0; padding: 1px 4px; font-size: 11px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; background: color-mix(in srgb, var(--cw-bg) 85%, transparent); pointer-events: none; }
.cw-asset-more { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; padding: 0; border-radius: 6px;
  border: 1px solid var(--cw-line2); background: var(--cw-bg); cursor: pointer; opacity: 0; font-size: 12px; line-height: 1; }
.cw-asset:hover .cw-asset-more, .cw-asset.cw-on .cw-asset-more, .cw-asset-more:focus-visible { opacity: 1; }
.cw-page-stickers { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 6px; }
.cw-asset-more.cw-asset-del { opacity: 1; color: var(--cw-err); }
.cw-sticker-mini { width: 36px; height: 36px; object-fit: contain; flex: none;
  background: repeating-conic-gradient(var(--cw-bg2) 0 25%, var(--cw-bg) 0 50%) 0 0 / 8px 8px; border-radius: 6px; }
`
