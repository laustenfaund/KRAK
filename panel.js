"use strict";
/* ---------- panels: the drawing engine ---------- */
/* A panel is its own small project: a shape (aspect ratio) and 1–4 layers in that shape.
   Everything is stored in panel units: the long side is PANEL_LONG units.
   Layers are listed bottom first (index 0 is the bottom). A layer holds strokes and pictures, in drawing order.
   This file loads before app.js and only uses app.js names inside functions. */
const PANEL_LONG = 2400, MAX_LAYERS = 4, ROUGH_INK = "#5FA8D3";
const SHAPES = [
  { id: "square", name: "Square", w: 1, h: 1 },
  { id: "4x3", name: "Landscape", w: 4, h: 3 },
  { id: "3x4", name: "Portrait", w: 3, h: 4 },
  { id: "16x9", name: "Wide", w: 16, h: 9 },
  { id: "2x1", name: "Panorama", w: 2, h: 1 },
  { id: "1x2", name: "Tall", w: 1, h: 2 },
  { id: "3x1", name: "Strip", w: 3, h: 1 },
  { id: "custom", name: "Custom", w: 5, h: 4 },
];
const unitsFor = (rw, rh) => rw >= rh ? { w: PANEL_LONG, h: Math.round(PANEL_LONG * rh / rw) } : { w: Math.round(PANEL_LONG * rw / rh), h: PANEL_LONG };
const ratioLabel = pn => `${+pn.ratio[0].toFixed(2)} : ${+pn.ratio[1].toFixed(2)}`;
const newLayer = n => ({ id: uid(), name: "Layer " + n, visible: true, opacity: 1, rough: false, items: [] });
const panelKey = id => "panel:" + id;
const loadPanel = id => DB.get("kv", panelKey(id));
const savePanel = pn => DB.put("kv", panelKey(pn.id), pn);
async function deletePanelData(id) {
  const pn = await loadPanel(id);
  if (pn) for (const l of pn.layers) for (const it of l.items) if (it.t === "img") await DB.del("blobs", "img:" + it.id);
  await DB.del("blobs", "pthumb:" + id); await DB.del("kv", panelKey(id));
}
/* Tool settings carry over from panel to panel. */
const PT = { tool: "pen", size: { pen: 8, eraser: 40 }, ink: "ink", smooth: 3, snap: false };
const penWidth = (st, pr) => st.s * (st.e ? 0.6 + 0.4 * pr : 0.25 + 0.95 * pr);

/* Keep PNG/WebP/GIF as PNG (line art often has transparency); photos as JPEG. */
async function shrinkPicture(file, max) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (sc === 1 && /^image\/(png|jpeg)$/.test(file.type)) return file;
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return file.type === "image/jpeg" ? canvasBlob(c, "image/jpeg", 0.9) : canvasBlob(c, "image/png");
}

/* ---------- panel list and new-panel dialog (on the project page) ---------- */
function panelsSection(p) {
  const ids = p.panels || [];
  return h("div", { class: "card", style: "cursor:default; padding:14px 16px" },
    h("div", { class: "row between" }, h("h3", null, "Panels"), h("button", { class: "btn small primary", onclick: () => newPanelDialog(p) }, "New panel")),
    h("p", { class: "small muted", style: "margin:6px 0 12px" }, "Each panel has its own shape and up to 4 layers."),
    ids.length ? h("div", { class: "grid" }, ids.map(id => panelCard(p, id))) : h("div", { class: "empty" }, "No panels yet."));
}
function panelCard(p, id) {
  const thumb = h("div", { class: "thumb", "data-pthumb": id }), name = h("div", { class: "t" }, "…"), shape = h("div", null);
  loadPanel(id).then(pn => { if (pn) { name.textContent = pn.name; shape.textContent = ratioLabel(pn); } else name.textContent = "Missing panel"; });
  DB.get("blobs", "pthumb:" + id).then(b => { if (b) thumb.replaceChildren(h("img", { src: screenUrl(b), alt: "" })); });
  return h("button", { class: "card", onclick: () => go(`#k/${p.id}/${id}`) }, thumb, h("div", { class: "meta" }, name, shape));
}
function newPanelDialog(p) {
  const dlg = $("#dlg");
  let shape = SHAPES[0];
  const n = (p.panels || []).length + 1;
  const name = h("input", { class: "field", id: "pnName", placeholder: "Panel " + n, maxLength: 60 });
  const cw = h("input", { class: "field", type: "number", min: "0.1", max: "100", step: "0.1", value: "5", "aria-label": "Width" });
  const chh = h("input", { class: "field", type: "number", min: "0.1", max: "100", step: "0.1", value: "4", "aria-label": "Height" });
  const customRow = h("div", { class: "row" }, h("div", { style: "flex:1" }, h("label", { class: "lbl" }, "Width"), cw), h("div", { style: "flex:1" }, h("label", { class: "lbl" }, "Height"), chh));
  const shapes = h("div", { class: "sizes", role: "radiogroup", "aria-label": "Panel shape" });
  function drawShapes() {
    shapes.replaceChildren(SHAPES.map(s => h("button", { type: "button", class: "size" + (shape.id === s.id ? " on" : ""), role: "radio", "aria-checked": String(shape.id === s.id),
      onclick: () => { shape = s; drawShapes(); } }, h("b", null, s.name), h("span", null, s.id === "custom" ? "Any ratio" : `${s.w} : ${s.h}`))));
    customRow.hidden = shape.id !== "custom";
  }
  drawShapes();
  const submit = async () => {
    let rw = shape.w, rh = shape.h;
    if (shape.id === "custom") {
      rw = parseFloat(cw.value); rh = parseFloat(chh.value);
      if (!(rw > 0 && rh > 0 && rw / rh <= 10 && rh / rw <= 10)) { toast("Use two numbers above 0; the long side can be up to 10 × the short side."); return; }
    }
    const u = unitsFor(rw, rh), now = Date.now(), first = newLayer(1);
    const pn = { id: uid(), projectId: p.id, name: name.value.trim() || "Panel " + n, ratio: [rw, rh], w: u.w, h: u.h, created: now, updated: now,
      layers: [first], active: first.id, persp: { mode: 0, hy: Math.round(u.h / 2), vps: [] } };
    try {
      await savePanel(pn);
      p.panels = [...(p.panels || []), pn.id]; p.updated = now; await saveProjects();
    } catch (e) { toast("Couldn't create the panel. Try again."); return; }
    dlg.close(); go(`#k/${p.id}/${pn.id}`);
  };
  dlg.onclose = null;
  dlg.replaceChildren(h("form", { class: "dlg", method: "dialog", onsubmit: e => { e.preventDefault(); submit(); } },
    h("h2", null, "New panel"),
    h("div", null, h("label", { class: "lbl", for: "pnName" }, "Name"), name),
    h("div", null, h("label", { class: "lbl" }, "Shape"), shapes),
    customRow,
    h("p", { class: "small muted", style: "margin:0" }, "The shape is fixed once the panel is made."),
    h("div", { class: "row end" }, h("button", { type: "button", class: "btn ghost", onclick: () => dlg.close() }, "Cancel"),
      h("button", { type: "submit", class: "btn primary" }, "Create"))));
  dlg.showModal(); name.focus();
}

