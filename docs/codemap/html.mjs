// Рендер самодостаточной интерактивной карты: один HTML-файл без сети,
// данные — тот же объект, что уходит в codemap.json (никакого второго источника).

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** JSON внутрь <script type="application/json">: рвём последовательности, закрывающие тег. */
const safeJson = (obj) =>
  JSON.stringify(obj)
    .replace(/</g, '\\u003c')

export function renderHtml({ map, lock, kinds, repo }) {
  const payload = safeJson({ map, lock, kinds })
  const dirty = lock.working_tree_dirty
  const changed = lock.previous?.changed_modules ?? []
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Карта кода · ${esc(repo)}</title>
<style>
  :root {
    --bg: #0a0e14; --panel: #10151d; --panel-2: #151c26; --line: #212a37;
    --fg: #dbe4f0; --dim: #8291a6; --accent: #ff7715; --ok: #63d68a; --warn: #ffc857;
    --font: ui-sans-serif, system-ui, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, 'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--fg); font: 14px/1.45 var(--font); overflow: hidden; }
  a { color: #7cc4ff; }

  header {
    display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
    padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel);
  }
  header h1 { font-size: 15px; margin: 0; letter-spacing: .3px; }
  header h1 b { color: var(--accent); }
  header .meta { font: 12px/1.4 var(--mono); color: var(--dim); display: flex; gap: 14px; flex-wrap: wrap; }
  .badge { padding: 1px 7px; border-radius: 999px; font: 11px/1.6 var(--mono); border: 1px solid var(--line); }
  .badge.dirty { color: #101318; background: var(--warn); border-color: var(--warn); }
  .badge.clean { color: var(--ok); border-color: #2b4a36; }
  .badge.changed { color: #101318; background: var(--accent); border-color: var(--accent); }

  main { display: flex; height: calc(100% - 47px); }
  aside {
    width: 340px; min-width: 340px; border-right: 1px solid var(--line); background: var(--panel);
    overflow-y: auto; padding: 12px;
  }
  aside h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--dim); margin: 16px 0 8px; }
  aside h2:first-child { margin-top: 0; }
  input[type=search] {
    width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--panel-2); color: var(--fg); font: 13px var(--font);
  }
  input[type=search]:focus { outline: none; border-color: var(--accent); }

  .legend { display: flex; flex-direction: column; gap: 3px; }
  .legend button {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer;
    background: none; border: 1px solid transparent; border-radius: 7px; padding: 4px 7px;
    color: var(--fg); font: 12px var(--font);
  }
  .legend button:hover { background: var(--panel-2); }
  .legend button[aria-pressed=false] { opacity: .38; }
  .legend .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .legend .count { margin-left: auto; color: var(--dim); font: 11px var(--mono); }

  .flows { display: flex; flex-direction: column; gap: 4px; }
  .flows button {
    text-align: left; cursor: pointer; border: 1px solid var(--line); border-radius: 8px;
    background: var(--panel-2); color: var(--fg); padding: 7px 9px; font: 12px var(--font);
  }
  .flows button:hover { border-color: #33415a; }
  .flows button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px rgba(255,119,21,.35); }
  .flows small { display: block; color: var(--dim); margin-top: 2px; }

  .detail { font-size: 12.5px; }
  .detail .title { font-size: 14px; font-weight: 600; }
  .detail .path { font: 11.5px var(--mono); color: var(--dim); word-break: break-all; margin: 2px 0 8px; }
  .detail section { margin-top: 10px; }
  .detail section > b { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); margin-bottom: 4px; }
  .detail ul { margin: 0; padding-left: 16px; }
  .detail li { margin: 2px 0; }
  .detail code, .mono { font: 11.5px var(--mono); color: #cbd6e6; }
  .chip {
    display: inline-block; margin: 2px 4px 2px 0; padding: 2px 7px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--panel-2); font: 11px var(--mono); cursor: pointer;
  }
  .chip:hover { border-color: var(--accent); }
  .muted { color: var(--dim); }
  .unknown { color: var(--warn); }

  .canvas-wrap { position: relative; flex: 1; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; cursor: grab; }
  svg.panning { cursor: grabbing; }
  .controls { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; }
  .controls button {
    width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line);
    background: rgba(16,21,29,.92); color: var(--fg); cursor: pointer; font-size: 14px;
  }
  .controls button:hover { border-color: var(--accent); }
  .hint {
    position: absolute; left: 12px; bottom: 10px; font: 11px var(--mono); color: var(--dim);
    background: rgba(10,14,20,.78); padding: 4px 8px; border-radius: 7px; pointer-events: none;
  }

  .node rect.box { fill: var(--panel-2); stroke: var(--line); stroke-width: 1; }
  .node:hover rect.box { stroke: #44546e; }
  .node text.t { font: 600 12.5px var(--font); fill: var(--fg); }
  .node text.p { font: 10.5px var(--mono); fill: var(--dim); }
  .node text.k { font: 10px var(--mono); }
  .node { cursor: pointer; }
  .node.sel rect.box { stroke: var(--accent); stroke-width: 2; }
  .node.up rect.box { stroke: #7cc4ff; stroke-width: 1.6; }
  .node.down rect.box { stroke: #8be9c0; stroke-width: 1.6; }
  .node.flow rect.box { stroke: var(--accent); stroke-width: 1.6; stroke-dasharray: 4 3; }
  .node.hit rect.box { stroke: var(--warn); stroke-width: 1.6; }
  .node.dim { opacity: .2; }
  .node .chg { fill: var(--accent); }
  .edge { fill: none; stroke: #4b5f80; stroke-width: 1.5; }
  .edge.calls { stroke: #4f87ab; }
  .edge.reads, .edge.writes { stroke: #9a7050; stroke-dasharray: 5 4; }
  .edge.unknown { stroke: #6b5a2a; stroke-dasharray: 2 4; }
  .edge.hl { stroke: var(--accent); stroke-width: 2.2; }
  .edge.up { stroke: #7cc4ff; stroke-width: 2; }
  .edge.down { stroke: #8be9c0; stroke-width: 2; }
  .edge.dim { opacity: .12; }
  .step-badge { font: 700 10px var(--mono); fill: #101318; }
</style>
</head>
<body>
<header>
  <h1>Карта кода · <b>${esc(repo)}</b></h1>
  <div class="meta">
    <span>сгенерировано ${esc(map.generated_at)}</span>
    <span>commit <span class="mono">${esc(String(map.generated_from_commit).slice(0, 12))}</span></span>
    <span class="badge ${dirty ? 'dirty' : 'clean'}">${dirty ? 'working tree грязный' : 'working tree чистый'}</span>
    ${changed.length ? `<span class="badge changed">изменено с прошлой карты: ${changed.length}</span>` : ''}
    <span>${map.nodes.length} модулей · ${map.edges.length} связей · ${map.flows.length} потоков</span>
  </div>
</header>
<main>
  <aside>
    <h2>Поиск</h2>
    <input type="search" id="q" placeholder="модуль, файл, символ…" autocomplete="off">
    <h2>Типы модулей</h2>
    <div class="legend" id="legend"></div>
    <h2>Сквозные потоки</h2>
    <div class="flows" id="flows"></div>
    <h2 id="detail-h">Модуль</h2>
    <div class="detail" id="detail"><span class="muted">Кликните модуль на карте — покажу, кто его зовёт, что он тянет, какие тесты его держат и в какие потоки он входит.</span></div>
  </aside>
  <div class="canvas-wrap">
    <svg id="svg"><g id="viewport"><g id="edges"></g><g id="nodes"></g></g></svg>
    <div class="controls">
      <button id="zin" title="Приблизить">+</button>
      <button id="zout" title="Отдалить">−</button>
      <button id="fit" title="Вписать">⤢</button>
    </div>
    <div class="hint">колесо — зум · тянуть фон — панорама · тянуть модуль — переставить · Esc — сброс</div>
  </div>
</main>
<script type="application/json" id="data">${payload}</script>
<script>
(() => {
  const DATA = JSON.parse(document.getElementById('data').textContent)
  const { map, lock, kinds } = DATA
  const nodes = map.nodes.map(n => ({ ...n }))
  const edges = map.edges.map(e => ({ ...e }))
  const flows = map.flows
  const byId = new Map(nodes.map(n => [n.id, n]))
  const changed = new Set(lock.previous?.changed_modules ?? [])

  // ——— раскладка слоями: продольная ось = направление зависимости
  const outs = new Map(nodes.map(n => [n.id, []]))
  const ins = new Map(nodes.map(n => [n.id, []]))
  for (const e of edges) {
    if (!outs.has(e.from) || !ins.has(e.to)) continue
    outs.get(e.from).push(e.to)
    ins.get(e.to).push(e.from)
  }
  // Ярус берём из модели (архитектурный уровень); если не задан — longest-path.
  const layer = new Map(nodes.map(n => [n.id, Number.isInteger(n.tier) ? n.tier : 0]))
  if (nodes.some(n => !Number.isInteger(n.tier))) {
    for (let pass = 0; pass < nodes.length; pass++) {
      let moved = false
      for (const e of edges) {
        const a = layer.get(e.from), b = layer.get(e.to)
        if (a === undefined || b === undefined) continue
        if (Number.isInteger(byId.get(e.to).tier)) continue
        if (b < a + 1) { layer.set(e.to, a + 1); moved = true }
      }
      if (!moved) break
    }
  }
  const layers = []
  for (const n of nodes) {
    const L = layer.get(n.id)
    ;(layers[L] ||= []).push(n.id)
  }
  // барицентр: несколько проходов вниз/вверх — режем пересечения рёбер
  const pos = new Map()
  layers.forEach(l => l.forEach((id, i) => pos.set(id, i)))
  const bary = (id, adj) => {
    const xs = adj.get(id).map(x => pos.get(x)).filter(v => v !== undefined)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : pos.get(id)
  }
  for (let it = 0; it < 12; it++) {
    const down = it % 2 === 0
    const order = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i)
    for (const li of order) {
      const l = layers[li]
      if (!l) continue
      const adj = down ? ins : outs
      l.sort((a, b) => bary(a, adj) - bary(b, adj) || a.localeCompare(b))
      l.forEach((id, i) => pos.set(id, i))
    }
  }
  // Слои разворачиваем слева направо: экраны широкие, а зависимость читается
  // как течение — вход в систему слева, листья ядра справа.
  const NW = 244, NH = 64, GX = 40, GY = 84
  const widest = Math.max(...layers.map(l => (l ? l.length : 0)))
  const totalW = widest * (NW + GX)
  layers.forEach((l, li) => {
    if (!l) return
    const rowW = l.length * (NW + GX)
    l.forEach((id, i) => {
      const n = byId.get(id)
      n.x = (totalW - rowW) / 2 + i * (NW + GX)
      n.y = li * (NH + GY)
    })
  })

  // ——— отрисовка
  const svg = document.getElementById('svg')
  const vp = document.getElementById('viewport')
  const gE = document.getElementById('edges')
  const gN = document.getElementById('nodes')
  const NS = 'http://www.w3.org/2000/svg'
  const el = (t, a = {}) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e }

  const defs = el('defs')
  for (const [id, color] of [['a-def', '#4b5f80'], ['a-hl', '#ff7715'], ['a-up', '#7cc4ff'], ['a-down', '#8be9c0']]) {
    const m = el('marker', { id, viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' })
    m.appendChild(el('path', { d: 'M0,0 L8,4 L0,8 z', fill: color }))
    defs.appendChild(m)
  }
  vp.appendChild(defs)

  const edgeEls = edges.map(e => {
    const p = el('path', { class: 'edge ' + e.type + (e.evidence === 'unknown' ? ' unknown' : ''), 'marker-end': 'url(#a-def)' })
    p.dataset.from = e.from; p.dataset.to = e.to
    gE.appendChild(p)
    return p
  })

  const nodeEls = new Map()
  for (const n of nodes) {
    const g = el('g', { class: 'node' })
    g.dataset.id = n.id
    const color = (kinds[n.kind] || {}).color || '#8a97a8'
    g.appendChild(el('rect', { class: 'box', width: NW, height: NH, rx: 10 }))
    g.appendChild(el('rect', { width: 4, height: NH, rx: 2, fill: color }))
    const t = el('text', { class: 't', x: 14, y: 23 }); t.textContent = n.name
    const p = el('text', { class: 'p', x: 14, y: 39 }); p.textContent = n.path || '(внешняя система)'
    const k = el('text', { class: 'k', x: 14, y: 53, fill: color }); k.textContent = (kinds[n.kind] || {}).label || n.kind
    g.append(t, p, k)
    if (changed.has(n.id)) {
      g.appendChild(el('circle', { class: 'chg', cx: NW - 12, cy: 12, r: 4 }))
      const ttl = el('title'); ttl.textContent = 'изменился с прошлой генерации карты'
      g.appendChild(ttl)
    }
    gN.appendChild(g)
    nodeEls.set(n.id, g)
  }

  const draw = () => {
    for (const [id, g] of nodeEls) {
      const n = byId.get(id)
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')')
    }
    edges.forEach((e, i) => {
      const a = byId.get(e.from), b = byId.get(e.to)
      if (!a || !b) return
      let d
      if (Math.abs(b.y - a.y) < NH) {
        // связь внутри яруса — ведём сбоку, чтобы не путать с течением вниз
        const left = a.x < b.x
        const x1 = left ? a.x + NW : a.x, x2 = left ? b.x : b.x + NW
        const y1 = a.y + NH / 2, y2 = b.y + NH / 2
        const dx = Math.max(30, Math.abs(x2 - x1) / 2) * (left ? 1 : -1)
        d = 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2
      } else {
        const down = b.y > a.y
        const y1 = down ? a.y + NH : a.y, y2 = down ? b.y : b.y + NH
        const x1 = a.x + NW / 2, x2 = b.x + NW / 2
        const dy = Math.max(30, Math.abs(y2 - y1) / 2) * (down ? 1 : -1)
        d = 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2
      }
      edgeEls[i].setAttribute('d', d)
    })
  }
  draw()

  // ——— зум и панорама
  let view = { x: 40, y: 30, k: 0.85 }
  const apply = () => vp.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')')
  const fit = () => {
    const bb = { x1: Math.min(...nodes.map(n => n.x)), y1: Math.min(...nodes.map(n => n.y)),
                 x2: Math.max(...nodes.map(n => n.x + NW)), y2: Math.max(...nodes.map(n => n.y + NH)) }
    const r = svg.getBoundingClientRect()
    const k = Math.min((r.width - 80) / (bb.x2 - bb.x1), (r.height - 80) / (bb.y2 - bb.y1), 1.15)
    view = { k, x: (r.width - (bb.x2 - bb.x1) * k) / 2 - bb.x1 * k, y: (r.height - (bb.y2 - bb.y1) * k) / 2 - bb.y1 * k }
    apply()
  }
  apply()
  requestAnimationFrame(fit)
  window.addEventListener('resize', fit)
  document.getElementById('zin').onclick = () => { view.k *= 1.2; apply() }
  document.getElementById('zout').onclick = () => { view.k /= 1.2; apply() }
  document.getElementById('fit').onclick = fit
  svg.addEventListener('wheel', ev => {
    ev.preventDefault()
    const r = svg.getBoundingClientRect()
    const mx = ev.clientX - r.left, my = ev.clientY - r.top
    const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12
    view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; view.k *= f
    apply()
  }, { passive: false })

  let drag = null
  svg.addEventListener('mousedown', ev => {
    const g = ev.target.closest('.node')
    if (g) drag = { type: 'node', id: g.dataset.id, sx: ev.clientX, sy: ev.clientY, ox: byId.get(g.dataset.id).x, oy: byId.get(g.dataset.id).y, moved: false }
    else { drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, ox: view.x, oy: view.y }; svg.classList.add('panning') }
  })
  window.addEventListener('mousemove', ev => {
    if (!drag) return
    const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy
    if (drag.type === 'pan') { view.x = drag.ox + dx; view.y = drag.oy + dy; apply() }
    else {
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
      const n = byId.get(drag.id); n.x = drag.ox + dx / view.k; n.y = drag.oy + dy / view.k; draw()
    }
  })
  window.addEventListener('mouseup', ev => {
    if (drag && drag.type === 'node' && !drag.moved) select(drag.id)
    else if (drag && drag.type === 'pan' && Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) < 3) select(null)
    svg.classList.remove('panning')
    drag = null
  })

  // ——— состояние выделения
  let selected = null, activeFlow = null, query = ''
  const hidden = new Set()

  const kindCounts = {}
  nodes.forEach(n => { kindCounts[n.kind] = (kindCounts[n.kind] || 0) + 1 })
  const legend = document.getElementById('legend')
  for (const k in kinds) {
    if (!kindCounts[k]) continue
    const b = document.createElement('button')
    b.setAttribute('aria-pressed', 'true')
    b.innerHTML = '<span class="dot" style="background:' + kinds[k].color + '"></span>' + kinds[k].label + '<span class="count">' + kindCounts[k] + '</span>'
    b.onclick = () => {
      if (hidden.has(k)) hidden.delete(k); else hidden.add(k)
      b.setAttribute('aria-pressed', String(!hidden.has(k)))
      render()
    }
    legend.appendChild(b)
  }

  const flowsBox = document.getElementById('flows')
  flows.forEach(f => {
    const b = document.createElement('button')
    b.innerHTML = f.name + '<small>' + f.trigger + '</small>'
    b.onclick = () => { activeFlow = activeFlow === f.id ? null : f.id; selected = null; render(); showFlow(); scrollToDetail() }
    b.dataset.id = f.id
    flowsBox.appendChild(b)
  })

  const q = document.getElementById('q')
  q.oninput = () => { query = q.value.trim().toLowerCase(); render() }
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { selected = null; activeFlow = null; query = ''; q.value = ''; render(); showDetail(null) } })

  const matches = n => {
    if (!query) return false
    const hay = [n.id, n.name, n.path || '', n.role, ...(n.files || []), ...(n.tests || []), ...(n.entrypoints || [])].join(' ').toLowerCase()
    return hay.includes(query)
  }

  function render() {
    const flow = flows.find(f => f.id === activeFlow)
    const flowNodes = flow ? flow.steps.map(s => s.node) : []
    const up = new Set(), down = new Set()
    if (selected) {
      edges.forEach(e => { if (e.to === selected) up.add(e.from); if (e.from === selected) down.add(e.to) })
    }
    for (const [id, g] of nodeEls) {
      const n = byId.get(id)
      const off = hidden.has(n.kind)
      g.style.display = off ? 'none' : ''
      g.classList.toggle('sel', id === selected)
      g.classList.toggle('up', up.has(id))
      g.classList.toggle('down', down.has(id))
      g.classList.toggle('flow', flowNodes.includes(id))
      g.classList.toggle('hit', matches(n))
      const inFocus = !selected || id === selected || up.has(id) || down.has(id)
      const inFlow = !flow || flowNodes.includes(id)
      const inQuery = !query || matches(n)
      g.classList.toggle('dim', !(inFocus && inFlow && inQuery))
      const old = g.querySelector('.step-wrap')
      if (old) old.remove()
      if (flow) {
        const idx = flow.steps.map((s, i) => [s.node, i]).filter(([nid]) => nid === id).map(([, i]) => i + 1)
        if (idx.length) {
          const w = el('g', { class: 'step-wrap' })
          w.appendChild(el('circle', { cx: 0, cy: 12, r: 9, fill: '#ff7715' }))
          const t = el('text', { class: 'step-badge', x: 0, y: 15.5, 'text-anchor': 'middle' })
          t.textContent = idx.join(',')
          w.appendChild(t)
          g.appendChild(w)
        }
      }
    }
    edges.forEach((e, i) => {
      const p = edgeEls[i]
      const a = byId.get(e.from), b = byId.get(e.to)
      const off = hidden.has(a.kind) || hidden.has(b.kind)
      p.style.display = off ? 'none' : ''
      const isUp = selected && e.to === selected
      const isDown = selected && e.from === selected
      const inFlowPair = flow && flow.steps.some((s, k) => k > 0 && flow.steps[k - 1].node === e.from && s.node === e.to)
      p.classList.toggle('up', !!isUp)
      p.classList.toggle('down', !!isDown)
      p.classList.toggle('hl', !!inFlowPair)
      p.setAttribute('marker-end', isUp ? 'url(#a-up)' : isDown ? 'url(#a-down)' : inFlowPair ? 'url(#a-hl)' : 'url(#a-def)')
      p.classList.toggle('dim', (selected && !isUp && !isDown) || (flow && !inFlowPair))
    })
    for (const b of flowsBox.children) b.classList.toggle('on', b.dataset.id === activeFlow)
  }

  const list = (arr, cls = '') => arr && arr.length
    ? '<ul>' + arr.map(x => '<li class="' + cls + '">' + String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</li>').join('') + '</ul>'
    : '<span class="muted">—</span>'

  const scrollToDetail = () => {
    const aside = document.querySelector('aside')
    aside.scrollTo({ top: document.getElementById('detail-h').offsetTop - 12, behavior: 'smooth' })
  }

  function showDetail(id) {
    const d = document.getElementById('detail')
    const h = document.getElementById('detail-h')
    if (!id) { h.textContent = 'Модуль'; d.innerHTML = '<span class="muted">Кликните модуль на карте.</span>'; return }
    const n = byId.get(id)
    const callers = edges.filter(e => e.to === id)
    const deps = edges.filter(e => e.from === id)
    const inFlows = flows.filter(f => f.steps.some(s => s.node === id))
    h.textContent = 'Модуль'
    const chip = (e, dir) => '<span class="chip" data-goto="' + (dir === 'in' ? e.from : e.to) + '">' +
      (dir === 'in' ? byId.get(e.from).name : byId.get(e.to).name) + ' · ' + e.type + '</span>'
    d.innerHTML =
      '<div class="title">' + n.name + '</div>' +
      '<div class="path">' + (n.path || '(внешняя система, файлов в репозитории нет)') + '</div>' +
      '<div>' + n.role + '</div>' +
      (changed.has(n.id) ? '<div style="color:var(--accent);margin-top:6px">● изменился с прошлой генерации карты</div>' : '') +
      '<section><b>Кто зовёт (' + callers.length + ')</b>' + (callers.length ? callers.map(e => chip(e, 'in')).join('') : '<span class="muted">никто — это вход в систему</span>') + '</section>' +
      '<section><b>На что опирается (' + deps.length + ')</b>' + (deps.length ? deps.map(e => chip(e, 'out')).join('') : '<span class="muted">ни на что — это лист</span>') + '</section>' +
      '<section><b>Тесты</b>' + (n.tests && n.tests.length ? list(n.tests, 'mono') : '<span class="unknown">нет прямых тестов</span>') + '</section>' +
      '<section><b>Файлы (' + (n.files || []).length + ')</b>' + list(n.files, 'mono') + '</section>' +
      '<section><b>Точки входа</b>' + list(n.entrypoints, 'mono') + '</section>' +
      '<section><b>Инварианты</b>' + list(n.constraints) + '</section>' +
      '<section><b>Потоки</b>' + (inFlows.length ? inFlows.map(f => '<span class="chip" data-flow="' + f.id + '">' + f.name + '</span>').join('') : '<span class="muted">—</span>') + '</section>' +
      '<section><b>Доказательства</b>' + list((n.evidence || []).map(e => e.path + ' :: ' + e.symbol), 'mono') + '</section>'
    d.querySelectorAll('[data-goto]').forEach(c => c.onclick = () => select(c.dataset.goto))
    d.querySelectorAll('[data-flow]').forEach(c => c.onclick = () => { activeFlow = c.dataset.flow; selected = null; render(); showFlow() })
  }

  function showFlow() {
    const f = flows.find(x => x.id === activeFlow)
    const d = document.getElementById('detail')
    const h = document.getElementById('detail-h')
    if (!f) { showDetail(selected); return }
    h.textContent = 'Поток'
    d.innerHTML =
      '<div class="title">' + f.name + '</div>' +
      '<section><b>Триггер</b>' + f.trigger + '</section>' +
      '<section><b>Шаги</b><ul>' + f.steps.map((s, i) =>
        '<li><b>' + (i + 1) + '. ' + byId.get(s.node).name + '</b><br>' + s.action +
        (s.evidence ? '<br><code>' + s.evidence.path + ' :: ' + String(s.evidence.symbol).replace(/</g, '&lt;') + '</code>' : '<br><span class="unknown">unknown</span>') + '</li>'
      ).join('') + '</ul></section>' +
      '<section><b>Итог</b>' + f.outcome + '</section>'
  }

  function select(id) {
    selected = id
    if (id) activeFlow = null
    render()
    if (activeFlow) showFlow(); else showDetail(id)
    scrollToDetail()
  }

  render()
})()
</script>
</body>
</html>
`
}
