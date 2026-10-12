"use strict";
/* ---------- helpers ---------- */
/* Let replaceChildren take lists and skip empty slots (null/false). */
{ const rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...k) { return rc.apply(this, k.flat(Infinity).filter(x => x != null && x !== false)); }; }
const $= (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "for" || k.startsWith("aria-") || k.startsWith("data-") || k === "role") el.setAttribute(k, v === true ? "" : v);
    else if (k in el) { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const fmtTime = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const isWide = () => matchMedia("(min-width: 900px)").matches;
function toast(msg) {
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 1800);
}
const canvasBlob = (c, type = "image/png", q) => new Promise(res => c.toBlob(res, type, q));
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/* ---------- storage (IndexedDB, with in-memory fallback) ---------- */
/* All apps share laustenfaund.github.io, so every name here starts with "krak-". */
const DB = {
  db: null, mem: false, memKV: new Map(), memBlobs: new Map(),
  async open() {
    if (this.db || this.mem) return;
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open("krak-app", 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("kv"); d.createObjectStore("blobs"); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        setTimeout(() => rej(new Error("timeout")), 4000);
      });
    } catch (e) { this.mem = true; }
  },
  _store(name) { return name === "kv" ? this.memKV : this.memBlobs; },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  async get(s, k) { if (this.mem) return this._store(s).get(k); return this.tx(s, "readonly", st => st.get(k)); },
  async put(s, k, v) { if (this.mem) { this._store(s).set(k, v); return; } return this.tx(s, "readwrite", st => st.put(v, k)); },
  async del(s, k) { if (this.mem) { this._store(s).delete(k); return; } return this.tx(s, "readwrite", st => st.delete(k)); },
};

/* ---------- state ---------- */
const S = {
  projects: [],   // {id, name, size:{preset,w,h,unit}, created, updated}
  inbox: [],      // {id, created, updated, text, w, h, strokes, hasSketch, hasPhoto}
  draft: null,    // capture in progress: {editingId, w, h, strokes, redo, text, hasPhoto}
  view: "capture", projectId: null,
};
const saveProjects = () => DB.put("kv", "projects", S.projects);
const saveInbox = () => DB.put("kv", "inbox", S.inbox);
let draftTimer = null;
function saveDraftSoon() { clearTimeout(draftTimer); draftTimer = setTimeout(() => DB.put("kv", "draft", S.draft), 400); }
const newDraft = () => ({ editingId: null, w: 0, h: 0, strokes: [], redo: [], text: "", hasPhoto: false });

/* ---------- page sizes ---------- */
const SIZES = [
  { preset: "us", name: "US comic", w: 6.625, h: 10.25, unit: "in" },
  { preset: "manga", name: "Manga", w: 5.04, h: 7.17, unit: "in" },
  { preset: "webtoon", name: "Webtoon", w: 800, h: 1280, unit: "px", strip: true },
  { preset: "square", name: "Square", w: 8, h: 8, unit: "in" },
  { preset: "custom", name: "Custom", w: 7, h: 10, unit: "in" },
];
const sizeLabel = s => s.preset === "webtoon" ? "Webtoon · vertical strip, 800 px wide"
  : `${(SIZES.find(x => x.preset === s.preset) || {}).name || "Custom"} · ${+s.w.toFixed(3)} × ${+s.h.toFixed(3)} in`;
function shapeEl(size, box = 54, boxH = 70) {
  const s = size.preset === "webtoon" ? { w: 1, h: 2.6 } : size; // a strip has no fixed height
  const sc = Math.min(box / s.w, boxH / s.h) * 0.9;
  return h("div", { class: "pshape", "aria-hidden": "true" }, h("i", { style: `width:${Math.round(s.w * sc)}px;height:${Math.round(s.h * sc)}px` }));
}