/* ---------- panel editor ---------- */
function viewPanel() {
  const p = S.projects.find(x => x.id === S.projectId);
  const sec = h("section", { class: "ped", "aria-label": "Panel" }, h("div", { class: "empty" }, "Opening panel…"));
  if (!p) { sec.replaceChildren(h("div", { class: "empty" }, "That project isn't on this device.")); return sec; }
  let alive = true, cleanup = null;
  screenCleanup = () => { alive = false; if (cleanup) cleanup(); };
  loadPanel(S.panelId).then(pn => {
    if (!alive) return;
    if (!pn) sec.replaceChildren(h("div", { class: "empty" }, "That panel isn't on this device. ", h("button", { class: "btn small", onclick: () => go("#p/" + p.id) }, "Back to project")));
    else cleanup = panelEditor(sec, p, pn);
  }).catch(() => sec.replaceChildren(h("div", { class: "empty" }, "That panel couldn't be opened.")));
  return sec;
}

function panelEditor(sec, p, pn) {
  const layerC = new Map();        // layer id -> canvas in panel units
  const imgs = new Map();          // picture id -> ImageBitmap, or "loading"
  const touched = new Set();       // every picture seen this visit, for clean-up on close
  const toPaint = new Set();       // layers to repaint on the next frame
  let undo = [], redo = [];
  let view = { s: 1, ox: 0, oy: 0 }, fitS = 1, dpr = 1, sw = 0, sh = 0, fitted = false;
  let dirty = true, raf = 0, saveT = 0, deleted = false;
  let act = null, sel = null, hover = null, spaceDown = false;
  const touches = new Map();
  for (const l of pn.layers) for (const it of l.items) if (it.t === "img") touched.add(it.id);

  const cv = h("canvas", { class: "pcv", tabindex: "0", role: "img", "aria-label": "Panel: " + pn.name });
  const stage = h("div", { class: "pstage" }, cv);
  const tools = h("div", { class: "ptools", role: "toolbar", "aria-label": "Drawing tools" });
  const layersBox = h("div", { class: "players", "aria-label": "Layers" });
  const title = h("h2", { style: "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" }, pn.name);

  const activeLayer = () => pn.layers.find(l => l.id === pn.active) || pn.layers[pn.layers.length - 1];
  const kick = () => { dirty = true; if (!raf) raf = requestAnimationFrame(frame); };
  const scr = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toU = sp => [(sp[0] - view.ox) / view.s, (sp[1] - view.oy) / view.s];
  const toS = u => [view.ox + u[0] * view.s, view.oy + u[1] * view.s];
  const pres = e => e.pointerType === "pen" && e.pressure ? e.pressure : 0.5;

  /* ----- layer canvases ----- */
  function layerCanvas(l) {
    let c = layerC.get(l.id);
    if (!c) { c = document.createElement("canvas"); c.width = pn.w; c.height = pn.h; layerC.set(l.id, c); }
    return c;
  }
  function seg(ctx, l, st, a, b) {
    ctx.globalCompositeOperation = st.e ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = l.rough ? ROUGH_INK : st.c; ctx.lineCap = ctx.lineJoin = "round";
    if (!a) { ctx.beginPath(); ctx.arc(b[0], b[1], penWidth(st, b[2]) / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.lineWidth = penWidth(st, (a[2] + b[2]) / 2);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function drawStroke(ctx, l, st) { st.p.forEach((q, i) => seg(ctx, l, st, i ? st.p[i - 1] : null, q)); ctx.globalCompositeOperation = "source-over"; }
  function drawPicture(ctx, it, bmp) {
    ctx.globalCompositeOperation = "source-over";
    ctx.save(); ctx.translate(it.cx, it.cy); ctx.rotate(it.r); ctx.drawImage(bmp, -it.w / 2, -it.h / 2, it.w, it.h); ctx.restore();
  }
  function paintLayer(l) {
    const c = layerCanvas(l), ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "source-over"; ctx.clearRect(0, 0, c.width, c.height);
    for (const it of l.items) {
      if (it.t !== "img") { drawStroke(ctx, l, it); continue; }
      const b = imgs.get(it.id);
      if (b && b !== "loading") drawPicture(ctx, it, b); else loadPicture(it.id);
    }
    kick();
  }
  const paintAll = () => pn.layers.forEach(paintLayer);
  function loadPicture(id) {
    if (imgs.has(id)) return;
    imgs.set(id, "loading");
    DB.get("blobs", "img:" + id).then(b => b ? createImageBitmap(b) : null).then(bmp => {
      if (!bmp) return;
      imgs.set(id, bmp);
      for (const l of pn.layers) if (l.items.some(x => x.id === id)) toPaint.add(l);
      kick();
    }).catch(() => {});
  }

  /* ----- drawing the view ----- */
  function frame() {
    raf = 0;
    if (toPaint.size) { const ls = [...toPaint]; toPaint.clear(); ls.forEach(paintLayer); }
    if (!dirty) return;
    dirty = false;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, sw, sh);
    ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, pn.w, pn.h);
    ctx.beginPath(); ctx.rect(0, 0, pn.w, pn.h); ctx.clip();
    ctx.imageSmoothingQuality = "high";
    for (const l of pn.layers) if (l.visible) { ctx.globalAlpha = l.opacity; ctx.drawImage(layerCanvas(l), 0, 0); }
    ctx.globalAlpha = 1;
    if (act && act.kind === "draw" && act.snap && act.st.p.length) {
      const st = act.st, pv = { ...st, c: st.e ? "rgba(120,120,120,.5)" : st.c, e: undefined };
      drawStroke(ctx, act.l.rough && !st.e ? act.l : { rough: false }, pv);
    }
    if (pn.persp.mode) drawGuides(ctx);
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#1A1714"; ctx.strokeRect(view.ox, view.oy, pn.w * view.s, pn.h * view.s);
    if (PT.tool === "guides" && pn.persp.mode) drawGuideHandles(ctx);
    if (PT.tool === "move" && sel) drawSelection(ctx);
    if (hover && (PT.tool === "pen" || PT.tool === "eraser") && !spaceDown && (!act || act.kind === "draw")) {
      const r = Math.max(1.5, (PT.tool === "eraser" ? PT.size.eraser : PT.size.pen * 0.85) / 2 * view.s);
      ctx.beginPath(); ctx.arc(hover[0], hover[1], r, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = "#1A1714"; ctx.stroke();
    }
  }

  /* ----- perspective guides ----- */
  const RAYS = 36;
  function defaultVps(mode) {
    const hy = pn.persp.hy, d = [[pn.w / 2, hy]];
    if (mode >= 2) { d[0] = [-0.3 * pn.w, hy]; d[1] = [1.3 * pn.w, hy]; }
    if (mode >= 3) d[2] = [pn.w / 2, 2.2 * pn.h];
    return d;
  }
  function setPersp(mode) {
    pushUndo();
    const old = pn.persp.vps, d = defaultVps(mode);
    if (old.length === mode) for (let i = 0; i < mode; i++) d[i] = old[i];
    pn.persp.mode = mode; pn.persp.vps = mode ? d : [];
    if (mode && PT.tool !== "guides") PT.tool = "guides";
    drawTools(); changed();
  }
  function drawGuides(ctx) {
    const { mode, vps, hy } = pn.persp, far = PANEL_LONG * 6;
    ctx.lineWidth = 1.2 / view.s; ctx.strokeStyle = "rgba(200,50,30,.28)";
    ctx.beginPath();
    for (const v of vps.slice(0, mode)) for (let i = 0; i < RAYS; i++) {
      const a = i / RAYS * Math.PI * 2; ctx.moveTo(v[0], v[1]); ctx.lineTo(v[0] + Math.cos(a) * far, v[1] + Math.sin(a) * far);
    }
    ctx.stroke();
    ctx.lineWidth = 2 / view.s; ctx.strokeStyle = "rgba(200,50,30,.6)";
    ctx.beginPath(); ctx.moveTo(-far, hy); ctx.lineTo(far, hy); ctx.stroke();
  }
  function drawGuideHandles(ctx) {
    pn.persp.vps.slice(0, pn.persp.mode).forEach((v, i) => {
      const s = toS(v);
      ctx.beginPath(); ctx.arc(s[0], s[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = "#C8321E"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#FFFFFF"; ctx.stroke();
      ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(i + 1), s[0], s[1] + 0.5);
    });
  }
  function guideHit(sp) {
    const vps = pn.persp.vps.slice(0, pn.persp.mode);
    for (let i = vps.length - 1; i >= 0; i--) { const s = toS(vps[i]); if (Math.hypot(s[0] - sp[0], s[1] - sp[1]) < 14) return { vp: i }; }
    if (Math.abs(toS([0, pn.persp.hy])[1] - sp[1]) < 8) return { hz: true };
    return null;
  }
  /* Directions a snapped line may take from its start point. */
  function snapDirs(at) {
    const m = pn.persp.mode, d = [];
    for (const v of pn.persp.vps.slice(0, m)) { const dx = v[0] - at[0], dy = v[1] - at[1], L = Math.hypot(dx, dy); if (L > 1) d.push([dx / L, dy / L]); }
    if (m <= 1) d.push([1, 0]);
    if (m <= 2) d.push([0, 1]);
    return d;
  }

  /* ----- pictures: selection and handles ----- */
  const selItem = () => sel && activeLayer().items.find(x => x.id === sel && x.t === "img");
  function corners(it) {
    const c = Math.cos(it.r), s = Math.sin(it.r), hw = it.w / 2, hh = it.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => toS([it.cx + x * c - y * s, it.cy + x * s + y * c]));
  }
  function rotHandle(it) {
    const k = corners(it), mid = [(k[0][0] + k[1][0]) / 2, (k[0][1] + k[1][1]) / 2];
    return [mid[0] + Math.sin(it.r) * 28, mid[1] - Math.cos(it.r) * 28];
  }
  function inside(it, u) {
    const dx = u[0] - it.cx, dy = u[1] - it.cy, c = Math.cos(-it.r), s = Math.sin(-it.r);
    return Math.abs(dx * c - dy * s) <= it.w / 2 && Math.abs(dx * s + dy * c) <= it.h / 2;
  }
  function drawSelection(ctx) {
    const it = selItem(); if (!it) return;
    const k = corners(it), rh = rotHandle(it), top = [(k[0][0] + k[1][0]) / 2, (k[0][1] + k[1][1]) / 2];
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#C8321E"; ctx.setLineDash([6, 4]);
    ctx.beginPath(); k.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(rh[0], rh[1]); ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    for (const q of k) { ctx.fillRect(q[0] - 6, q[1] - 6, 12, 12); ctx.strokeRect(q[0] - 6, q[1] - 6, 12, 12); }
    ctx.beginPath(); ctx.arc(rh[0], rh[1], 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function grab(l, it, kind, sp, u, id) {
    pushUndo();
    const c = { ...it }; l.items[l.items.indexOf(it)] = c;
    const cs = toS([it.cx, it.cy]);
    act = { kind, id, l, it: c, o: { ...it }, u0: u, sp0: sp, cs, a0: Math.atan2(sp[1] - cs[1], sp[0] - cs[0]), d0: Math.hypot(sp[0] - cs[0], sp[1] - cs[1]) || 1 };
  }

  /* ----- strokes ----- */
  function put(a, q) {
    q = [+q[0].toFixed(1), +q[1].toFixed(1), +q[2].toFixed(2)];
    const src = a.snap ? a.raw : a.st.p, last = src[src.length - 1];
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.8) return;
    if (a.snap) { a.raw.push(q); resnap(a); kick(); return; }
    a.st.p.push(q); seg(layerCanvas(a.l).getContext("2d"), a.l, a.st, last || null, q); kick();
  }
  function feed(a, u, pr) {
    const f = 1 - PT.smooth * 0.088;
    a.sm[0] += (u[0] - a.sm[0]) * f; a.sm[1] += (u[1] - a.sm[1]) * f;
    a.lastRaw = u; a.lastPr = pr;
    put(a, [a.sm[0], a.sm[1], pr]);
  }
  function resnap(a) {
    const r = a.raw, s = r[0], last = r[r.length - 1];
    if (!a.dir) {
      const dx = last[0] - s[0], dy = last[1] - s[1], L = Math.hypot(dx, dy);
      if (L * view.s < 12) { a.st.p = r.slice(); return; }
      let bv = -1;
      for (const d of snapDirs(s)) { const v = Math.abs(dx * d[0] + dy * d[1]) / L; if (v > bv) { bv = v; a.dir = d; } }
    }
    const d = a.dir;
    a.st.p = r.map(q => { const t = (q[0] - s[0]) * d[0] + (q[1] - s[1]) * d[1]; return [+(s[0] + d[0] * t).toFixed(1), +(s[1] + d[1] * t).toFixed(1), q[2]]; });
  }
  function startStroke(e, u, eraser) {
    const l = activeLayer();
    if (!l.visible) { toast("This layer is hidden. Show it to draw on it."); return false; }
    pushUndo();
    const ink = INKS.find(i => i.id === PT.ink) || INKS[0];
    act = { kind: "draw", id: e.pointerId, l, sm: u.slice(), raw: [], dir: null, snap: PT.snap && !eraser,
      st: { t: "s", c: ink.color, s: eraser ? PT.size.eraser : PT.size.pen, e: eraser || undefined, p: [] } };
    feed(act, u, pres(e));
    return true;
  }
  function endStroke(a) {
    if (PT.smooth && a.lastRaw) for (let i = 1; i <= 4; i++) {
      const t = i / 4; put(a, [a.sm[0] + (a.lastRaw[0] - a.sm[0]) * t, a.sm[1] + (a.lastRaw[1] - a.sm[1]) * t, a.lastPr]);
    }
    if (a.snap) drawStroke(layerCanvas(a.l).getContext("2d"), a.l, a.st);
    if (a.st.p.length) { a.l.items.push(a.st); changed(); } else { undo.pop(); syncBtns(); }
  }

  /* ----- view: fit, zoom, pan ----- */
  function fit() {
    fitS = Math.min((sw - 32) / pn.w, (sh - 32) / pn.h);
    view = { s: fitS, ox: (sw - pn.w * fitS) / 2, oy: (sh - pn.h * fitS) / 2 }; kick();
  }
  function zoomAt(sp, f) {
    const s = clamp(view.s * f, fitS * 0.15, fitS * 8); f = s / view.s;
    view.ox = sp[0] - (sp[0] - view.ox) * f; view.oy = sp[1] - (sp[1] - view.oy) * f; view.s = s; kick();
  }
  const resizeObs = new ResizeObserver(() => {
    const w = stage.clientWidth, hh = stage.clientHeight; if (!w || !hh) return;
    const was = [sw, sh]; sw = w; sh = hh; dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(sw * dpr); cv.height = Math.round(sh * dpr);
    if (!fitted) { fitted = true; fit(); }
    else { view.ox += (sw - was[0]) / 2; view.oy += (sh - was[1]) / 2; fitS = Math.min((sw - 32) / pn.w, (sh - 32) / pn.h); kick(); }
  });

  /* ----- pointer input: pen and mouse draw; fingers only pan and zoom ----- */
  cv.addEventListener("pointerdown", e => {
    cv.focus({ preventScroll: true });
    if (e.pointerType === "touch") { touches.set(e.pointerId, [e.clientX, e.clientY]); cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (act) return;
    const sp = scr(e), u = toU(sp);
    const eraserEnd = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32));
    if (e.button === 1 || (spaceDown && !eraserEnd)) act = { kind: "pan", id: e.pointerId, last: sp };
    else if (e.button !== 0 && !eraserEnd) return;
    else if (eraserEnd || PT.tool === "pen" || PT.tool === "eraser") { if (!startStroke(e, u, eraserEnd || PT.tool === "eraser")) return; }
    else if (PT.tool === "guides") {
      const g = pn.persp.mode && guideHit(sp); if (!g) return;
      pushUndo(); act = { kind: "guide", id: e.pointerId, g };
    } else if (PT.tool === "move") {
      const l = activeLayer(), cur = selItem();
      if (cur) {
        const k = corners(cur), rh = rotHandle(cur);
        if (Math.hypot(rh[0] - sp[0], rh[1] - sp[1]) < 12) grab(l, cur, "rotate", sp, u, e.pointerId);
        else if (k.some(q => Math.abs(q[0] - sp[0]) < 10 && Math.abs(q[1] - sp[1]) < 10)) grab(l, cur, "scale", sp, u, e.pointerId);
      }
      if (!act) {
        const hit = [...l.items].reverse().find(x => x.t === "img" && inside(x, u));
        sel = hit ? hit.id : null; drawTools();
        if (hit) grab(l, hit, "move", sp, u, e.pointerId);
      }
      kick();
      if (!act) return;
    }
    cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") { touchMove(e); return; }
    const sp = scr(e);
    hover = sp;
    if (!act) { if (PT.tool === "pen" || PT.tool === "eraser") kick(); return; }
    if (e.pointerId !== act.id) return;
    if (act.kind === "draw") { for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) feed(act, toU(scr(ev)), pres(ev)); return; }
    if (act.kind === "pan") { view.ox += sp[0] - act.last[0]; view.oy += sp[1] - act.last[1]; act.last = sp; kick(); return; }
    if (act.kind === "guide") {
      const u = toU(sp), lim = (v, n) => clamp(v, -3 * n, 4 * n), ps = pn.persp;
      if (act.g.hz || act.g.vp < 2) {
        const y = lim(u[1], pn.h); ps.hy = y; ps.vps.forEach((v, i) => { if (i < 2) v[1] = y; });
        if (act.g.vp != null) ps.vps[act.g.vp][0] = lim(u[0], pn.w);
      } else ps.vps[2] = [lim(u[0], pn.w), lim(u[1], pn.h)];
      kick(); return;
    }
    const it = act.it, o = act.o;
    if (act.kind === "move") { const u = toU(sp); it.cx = o.cx + u[0] - act.u0[0]; it.cy = o.cy + u[1] - act.u0[1]; }
    else if (act.kind === "scale") { const f = Math.hypot(sp[0] - act.cs[0], sp[1] - act.cs[1]) / act.d0; it.w = Math.max(20, o.w * f); it.h = o.h * it.w / o.w; }
    else if (act.kind === "rotate") it.r = o.r + Math.atan2(sp[1] - act.cs[1], sp[0] - act.cs[0]) - act.a0;
    toPaint.add(act.l); kick();
  });
  const endPointer = e => {
    if (e.pointerType === "touch") { touches.delete(e.pointerId); return; }
    if (!act || e.pointerId !== act.id) return;
    const a = act; act = null;
    if (a.kind === "draw") endStroke(a);
    else if (a.kind !== "pan") changed();
    kick();
  };
  cv.addEventListener("pointerup", endPointer);
  cv.addEventListener("pointercancel", endPointer);
  cv.addEventListener("pointerleave", e => { if (e.pointerType !== "touch" && !act) { hover = null; kick(); } });
  function touchMove(e) {
    const prev = touches.get(e.pointerId); if (!prev) return;
    const others = [...touches.entries()].filter(([id]) => id !== e.pointerId).map(([, v]) => v);
    const now = [e.clientX, e.clientY]; touches.set(e.pointerId, now);
    if (!others.length) { view.ox += now[0] - prev[0]; view.oy += now[1] - prev[1]; kick(); return; }
    const o = others[0], r = cv.getBoundingClientRect();
    const c0 = [(prev[0] + o[0]) / 2, (prev[1] + o[1]) / 2], c1 = [(now[0] + o[0]) / 2, (now[1] + o[1]) / 2];
    const d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]) || 1, d1 = Math.hypot(now[0] - o[0], now[1] - o[1]);
    view.ox += c1[0] - c0[0]; view.oy += c1[1] - c0[1];
    zoomAt([c1[0] - r.left, c1[1] - r.top], d1 / d0);
  }
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    if (e.ctrlKey) zoomAt(scr(e), Math.exp(-e.deltaY * 0.01));   // trackpad pinch arrives as ctrl + wheel
    else { view.ox -= e.deltaX; view.oy -= e.deltaY; kick(); }
  }, { passive: false });

  /* ----- keyboard shortcuts ----- */
  const center = () => [sw / 2, sh / 2];
  function onKey(e) {
    if ($("#dlg").open || (e.target.closest && e.target.closest("input, textarea, select"))) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (mod && k === "y") { e.preventDefault(); doRedo(); }
    else if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(center(), 1.25); }
    else if (mod && k === "-") { e.preventDefault(); zoomAt(center(), 0.8); }
    else if (mod && k === "0") { e.preventDefault(); fit(); }
    else if (mod || e.altKey) return;
    else if (k === " ") { e.preventDefault(); if (!spaceDown) { spaceDown = true; cv.style.cursor = "grab"; kick(); } }
    else if (k === "b" || k === "p") setTool("pen");
    else if (k === "e") setTool(PT.tool === "eraser" ? "pen" : "eraser");
    else if (k === "v") setTool("move");
    else if (k === "g") setTool("guides");
    else if (k === "s") { PT.snap = !PT.snap; drawTools(); toast(PT.snap ? "Snap on" : "Snap off"); }
    else if (k === "[" || k === "]") { const t = PT.tool === "eraser" ? "eraser" : "pen"; PT.size[t] = clamp(Math.round(PT.size[t] * (k === "]" ? 1.25 : 0.8)) || 1, 1, 200); drawTools(); kick(); }
    else if ((k === "delete" || k === "backspace") && PT.tool === "move" && selItem()) { e.preventDefault(); deleteSelected(); }
    else if (k === "?") shortcutsDialog();
  }
  function onKeyUp(e) { if (e.key === " ") { spaceDown = false; cv.style.cursor = ""; kick(); } }
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);

  /* ----- undo / redo: snapshots of the layer list (items are never changed in place) ----- */
  const snap = () => ({ layers: pn.layers.map(l => ({ ...l, items: l.items.slice() })), active: pn.active, persp: JSON.parse(JSON.stringify(pn.persp)) });
  function pushUndo() { undo.push(snap()); if (undo.length > 100) undo.shift(); redo = []; syncBtns(); }
  function restore(s) {
    pn.layers = s.layers.map(l => ({ ...l, items: l.items.slice() })); pn.active = s.active; pn.persp = JSON.parse(JSON.stringify(s.persp));
    if (!selItem()) sel = null;
    paintAll(); drawLayers(); drawTools(); changed();
  }
  function doUndo() { if (act || !undo.length) return; redo.push(snap()); restore(undo.pop()); }
  function doRedo() { if (act || !redo.length) return; undo.push(snap()); restore(redo.pop()); }

  /* ----- saving ----- */
  function changed() { syncBtns(); kick(); clearTimeout(saveT); saveT = setTimeout(flush, 700); }
  async function flush() {
    clearTimeout(saveT); if (deleted) return;
    pn.updated = Date.now();
    try { await savePanel(pn); } catch (e) { toast("Couldn't save the panel."); }
  }
  async function saveThumb() {
    const sc = Math.min(1, 480 / Math.max(pn.w, pn.h)), c = document.createElement("canvas");
    c.width = Math.round(pn.w * sc); c.height = Math.round(pn.h * sc);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, c.width, c.height);
    for (const l of pn.layers) if (l.visible) { ctx.globalAlpha = l.opacity; ctx.drawImage(layerCanvas(l), 0, 0, c.width, c.height); }
    const b = await canvasBlob(c, "image/jpeg", 0.85);
    await DB.put("blobs", "pthumb:" + pn.id, b);
    /* The project page may already be showing; give its card the new picture. */
    const slot = document.querySelector(`[data-pthumb="${pn.id}"]`);
    if (slot) slot.replaceChildren(h("img", { src: screenUrl(b), alt: "" }));
  }

  /* ----- tools ----- */
  function setTool(t) { PT.tool = t; if (t !== "move") sel = null; drawTools(); kick(); }
  function deleteSelected() {
    const l = activeLayer(); pushUndo();
    l.items = l.items.filter(x => x.id !== sel); sel = null; paintLayer(l); drawTools(); changed();
  }
  const undoB = h("button", { class: "btn small", title: "Undo (Ctrl+Z)", onclick: doUndo }, "Undo");
  const redoB = h("button", { class: "btn small", title: "Redo (Ctrl+Shift+Z)", onclick: doRedo }, "Redo");
  function syncBtns() { undoB.disabled = !undo.length; redoB.disabled = !redo.length; }
  const picIn = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
    const f = picIn.files[0]; picIn.value = ""; if (!f) return;
    const l = activeLayer();
    if (!l.visible) { toast("This layer is hidden. Show it to add a picture."); return; }
    try {
      const blob = await shrinkPicture(f, PANEL_LONG), bmp = await createImageBitmap(blob), id = uid();
      await DB.put("blobs", "img:" + id, blob);
      imgs.set(id, bmp); touched.add(id);
      const sc = Math.min(pn.w * 0.8 / bmp.width, pn.h * 0.8 / bmp.height);
      pushUndo();
      l.items.push({ t: "img", id, cx: pn.w / 2, cy: pn.h / 2, w: Math.round(bmp.width * sc), h: Math.round(bmp.height * sc), r: 0 });
      paintLayer(l); PT.tool = "move"; sel = id; drawTools(); changed();
    } catch (e) { toast("That picture couldn't be opened."); }
  } });
  function drawTools() {
    const tb = (id, label, key) => h("button", { class: "btn small" + (PT.tool === id ? " on" : ""), "aria-pressed": String(PT.tool === id), title: `${label} (${key})`, onclick: () => setTool(id) }, label);
    const sizeT = PT.tool === "eraser" ? "eraser" : "pen";
    const sizeIn = h("input", { type: "range", min: "1", max: "200", value: PT.size[sizeT], "aria-label": "Size",
      oninput: () => { PT.size[sizeT] = +sizeIn.value; sizeOut.textContent = sizeIn.value; kick(); } });
    const sizeOut = h("span", { class: "num" }, PT.size[sizeT]);
    const smoothIn = h("input", { type: "range", min: "0", max: "10", value: PT.smooth, "aria-label": "Line smoothing",
      oninput: () => { PT.smooth = +smoothIn.value; smoothOut.textContent = smoothIn.value; } });
    const smoothOut = h("span", { class: "num" }, PT.smooth);
    tools.replaceChildren(
      tb("pen", "Pen", "B"), tb("eraser", "Eraser", "E"), tb("move", "Move", "V"), tb("guides", "Guides", "G"),
      h("span", { class: "sep" }),
      (PT.tool === "pen" || PT.tool === "eraser") ? [
        h("label", { class: "inl" }, PT.tool === "eraser" ? "Eraser size" : "Pen size", sizeIn, sizeOut),
        PT.tool === "pen" ? INKS.map(i => h("button", { class: "swatch" + (PT.ink === i.id ? " on" : ""), style: `background:${i.color}`, title: i.label, "aria-label": i.label, "aria-pressed": String(PT.ink === i.id),
          onclick: () => { PT.ink = i.id; drawTools(); } })) : null,
        h("label", { class: "inl" }, "Smoothing", smoothIn, smoothOut),
        h("button", { class: "btn small" + (PT.snap ? " on" : ""), "aria-pressed": String(PT.snap), title: "Snap lines to guides, or to horizontal and vertical (S)", onclick: () => { PT.snap = !PT.snap; drawTools(); } }, "Snap"),
      ] : null,
      PT.tool === "move" ? [
        h("button", { class: "btn small", onclick: () => picIn.click() }, "Add picture"),
        selItem() ? h("button", { class: "btn small danger", onclick: deleteSelected }, "Delete picture") : h("span", { class: "small muted" }, "Pictures on the selected layer can be moved, resized and turned."),
      ] : null,
      PT.tool === "guides" ? [
        h("span", { class: "small muted" }, "Perspective"),
        [0, 1, 2, 3].map(m => h("button", { class: "btn small" + (pn.persp.mode === m ? " on" : ""), "aria-pressed": String(pn.persp.mode === m), onclick: () => setPersp(m) }, m ? m + "-point" : "Off")),
        pn.persp.mode ? h("span", { class: "small muted" }, "Drag the numbered points and the horizon line.") : null,
      ] : null,
      h("span", { class: "sep" }), undoB, redoB,
      h("span", { class: "sep" }),
      h("button", { class: "btn small", title: "Zoom out (Ctrl −)", "aria-label": "Zoom out", onclick: () => zoomAt(center(), 0.8) }, "−"),
      h("button", { class: "btn small", title: "Fit (Ctrl 0)", onclick: fit }, "Fit"),
      h("button", { class: "btn small", title: "Zoom in (Ctrl +)", "aria-label": "Zoom in", onclick: () => zoomAt(center(), 1.25) }, "+"),
      h("button", { class: "btn small ghost", title: "Keyboard shortcuts (?)", onclick: shortcutsDialog }, "Keys"),
      picIn);
    cv.style.cursor = spaceDown ? "grab" : PT.tool === "pen" || PT.tool === "eraser" ? "none" : "";
    syncBtns();
  }

  /* ----- layers panel (top layer listed first) ----- */
  function drawLayers() {
    const n = pn.layers.length;
    const row = (l, i) => {
      const on = l.id === pn.active;
      const op = h("input", { type: "range", min: "0", max: "100", value: Math.round(l.opacity * 100), "aria-label": "Opacity of " + l.name,
        onpointerdown: () => pushUndo(), onkeydown: () => pushUndo(),
        oninput: () => { l.opacity = +op.value / 100; opOut.textContent = op.value + "%"; kick(); }, onchange: changed });
      const opOut = h("span", { class: "num" }, Math.round(l.opacity * 100) + "%");
      const edit = fn => () => { pushUndo(); fn(); drawLayers(); changed(); };
      return h("div", { class: "lrow" + (on ? " on" : "") },
        h("div", { class: "top" },
          h("button", { class: "btn small ghost", "aria-pressed": String(l.visible), title: l.visible ? "Hide layer" : "Show layer", onclick: edit(() => { l.visible = !l.visible; kick(); }) }, l.visible ? "Hide" : "Show"),
          h("button", { class: "nm", "aria-current": on ? "true" : null, onclick: () => { pn.active = l.id; sel = null; drawLayers(); drawTools(); kick(); changed(); } }, l.name),
          l.rough ? h("span", { class: "tag", title: "Rough layer: drawn in blue pencil, left out when the panel is flattened" }, "Rough") : null,
          !l.visible ? h("span", { class: "small muted" }, "hidden") : null),
        on ? h("div", { class: "more" },
          h("label", { class: "inl" }, "Opacity", op, opOut),
          h("button", { class: "btn small" + (l.rough ? " on" : ""), "aria-pressed": String(l.rough), title: "Rough layer: drawn in blue pencil, left out when the panel is flattened",
            onclick: edit(() => { l.rough = !l.rough; paintLayer(l); }) }, "Rough"),
          h("button", { class: "btn small", disabled: i === n - 1, title: "Move up", onclick: edit(() => { pn.layers.splice(i, 1); pn.layers.splice(i + 1, 0, l); kick(); }) }, "Up"),
          h("button", { class: "btn small", disabled: i === 0, title: "Move down", onclick: edit(() => { pn.layers.splice(i, 1); pn.layers.splice(i - 1, 0, l); kick(); }) }, "Down"),
          h("button", { class: "btn small", onclick: () => { const nm = prompt("Layer name", l.name); if (nm && nm.trim()) edit(() => { l.name = nm.trim().slice(0, 40); })(); } }, "Rename"),
          h("button", { class: "btn small danger", disabled: n === 1, onclick: () => {
            if (!confirm(`Delete "${l.name}" and everything on it?`)) return;
            edit(() => { pn.layers.splice(i, 1); pn.active = pn.layers[Math.min(i, pn.layers.length - 1)].id; sel = null; drawTools(); kick(); })();
          } }, "Delete")) : null);
    };
    layersBox.replaceChildren(
      h("div", { class: "row between" }, h("h3", null, `Layers ${n}/${MAX_LAYERS}`),
        h("button", { class: "btn small", disabled: n >= MAX_LAYERS, onclick: () => {
          pushUndo();
          const used = new Set(pn.layers.map(l => l.name)); let k = 1; while (used.has("Layer " + k)) k++;
          const l = newLayer(k), at = pn.layers.indexOf(activeLayer()) + 1;
          pn.layers.splice(at, 0, l); pn.active = l.id; sel = null; drawLayers(); drawTools(); changed();
        } }, "Add layer")),
      pn.layers.map((l, i) => row(l, i)).reverse(),
      h("p", { class: "small muted", style: "margin:4px 0 0" }, "Drawing goes on the selected layer. New layers go above it."));
  }

  /* ----- header and layout ----- */
  const back = h("button", { class: "btn ghost small", onclick: () => go("#p/" + p.id) }, "‹ " + p.name);
  const header = h("div", { class: "row", style: "gap:10px" }, back, title, h("span", { class: "small muted" }, ratioLabel(pn)),
    h("button", { class: "btn ghost small", onclick: () => { const nm = prompt("Panel name", pn.name); if (nm && nm.trim()) { pn.name = nm.trim().slice(0, 60); title.textContent = pn.name; changed(); } } }, "Rename"),
    h("button", { class: "btn ghost small danger", onclick: async () => {
      if (!confirm(`Delete "${pn.name}"? This can't be undone.`)) return;
      deleted = true; clearTimeout(saveT);
      await deletePanelData(pn.id);
      p.panels = (p.panels || []).filter(x => x !== pn.id); p.updated = Date.now(); await saveProjects();
      go("#p/" + p.id);
    } }, "Delete"));
  sec.replaceChildren(header, tools, h("div", { class: "pmain" }, stage, layersBox));
  drawTools(); drawLayers(); paintAll();
  resizeObs.observe(stage);

  return () => {
    resizeObs.disconnect(); cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp);
    if (deleted) return;
    const live = new Set(); for (const l of pn.layers) for (const it of l.items) if (it.t === "img") live.add(it.id);
    flush().then(saveThumb).then(async () => {
      for (const id of touched) if (!live.has(id)) await DB.del("blobs", "img:" + id);
      p.updated = Date.now(); await saveProjects();
    }).catch(() => {});
  };
}

function shortcutsDialog() {
  const dlg = $("#dlg");
  const rows = [["B", "Pen"], ["E", "Eraser (press again for pen)"], ["V", "Move pictures"], ["G", "Perspective guides"], ["S", "Snap on / off"],
    ["[  ]", "Smaller / bigger pen or eraser"], ["Ctrl Z", "Undo"], ["Ctrl Shift Z  or  Ctrl Y", "Redo"], ["Space + drag", "Pan"],
    ["Ctrl +  /  Ctrl −", "Zoom in / out"], ["Ctrl 0", "Fit the panel"], ["Delete", "Delete the selected picture"], ["?", "This list"]];
  dlg.onclose = null;
  dlg.replaceChildren(h("div", { class: "dlg" },
    h("div", { class: "row between" }, h("h2", null, "Keyboard shortcuts"), h("button", { class: "btn ghost small", onclick: () => dlg.close() }, "Close")),
    h("table", { class: "keys" }, rows.map(([k, v]) => h("tr", null, h("th", null, k), h("td", null, v)))),
    h("p", { class: "small muted", style: "margin:0" }, "Fingers on the screen pan, and pinch to zoom; they never draw. A pen's eraser end erases. On a trackpad, scroll to pan and pinch to zoom.")));
  dlg.showModal();
}