/* ---------- drawing ---------- */
const PENS = { fine: 2, medium: 4.5, bold: 9 };
const INKS = [
  { id: "ink", color: "#1A1714", label: "Ink" },
  { id: "blue", color: "#5FA8D3", label: "Blue pencil" },
  { id: "red", color: "#C8321E", label: "Red" },
];
const tool = { pen: "medium", ink: "ink", eraser: false };
const strokeWidth = (st, pr) => st.s * (st.e ? 2.4 : 0.35 + 0.9 * pr);
function drawSeg(ctx, st, a, b) {
  ctx.globalCompositeOperation = st.e ? "destination-out" : "source-over";
  ctx.strokeStyle = ctx.fillStyle = st.c; ctx.lineCap = ctx.lineJoin = "round";
  if (!b) { ctx.beginPath(); ctx.arc(a[0], a[1], strokeWidth(st, a[2]) / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.lineWidth = strokeWidth(st, (a[2] + b[2]) / 2);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}
function drawStroke(ctx, st) {
  const p = st.p; if (!p.length) return;
  if (p.length === 1) drawSeg(ctx, st, p[0]);
  for (let i = 1; i < p.length; i++) drawSeg(ctx, st, p[i - 1], p[i]);
  ctx.globalCompositeOperation = "source-over";
}
function drawFit(ctx, img, w, h) {
  const sc = Math.min(w / img.width, h / img.height), dw = img.width * sc, dh = img.height * sc;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
/* Render an item (or draft) at the given scale. bg: paper colour or null for transparent. */
async function renderItem(it, scale, { photo = true, sketch = true, bg = "#FFFFFF", photoImg } = {}) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(it.w * scale)); c.height = Math.max(1, Math.round(it.h * scale));
  const ctx = c.getContext("2d");
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height); }
  if (photo && it.hasPhoto) {
    const img = photoImg || await blobImg(await DB.get("blobs", "photo:" + it.id));
    if (img) drawFit(ctx, img, c.width, c.height);
  }
  if (sketch && it.strokes.length) {
    const ink = document.createElement("canvas"); ink.width = c.width; ink.height = c.height;
    const ictx = ink.getContext("2d"); ictx.scale(scale, scale);
    it.strokes.forEach(st => drawStroke(ictx, st));
    ctx.drawImage(ink, 0, 0);
  }
  return c;
}
async function blobImg(blob) {
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try { return await loadImg(url); } finally { URL.revokeObjectURL(url); }
}
/* Shrink a picked photo so the device doesn't fill up with full-size camera files. */
async function shrinkPhoto(file, max = 2000) {
  const img = await blobImg(file);
  const sc = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, c.width, c.height); // JPEG has no transparency
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasBlob(c, "image/jpeg", 0.88);
}

/* ---------- object URLs for the current screen ---------- */
let screenUrls = [];
function screenUrl(blob) { const u = URL.createObjectURL(blob); screenUrls.push(u); return u; }
function freeScreenUrls() { screenUrls.forEach(u => URL.revokeObjectURL(u)); screenUrls = []; }

/* ---------- routing ---------- */
function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
function route() {
  const hsh = location.hash.slice(1);
  if (hsh.startsWith("p/")) { S.view = "project"; S.projectId = hsh.slice(2); }
  else if (["capture", "inbox", "projects"].includes(hsh)) S.view = hsh;
  else S.view = isWide() ? "projects" : "capture";
  render();
}
window.addEventListener("hashchange", route);

function renderNav() {
  const cur = S.view === "project" ? "projects" : S.view;
  const tab = (id, label, extra) => h("button", { "aria-current": cur === id ? "page" : null, onclick: () => go("#" + id) }, label, extra);
  $("#nav").replaceChildren(
    tab("capture", "Capture"),
    tab("inbox", "Inbox", S.inbox.length ? h("span", { class: "badge" }, S.inbox.length) : null),
    tab("projects", "Projects"));
}
let capCleanup = null;
function render() {
  if (capCleanup) { capCleanup(); capCleanup = null; }
  freeScreenUrls();
  renderNav();
  $("#topActions").replaceChildren();
  const main = $("#main");
  if (S.view === "capture") main.replaceChildren(viewCapture());
  else if (S.view === "inbox") main.replaceChildren(viewInbox());
  else if (S.view === "project") main.replaceChildren(viewProject());
  else main.replaceChildren(viewProjects());
  window.scrollTo(0, 0);
}

/* ---------- capture ---------- */
function viewCapture() {
  const d = S.draft;
  const sheet = h("div", { class: "sheet" });
  const bgC = h("canvas", { "aria-hidden": "true" });
  const inkC = h("canvas", { class: "ink", role: "img", "aria-label": "Sketch canvas" });
  sheet.append(bgC, inkC);
  const stage = h("div", { class: "stage" }, sheet);
  let photoImg = null, scale = 1, dpr = 1;

  function paintBg() {
    const ctx = bgC.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, bgC.width, bgC.height);
    if (photoImg) drawFit(ctx, photoImg, bgC.width, bgC.height);
  }
  function paintInk() {
    const ctx = inkC.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, inkC.width, inkC.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    d.strokes.forEach(st => drawStroke(ctx, st));
  }
  /* The sketch keeps the shape it started with; rotating or resizing just rescales it. */
  function fit() {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (!cw || !ch) return;
    if (!d.w) { d.w = Math.round(cw - 8); d.h = Math.round(ch - 8); saveDraftSoon(); }
    scale = Math.min((cw - 8) / d.w, (ch - 8) / d.h); dpr = window.devicePixelRatio || 1;
    sheet.style.width = d.w * scale + "px"; sheet.style.height = d.h * scale + "px";
    for (const c of [bgC, inkC]) { c.width = Math.round(d.w * scale * dpr); c.height = Math.round(d.h * scale * dpr); }
    paintBg(); paintInk();
  }

  /* pen input */
  let live = null, sawPen = false, activeId = null;
  const pt = e => {
    const r = inkC.getBoundingClientRect();
    const pr = e.pointerType === "mouse" || !e.pressure ? 0.5 : e.pressure;
    return [+((e.clientX - r.left) / r.width * d.w).toFixed(1), +((e.clientY - r.top) / r.height * d.h).toFixed(1), +pr.toFixed(2)];
  };
  inkC.addEventListener("pointerdown", e => {
    if (e.pointerType === "pen") sawPen = true;
    else if (sawPen && e.pointerType === "touch") return; // palm on screen while using a stylus
    if (activeId != null || e.button > 0) return;
    activeId = e.pointerId; inkC.setPointerCapture(e.pointerId);
    const ink = INKS.find(i => i.id === tool.ink);
    live = { c: ink.color, s: PENS[tool.pen], e: tool.eraser || undefined, p: [pt(e)] };
    const ctx = inkC.getContext("2d"); ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    drawSeg(ctx, live, live.p[0]); ctx.globalCompositeOperation = "source-over";
    e.preventDefault();
  });
  inkC.addEventListener("pointermove", e => {
    if (!live || e.pointerId !== activeId) return;
    const ctx = inkC.getContext("2d"); ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const p = pt(ev), last = live.p[live.p.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.6) continue;
      live.p.push(p); drawSeg(ctx, live, last, p);
    }
    ctx.globalCompositeOperation = "source-over";
  });
  const end = e => {
    if (!live || e.pointerId !== activeId) return;
    d.strokes.push(live); d.redo = []; live = null; activeId = null;
    saveDraftSoon(); sync();
  };
  inkC.addEventListener("pointerup", end);
  inkC.addEventListener("pointercancel", end);

  /* toolbar */
  const tools = h("div", { class: "cap-tools", role: "toolbar", "aria-label": "Drawing tools" });
  const undoB = h("button", { class: "btn small", onclick: () => { if (d.strokes.length) { d.redo.push(d.strokes.pop()); paintInk(); saveDraftSoon(); sync(); } } }, "Undo");
  const redoB = h("button", { class: "btn small", onclick: () => { if (d.redo.length) { d.strokes.push(d.redo.pop()); paintInk(); saveDraftSoon(); sync(); } } }, "Redo");
  function drawTools() {
    tools.replaceChildren(
      Object.keys(PENS).map(k => h("button", { class: "btn small" + (!tool.eraser && tool.pen === k ? " on" : ""), "aria-pressed": String(!tool.eraser && tool.pen === k),
        onclick: () => { tool.pen = k; tool.eraser = false; drawTools(); } }, k[0].toUpperCase() + k.slice(1))),
      h("button", { class: "btn small" + (tool.eraser ? " on" : ""), "aria-pressed": String(tool.eraser), onclick: () => { tool.eraser = !tool.eraser; drawTools(); } }, "Eraser"),
      h("span", { class: "sep" }),
      INKS.map(i => h("button", { class: "swatch" + (tool.ink === i.id ? " on" : ""), style: `background:${i.color}`, title: i.label, "aria-label": i.label, "aria-pressed": String(tool.ink === i.id),
        onclick: () => { tool.ink = i.id; tool.eraser = false; drawTools(); } })),
      h("span", { class: "sep" }), undoB, redoB);
  }
  drawTools();

  /* below the canvas: text, photo, save */
  const text = h("textarea", { class: "field", id: "capText", placeholder: "Write the idea…", value: d.text,
    oninput: () => { d.text = text.value; saveDraftSoon(); sync(); } });
  const photoIn = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
    const f = photoIn.files[0]; photoIn.value = ""; if (!f) return;
    try {
      const blob = await shrinkPhoto(f);
      await DB.put("blobs", "draft-photo", blob);
      d.hasPhoto = true; photoImg = await blobImg(blob); saveDraftSoon(); paintBg(); sync();
    } catch (e) { toast("That picture couldn't be opened."); }
  } });
  const photoRow = h("div", { class: "photo-row" });
  const saveB = h("button", { class: "btn primary", onclick: saveCapture }, d.editingId ? "Save changes" : "Save to Inbox");
  const clearB = h("button", { class: "btn ghost danger", onclick: async () => {
    if (!confirm(d.editingId ? "Stop editing? Changes since you opened it are discarded." : "Clear this sketch, text and photo?")) return;
    await resetDraft(); render();
  } }, d.editingId ? "Cancel edit" : "Clear");

  function sync() {
    undoB.disabled = !d.strokes.length; redoB.disabled = !d.redo.length;
    saveB.disabled = !(d.strokes.length || d.text.trim() || d.hasPhoto);
    photoRow.replaceChildren(
      h("button", { class: "btn", onclick: () => photoIn.click() }, d.hasPhoto ? "Replace photo" : "Add photo"),
      d.hasPhoto ? h("button", { class: "btn ghost", onclick: async () => {
        d.hasPhoto = false; photoImg = null; await DB.del("blobs", "draft-photo"); saveDraftSoon(); paintBg(); sync();
      } }, "Remove photo") : null,
      d.hasPhoto ? h("span", { class: "small muted" }, "Shown behind the sketch") : null);
  }

  async function saveCapture() {
    saveB.disabled = true;
    const id = d.editingId || uid(), now = Date.now();
    const old = S.inbox.find(x => x.id === id);
    const item = { id, created: old ? old.created : now, updated: now, text: d.text.trim(), w: d.w, h: d.h,
      strokes: d.strokes, hasSketch: d.strokes.length > 0, hasPhoto: d.hasPhoto };
    try {
      if (d.hasPhoto) await DB.put("blobs", "photo:" + id, await DB.get("blobs", "draft-photo"));
      else await DB.del("blobs", "photo:" + id);
      if (item.hasSketch || item.hasPhoto) {
        const t = await renderItem(item, Math.min(1, 480 / d.w), { photoImg });
        await DB.put("blobs", "thumb:" + id, await canvasBlob(t, "image/jpeg", 0.85));
      } else await DB.del("blobs", "thumb:" + id);
      if (old) Object.assign(old, item); else S.inbox.unshift(item);
      await saveInbox();
      const wasEdit = !!d.editingId;
      await resetDraft();
      toast(wasEdit ? "Saved" : "Saved to Inbox");
      if (wasEdit) go("#inbox"); else render();
    } catch (e) { saveB.disabled = false; toast("Couldn't save. Try again."); }
  }

  const onResize = () => fit();
  window.addEventListener("resize", onResize);
  capCleanup = () => window.removeEventListener("resize", onResize);
  requestAnimationFrame(async () => {
    if (d.hasPhoto) photoImg = await blobImg(await DB.get("blobs", "draft-photo"));
    fit();
  });
  sync();

  return h("section", { "aria-label": "Capture" },
    tools, stage,
    h("div", { class: "cap-more stack" },
      d.editingId ? h("p", { class: "small muted", style: "margin:0" }, "Editing an Inbox idea.") : null,
      h("div", null, h("label", { class: "lbl", for: "capText" }, "Note"), text),
      photoRow, photoIn,
      h("div", { class: "row between" }, clearB, saveB)));
}
async function resetDraft() {
  S.draft = newDraft();
  await DB.del("blobs", "draft-photo");
  await DB.put("kv", "draft", S.draft);
}

/* ---------- inbox ---------- */
function inboxCard(it) {
  const thumb = h("div", { class: "thumb" });
  if (it.hasSketch || it.hasPhoto) DB.get("blobs", "thumb:" + it.id).then(b => { if (b) thumb.replaceChildren(h("img", { src: screenUrl(b), alt: "" })); });
  else thumb.append(h("div", { class: "txt" }, it.text));
  const first = it.text.split("\n")[0];
  return h("button", { class: "card", onclick: () => openItem(it) }, thumb,
    h("div", { class: "meta" },
      (it.hasSketch || it.hasPhoto) && first ? h("div", { class: "t" }, first) : null,
      fmtDate(it.created) + " · " + fmtTime(it.created)));
}
function inboxGrid() {
  if (!S.inbox.length) return h("div", { class: "empty" }, "Nothing here yet. Ideas you save in Capture land here.");
  return h("div", { class: "grid" }, S.inbox.map(inboxCard));
}
function viewInbox() {
  return h("section", { class: "stack", "aria-label": "Inbox" },
    h("div", { class: "row between" }, h("h2", null, "Inbox"), h("span", { class: "small muted" }, "Sort ideas into projects on the Chromebook (coming in a later phase)")),
    inboxGrid());
}
async function openItem(it) {
  const dlg = $("#dlg");
  const big = h("div", { class: "big" });
  const urls = [];
  if (it.hasSketch || it.hasPhoto) {
    const c = await renderItem(it, Math.min(2, 1400 / it.w));
    const u = URL.createObjectURL(await canvasBlob(c)); urls.push(u);
    big.append(h("img", { src: u, alt: "Saved sketch" }));
  }
  const close = () => dlg.close();
  dlg.onclose = () => urls.forEach(u => URL.revokeObjectURL(u));
  dlg.replaceChildren(h("div", { class: "dlg" },
    h("div", { class: "row between" }, h("h3", null, fmtDate(it.created) + " · " + fmtTime(it.created)), h("button", { class: "btn ghost small", onclick: close }, "Close")),
    big.childElementCount ? big : null,
    it.text ? h("div", { class: "note" }, it.text) : null,
    h("div", { class: "row between" },
      h("button", { class: "btn danger", onclick: async () => {
        if (!confirm("Delete this idea?")) return;
        S.inbox = S.inbox.filter(x => x.id !== it.id); await saveInbox();
        for (const k of ["photo:", "thumb:"]) await DB.del("blobs", k + it.id);
        close(); render();
      } }, "Delete"),
      h("button", { class: "btn primary", onclick: async () => {
        const d = S.draft;
        if ((d.strokes.length || d.text.trim() || d.hasPhoto) && !confirm("Capture has unsaved work. Replace it with this idea?")) return;
        S.draft = { editingId: it.id, w: it.w, h: it.h, strokes: JSON.parse(JSON.stringify(it.strokes)), redo: [], text: it.text, hasPhoto: it.hasPhoto };
        if (it.hasPhoto) await DB.put("blobs", "draft-photo", await DB.get("blobs", "photo:" + it.id));
        else await DB.del("blobs", "draft-photo");
        await DB.put("kv", "draft", S.draft);
        close(); go("#capture");
      } }, "Edit"))));
  dlg.showModal();
}

/* ---------- projects ---------- */
function viewProjects() {
  $("#topActions").replaceChildren(h("button", { class: "btn primary", onclick: () => projectDialog() }, "New project"));
  const list = S.projects.length
    ? h("div", { class: "plist" }, [...S.projects].sort((a, b) => b.updated - a.updated).map(p =>
        h("button", { class: "card pcard", onclick: () => go("#p/" + p.id) }, shapeEl(p.size),
          h("div", { class: "info" }, h("div", { class: "name" }, p.name), h("div", { class: "small muted" }, sizeLabel(p.size)),
            h("div", { class: "small muted" }, "Edited " + fmtDate(p.updated))))))
    : h("div", { class: "empty" }, "No projects yet. Start one with New project.");
  const wide = isWide();
  return h("div", { class: "split" + (wide ? " wide" : "") },
    h("section", { class: "stack", "aria-label": "Projects" }, h("h2", null, "Projects"), list),
    wide ? h("aside", { class: "side stack", "aria-label": "Inbox" },
      h("div", { class: "row between" }, h("h2", null, "Inbox"), h("span", { class: "small muted" }, S.inbox.length + (S.inbox.length === 1 ? " idea" : " ideas"))),
      inboxGrid()) : null);
}
function projectDialog(p) {
  const dlg = $("#dlg");
  const editing = !!p;
  let size = p ? { ...p.size } : { ...SIZES[0] };
  const name = h("input", { class: "field", id: "pName", value: p ? p.name : "", placeholder: "Untitled comic", maxLength: 80 });
  const cw = h("input", { class: "field", type: "number", min: "1", max: "40", step: "0.125", value: size.preset === "custom" ? size.w : 7, "aria-label": "Width in inches" });
  const chh = h("input", { class: "field", type: "number", min: "1", max: "40", step: "0.125", value: size.preset === "custom" ? size.h : 10, "aria-label": "Height in inches" });
  const customRow = h("div", { class: "row" }, h("div", { style: "flex:1" }, h("label", { class: "lbl" }, "Width (in)"), cw), h("div", { style: "flex:1" }, h("label", { class: "lbl" }, "Height (in)"), chh));
  const sizes = h("div", { class: "sizes", role: "radiogroup", "aria-label": "Page size" });
  function drawSizes() {
    sizes.replaceChildren(SIZES.map(s => h("button", { type: "button", class: "size" + (size.preset === s.preset ? " on" : ""), role: "radio", "aria-checked": String(size.preset === s.preset),
      onclick: () => { size = { preset: s.preset, w: s.w, h: s.h, unit: s.unit }; drawSizes(); } },
      h("b", null, s.name), h("span", null, s.preset === "webtoon" ? "Vertical strip" : s.preset === "custom" ? "Your own size" : `${s.w} × ${s.h} in`))));
    customRow.hidden = size.preset !== "custom";
  }
  drawSizes();
  const submit = async () => {
    if (size.preset === "custom") {
      const w = parseFloat(cw.value), hh = parseFloat(chh.value);
      if (!(w >= 1 && w <= 40 && hh >= 1 && hh <= 40)) { toast("Width and height must be 1–40 inches."); return; }
      size = { preset: "custom", w, h: hh, unit: "in" };
    }
    const now = Date.now(), nm = name.value.trim() || "Untitled comic";
    if (editing) Object.assign(p, { name: nm, size, updated: now });
    else { p = { id: uid(), name: nm, size, created: now, updated: now }; S.projects.push(p); }
    await saveProjects(); dlg.close();
    if (editing) render(); else go("#p/" + p.id);
  };
  dlg.onclose = null;
  dlg.replaceChildren(h("form", { class: "dlg", method: "dialog", onsubmit: e => { e.preventDefault(); submit(); } },
    h("h2", null, editing ? "Project settings" : "New project"),
    h("div", null, h("label", { class: "lbl", for: "pName" }, "Name"), name),
    h("div", null, h("label", { class: "lbl" }, "Page size"), sizes),
    customRow,
    h("div", { class: "row end" }, h("button", { type: "button", class: "btn ghost", onclick: () => dlg.close() }, "Cancel"),
      h("button", { type: "submit", class: "btn primary" }, editing ? "Save" : "Create"))));
  dlg.showModal(); name.focus();
}
function viewProject() {
  const p = S.projects.find(x => x.id === S.projectId);
  if (!p) return h("div", { class: "empty" }, "That project isn't on this device. ", h("button", { class: "btn small", onclick: () => go("#projects") }, "All projects"));
  $("#topActions").replaceChildren(
    h("button", { class: "btn ghost", onclick: () => projectDialog(p) }, "Settings"),
    h("button", { class: "btn ghost danger", onclick: async () => {
      if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
      S.projects = S.projects.filter(x => x.id !== p.id); await saveProjects(); go("#projects");
    } }, "Delete"));
  const soon = (title, what) => h("div", { class: "card", style: "cursor:default; padding:14px 16px" }, h("h3", null, title), h("p", { class: "small muted", style: "margin:6px 0 0" }, what));
  return h("section", { class: "stack", "aria-label": p.name },
    h("div", { class: "row" }, h("button", { class: "btn ghost small", onclick: () => go("#projects") }, "‹ Projects")),
    h("div", { class: "row", style: "gap:14px" }, shapeEl(p.size), h("div", null, h("h2", null, p.name), h("div", { class: "small muted" }, sizeLabel(p.size)))),
    soon("Beats", "The story as a list of beats. Coming in Phase 4."),
    soon("Panels", "One panel per beat, with sketches and images. Coming in Phase 4."),
    soon("Pages", "Panels arranged on pages, from grids or freeform shapes. Coming in Phase 5."));
}

/* ---------- start ---------- */
(async function start() {
  await DB.open();
  S.projects = (await DB.get("kv", "projects")) || [];
  S.inbox = (await DB.get("kv", "inbox")) || [];
  S.draft = (await DB.get("kv", "draft")) || newDraft();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  route();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
})();
